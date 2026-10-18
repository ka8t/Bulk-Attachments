// Moteur de l'extension, dans un document hors écran : il continue de tourner quand
// la popup se ferme. Il analyse les conversations, construit les ZIP et confie les
// fichiers au service d'arrière-plan pour l'enregistrement.
import {
  GmailClient,
  PathAllocator,
  buildPath,
  duplicateKey,
  extractAttachments,
  formatSize,
  parseExtensions,
  pool,
  sanitize,
  toCsv,
  ymd,
} from './lib/gmail.js';

const CONCURRENCY = 6;

async function call(type, data = {}) {
  const r = await chrome.runtime.sendMessage({ target: 'background', type, ...data });
  if (!r?.ok) throw new Error(r?.error || 'Pas de réponse du service d\'arrière-plan.');
  return r.value;
}

const gmail = new GmailClient({
  getToken: async () => {
    try {
      return await call('getToken', { interactive: false });
    } catch (e) {
      throw Object.assign(new Error(e.message), { auth: true });
    }
  },
  dropToken: (token) => call('dropToken', { token }),
});

const initialState = () => ({
  phase: 'idle', // idle | needAuth | scanning | ready | downloading | done | error
  account: '',
  source: null,
  attachments: [],
  emailCount: 0,
  truncated: false,
  progress: null,
  result: null,
  error: null,
});
let state = initialState();
let abort = null;

// Les dates voyagent en millisecondes : les messages entre contextes passent par JSON.
const publicState = () => ({
  ...state,
  attachments: state.attachments.map((a) => ({ ...a, date: a.date.getTime(), data: undefined })),
});

const notify = (msg) => chrome.runtime.sendMessage({ target: 'popup', ...msg }).catch(() => {});
const publish = () => notify({ type: 'state', state: publicState() });
const badge = (text, color) => call('badge', { text, color }).catch(() => {});

function setProgress(label, ratio) {
  state.progress = { label, ratio };
  notify({ type: 'progress', progress: state.progress });
}

function fail(e) {
  if (e.name === 'AbortError') {
    state.phase = state.attachments.length ? 'ready' : 'idle';
  } else if (e.auth) {
    state.phase = 'needAuth';
    state.error = e.message;
  } else {
    state.phase = 'error';
    state.error = e.message;
  }
}

async function ensureAccount() {
  if (!state.account) state.account = (await gmail.profile()).emailAddress;
}

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

async function scan(source, options) {
  abort?.abort();
  abort = new AbortController();
  const { signal } = abort;
  state = { ...initialState(), account: state.account, phase: 'scanning', source };
  publish();
  badge('…', '#c2410c');

  try {
    await ensureAccount();
    publish();
    const messages = [];
    if (source.kind === 'selection' || source.kind === 'thread') {
      let done = 0;
      await pool(
        source.threadIds,
        CONCURRENCY,
        async (id) => {
          const thread = await gmail.thread(id, signal);
          messages.push(...(thread.messages || []));
          done++;
          setProgress(`Lecture des conversations : ${done} / ${source.threadIds.length}`, done / source.threadIds.length);
        },
        signal,
      );
    } else {
      const max = Math.max(1, Number(options.max) || 500);
      const q = `has:attachment ${source.query || ''}`.trim();
      const ids = await gmail.listMessageIds({ q, max }, (n) => setProgress(`Recherche des e-mails : ${n} trouvés`, null), signal);
      state.truncated = ids.length >= max;
      let done = 0;
      await pool(
        ids,
        CONCURRENCY,
        async (id) => {
          messages.push(await gmail.message(id, signal));
          done++;
          setProgress(`Lecture des e-mails : ${done} / ${ids.length}`, done / ids.length);
        },
        signal,
      );
    }

    const extensions = parseExtensions(options.extensions);
    const found = messages.flatMap((m) => extractAttachments(m, { includeInline: options.includeInline, extensions }));
    found.sort((a, b) => b.date - a.date);
    // Le plus ancien exemplaire est conservé, les copies plus récentes sont marquées « doublon ».
    const seen = new Set();
    for (let i = found.length - 1; i >= 0; i--) {
      const key = duplicateKey(found[i]);
      found[i].duplicate = seen.has(key);
      seen.add(key);
    }
    found.forEach((a, i) => {
      a.index = i;
      a.selected = !(options.skipDuplicates && a.duplicate);
    });
    if (signal.aborted) throw new DOMException('Annulé', 'AbortError');
    state.attachments = found;
    state.emailCount = new Set(found.map((a) => a.messageId)).size;
    state.phase = 'ready';
  } catch (e) {
    // Analyse remplacée par une plus récente : l'état appartient désormais à celle-ci.
    if (abort.signal !== signal) return;
    fail(e);
  }
  state.progress = null;
  badge('');
  publish();
}

// ---------------------------------------------------------------------------
// Téléchargement
// ---------------------------------------------------------------------------

const blobUrls = new Map(); // identifiant de téléchargement -> URL blob à libérer
const endedEarly = new Set();

async function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const id = await call('download', { url, filename });
    if (endedEarly.delete(id)) URL.revokeObjectURL(url);
    else blobUrls.set(id, url);
    return id;
  } catch (e) {
    URL.revokeObjectURL(url);
    throw new Error(`${filename} : ${e.message}`);
  }
}

function downloadEnded(id) {
  const url = blobUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrls.delete(id);
  } else {
    endedEarly.add(id);
  }
}

const gmailLink = (att) =>
  `https://mail.google.com/mail/?authuser=${encodeURIComponent(state.account)}#all/${att.threadId}`;

function indexRows(entries) {
  return [
    ['Date', 'Expéditeur', 'Adresse', 'Objet', 'Fichier d\'origine', 'Taille (octets)', 'Chemin enregistré', 'Statut', 'Lien Gmail'],
    ...entries.map(({ att, path, error }) => [
      `${ymd(att.date)} ${att.date.toTimeString().slice(0, 5)}`,
      att.fromName,
      att.fromEmail,
      att.subject,
      att.filename,
      att.size,
      path || '',
      error ? `Échec : ${error}` : 'OK',
      gmailLink(att),
    ]),
  ];
}

const csvBlob = (rows) => new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });

// Découpe la sélection en lots dont la taille cumulée reste sous la limite d'un ZIP.
function splitBySize(list, maxBytes) {
  const groups = [];
  let current = [];
  let size = 0;
  for (const att of list) {
    if (current.length && size + att.size > maxBytes) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(att);
    size += att.size;
  }
  if (current.length) groups.push(current);
  return groups;
}

async function download(opts) {
  const selected = state.attachments.filter((a) => a.selected);
  if (!selected.length || state.phase === 'downloading') return;
  abort = new AbortController();
  const { signal } = abort;
  state.phase = 'downloading';
  state.result = null;
  state.error = null;
  publish();

  const now = new Date();
  const stamp = `${ymd(now)}_${now.toTimeString().slice(0, 5).replace(':', 'h')}`;
  const baseName = sanitize(opts.baseName || `Gmail-pieces-jointes_${stamp}`, 80);
  const allocator = new PathAllocator();
  const entries = [];
  const totalBytes = selected.reduce((s, a) => s + a.size, 0) || 1;
  let doneBytes = 0;
  let doneCount = 0;
  const saved = [];

  const tick = () => {
    const ratio = doneBytes / totalBytes;
    setProgress(
      `Téléchargement : ${doneCount} / ${selected.length} pièces jointes (${formatSize(doneBytes)} / ${formatSize(totalBytes)})`,
      ratio,
    );
    badge(`${Math.min(99, Math.round(ratio * 100))}%`, '#c2410c');
  };

  // Récupère une pièce jointe ; un échec est consigné sans interrompre le lot.
  const fetchOne = async (att, onBytes) => {
    const path = allocator.allocate(buildPath(att, opts));
    const entry = { att, path };
    entries.push(entry);
    try {
      await onBytes(await gmail.attachmentBytes(att, signal), path);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      entry.error = e.message;
      entry.path = '';
    }
    doneCount++;
    doneBytes += att.size;
    tick();
  };

  try {
    tick();
    if (opts.format === 'zip') {
      const maxBytes = Math.max(50, Number(opts.maxZipMB) || 1000) * 1024 * 1024;
      const groups = splitBySize(selected, maxBytes);
      for (let g = 0; g < groups.length; g++) {
        const zip = new JSZip();
        const start = entries.length;
        await pool(
          groups[g],
          CONCURRENCY,
          (att) => fetchOne(att, (bytes, path) => zip.file(path, bytes, { date: att.date, binary: true })),
          signal,
        );
        if (opts.includeIndex) zip.file('index.csv', toCsv(indexRows(entries.slice(start))));
        const suffix = groups.length > 1 ? `_partie-${g + 1}-sur-${groups.length}` : '';
        const blob = await zip.generateAsync(
          { type: 'blob', compression: opts.compress ? 'DEFLATE' : 'STORE', compressionOptions: { level: 6 } },
          (meta) => setProgress(`Création du ZIP ${g + 1}/${groups.length} : ${Math.round(meta.percent)} %`, meta.percent / 100),
        );
        if (signal.aborted) throw new DOMException('Annulé', 'AbortError');
        const name = `${baseName}${suffix}.zip`;
        await saveBlob(blob, name);
        saved.push(name);
      }
    } else {
      await pool(
        selected,
        CONCURRENCY,
        (att) =>
          fetchOne(att, async (bytes, path) => {
            await saveBlob(new Blob([bytes], { type: att.mimeType || 'application/octet-stream' }), `${baseName}/${path}`);
          }),
        signal,
      );
      if (opts.includeIndex) await saveBlob(csvBlob(indexRows(entries)), `${baseName}/index.csv`);
      saved.push(`${baseName}/`);
    }

    const failed = entries.filter((e) => e.error);
    state.result = {
      saved,
      count: entries.length - failed.length,
      bytes: doneBytes,
      failed: failed.map((e) => ({ filename: e.att.filename, subject: e.att.subject, error: e.error })),
    };
    state.phase = 'done';
    badge('OK', '#15803d');
    setTimeout(() => state.phase !== 'downloading' && badge(''), 15000);
  } catch (e) {
    fail(e);
    badge('');
  }
  state.progress = null;
  publish();
}

async function exportList() {
  const list = state.attachments.filter((a) => a.selected);
  const rows = indexRows(list.map((att) => ({ att })));
  rows.forEach((r) => r.splice(6, 2)); // ni chemin ni statut : rien n'a encore été téléchargé
  await saveBlob(csvBlob(rows), `Gmail-liste-pieces-jointes_${ymd(new Date())}.csv`);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const handlers = {
  getState: async () => publicState(),
  scan: async ({ source, options }) => {
    scan(source, options);
    return true;
  },
  setSelected: async ({ indexes, value }) => {
    indexes.forEach((i) => state.attachments[i] && (state.attachments[i].selected = value));
    return true;
  },
  download: async ({ opts }) => {
    download(opts);
    return true;
  },
  exportList: () => exportList().then(() => true),
  cancel: async () => {
    abort?.abort();
    return true;
  },
  signOut: async () => {
    abort?.abort();
    await call('signOut', { token: gmail.token });
    gmail.token = null;
    state = initialState();
    publish();
    return true;
  },
  downloadEnded: async ({ id }) => {
    downloadEnded(id);
    return true;
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen' || !handlers[msg.type]) return false;
  handlers[msg.type](msg)
    .then((value) => sendResponse({ ok: true, value }))
    .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
  return true;
});
