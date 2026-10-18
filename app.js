import {
  GmailClient,
  PathAllocator,
  buildPath,
  buildQuery,
  duplicateKey,
  extractAttachments,
  formatSize,
  parseExtensions,
  pool,
  sanitize,
  toCsv,
  ymd,
} from './lib/gmail.js';

const $ = (sel) => document.querySelector(sel);
const searchForm = $('#searchForm');
const downloadForm = $('#downloadForm');
const SETTINGS_KEY = 'settings';
const FETCH_CONCURRENCY = 6;

const state = {
  email: '',
  attachments: [],
  emailCount: 0,
  busy: false,
  abort: null,
};

// ---------------------------------------------------------------------------
// Authentification (compte Google du profil Chrome)
// ---------------------------------------------------------------------------

async function getToken(interactive) {
  const r = await chrome.identity.getAuthToken({ interactive });
  const token = typeof r === 'string' ? r : r?.token;
  if (!token) throw new Error('Aucun jeton OAuth obtenu.');
  return token;
}

const gmail = new GmailClient({
  getToken,
  dropToken: (token) => chrome.identity.removeCachedAuthToken({ token }),
});

async function connect(interactive) {
  try {
    gmail.token = await getToken(interactive);
    const profile = await gmail.profile();
    state.email = profile.emailAddress;
    $('#accountEmail').textContent = `${profile.emailAddress} · ${profile.messagesTotal.toLocaleString('fr-FR')} e-mails`;
    $('#btnConnect').hidden = true;
    $('#btnDisconnect').hidden = false;
    hideError();
    await loadLabels();
    return true;
  } catch (e) {
    if (interactive) showError(`Connexion impossible : ${e.message}`);
    return false;
  }
}

async function disconnect() {
  const token = gmail.token;
  if (token) {
    await chrome.identity.removeCachedAuthToken({ token });
    await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: 'POST' }).catch(() => {});
  }
  await chrome.identity.clearAllCachedAuthTokens();
  gmail.token = null;
  state.email = '';
  $('#accountEmail').textContent = 'Non connecté';
  $('#btnConnect').hidden = false;
  $('#btnDisconnect').hidden = true;
}

async function loadLabels() {
  const select = searchForm.elements.label;
  const keep = select.value || select.dataset.saved || '';
  const labels = await gmail.labels();
  const system = { INBOX: 'Boîte de réception', SENT: 'Envoyés', STARRED: 'Suivis', IMPORTANT: 'Importants', DRAFT: 'Brouillons' };
  const options = labels
    .filter((l) => l.type === 'user' || system[l.id])
    .map((l) => ({ id: l.id, name: system[l.id] || l.name, system: Boolean(system[l.id]) }))
    .sort((a, b) => (a.system === b.system ? a.name.localeCompare(b.name, 'fr') : a.system ? -1 : 1));
  select.replaceChildren(new Option('Tous les e-mails', ''), ...options.map((o) => new Option(o.name, o.id)));
  select.value = options.some((o) => o.id === keep) ? keep : '';
}

// ---------------------------------------------------------------------------
// Réglages persistants
// ---------------------------------------------------------------------------

function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return out;
}

function applyValues(form, values = {}) {
  for (const el of form.elements) {
    if (!el.name || !(el.name in values)) continue;
    if (el.type === 'checkbox') el.checked = values[el.name];
    else el.value = values[el.name];
    if (el.tagName === 'SELECT') el.dataset.saved = values[el.name];
  }
}

async function restoreSettings() {
  const { [SETTINGS_KEY]: saved = {} } = await chrome.storage.local.get(SETTINGS_KEY);
  applyValues(searchForm, saved.search);
  applyValues(downloadForm, saved.download);
  const q = new URLSearchParams(location.search).get('q');
  if (q) searchForm.elements.raw.value = q;
}

function saveSettings() {
  chrome.storage.local.set({
    [SETTINGS_KEY]: { search: formValues(searchForm), download: formValues(downloadForm) },
  });
}

function searchFilters() {
  const v = formValues(searchForm);
  return { ...v, minSizeMB: Number(v.minSizeMB) || 0, max: Math.max(1, Number(v.max) || 500) };
}

function updateQueryPreview() {
  $('#queryPreview').textContent = buildQuery(searchFilters());
}

function updateZipFields() {
  const zip = downloadForm.elements.format.value === 'zip';
  document.querySelectorAll('[data-zip]').forEach((el) => (el.hidden = !zip));
}

// ---------------------------------------------------------------------------
// Interface : progression, erreurs, tableau
// ---------------------------------------------------------------------------

function showError(msg) {
  const el = $('#errorBanner');
  el.textContent = msg;
  el.hidden = false;
}
function hideError() {
  $('#errorBanner').hidden = true;
}

function setBusy(busy) {
  state.busy = busy;
  $('#btnSearch').disabled = busy;
  $('#btnDownload').disabled = busy;
  $('#btnExportCsv').disabled = busy;
  $('#progressBar').hidden = !busy;
  if (busy) setProgress('…', 0);
}

function setProgress(label, ratio) {
  $('#progressLabel').textContent = label;
  $('#progressFill').style.width = ratio == null ? '100%' : `${Math.round(Math.min(1, ratio) * 100)}%`;
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

function gmailLink(att) {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(state.email)}#all/${att.threadId}`;
}

function visibleAttachments() {
  const f = $('#filterText').value.trim().toLowerCase();
  if (!f) return state.attachments;
  return state.attachments.filter((a) =>
    `${a.filename} ${a.fromName} ${a.fromEmail} ${a.subject}`.toLowerCase().includes(f),
  );
}

function renderTable() {
  const rows = visibleAttachments().map((a) => {
    const tr = document.createElement('tr');
    tr.className = a.selected ? '' : 'off';
    tr.dataset.index = a.index;

    const tdCheck = document.createElement('td');
    tdCheck.className = 'c-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = a.selected;
    tdCheck.append(cb);

    const tdFile = document.createElement('td');
    tdFile.className = 'c-file';
    tdFile.textContent = a.filename;
    if (a.duplicate) tdFile.append(Object.assign(document.createElement('span'), { className: 'tag', textContent: 'doublon' }));
    if (a.inline) tdFile.append(Object.assign(document.createElement('span'), { className: 'tag', textContent: 'intégrée' }));

    const tdSize = document.createElement('td');
    tdSize.className = 'c-size';
    tdSize.textContent = formatSize(a.size);

    const tdFrom = document.createElement('td');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = a.fromName;
    if (a.fromName !== a.fromEmail) {
      who.append(document.createElement('br'), Object.assign(document.createElement('small'), { textContent: a.fromEmail }));
    }
    tdFrom.append(who);

    const tdSubject = document.createElement('td');
    tdSubject.className = 'c-subject';
    const link = Object.assign(document.createElement('a'), {
      href: gmailLink(a),
      target: '_blank',
      rel: 'noopener',
      textContent: a.subject,
      title: 'Ouvrir dans Gmail',
    });
    tdSubject.append(link);

    const tdDate = document.createElement('td');
    tdDate.className = 'c-date';
    tdDate.textContent = dateFmt.format(a.date);

    tr.append(tdCheck, tdFile, tdSize, tdFrom, tdSubject, tdDate);
    return tr;
  });
  $('#rows').replaceChildren(...rows);
  updateStats();
}

function updateStats() {
  const sel = state.attachments.filter((a) => a.selected);
  const total = sel.reduce((s, a) => s + a.size, 0);
  $('#stats').textContent =
    `${state.emailCount.toLocaleString('fr-FR')} e-mails · ${state.attachments.length.toLocaleString('fr-FR')} pièces jointes · ` +
    `${sel.length.toLocaleString('fr-FR')} sélectionnées (${formatSize(total)})`;
  const visible = visibleAttachments();
  const checkAll = $('#checkAll');
  checkAll.checked = visible.length > 0 && visible.every((a) => a.selected);
  checkAll.indeterminate = !checkAll.checked && visible.some((a) => a.selected);
  $('#btnDownload').disabled = state.busy || sel.length === 0;
}

function setSelection(list, selected) {
  list.forEach((a) => (a.selected = selected));
  renderTable();
}

// ---------------------------------------------------------------------------
// Recherche
// ---------------------------------------------------------------------------

async function runSearch() {
  if (!gmail.token && !(await connect(true))) return;
  hideError();
  saveSettings();
  const f = searchFilters();
  const q = buildQuery(f);
  const extensions = parseExtensions(f.extensions);
  state.abort = new AbortController();
  const { signal } = state.abort;
  setBusy(true);

  try {
    setProgress('Recherche des e-mails…', null);
    const ids = await gmail.listMessageIds(
      { q, labelIds: f.label || undefined, includeSpamTrash: f.includeSpamTrash, max: f.max },
      (n) => setProgress(`Recherche des e-mails… ${n} trouvés`, null),
      signal,
    );

    const found = [];
    let done = 0;
    await pool(
      ids,
      FETCH_CONCURRENCY,
      async (id) => {
        const msg = await gmail.message(id, signal);
        found.push(...extractAttachments(msg, { includeInline: f.includeInline, extensions }));
        done++;
        setProgress(`Analyse des e-mails : ${done} / ${ids.length}`, done / ids.length);
      },
      signal,
    );

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
      a.selected = !(f.skipDuplicates && a.duplicate);
    });

    state.attachments = found;
    state.emailCount = new Set(found.map((a) => a.messageId)).size;
    $('#filterText').value = '';
    $('#resultsCard').hidden = false;
    $('#downloadCard').hidden = found.length === 0;
    renderTable();
    if (ids.length >= f.max) {
      showError(`Limite de ${f.max} e-mails atteinte : d'autres e-mails correspondent peut-être. Augmentez la limite ou affinez la recherche.`);
    } else if (!found.length) {
      showError('Aucune pièce jointe trouvée pour cette recherche.');
    }
  } catch (e) {
    if (e.name !== 'AbortError') showError(`Erreur pendant la recherche : ${e.message}`);
  } finally {
    setBusy(false);
    updateStats();
  }
}

// ---------------------------------------------------------------------------
// Téléchargement
// ---------------------------------------------------------------------------

function waitForDownload(id) {
  return new Promise((resolve) => {
    const listener = (delta) => {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(listener);
        resolve(delta.state.current);
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  });
}

async function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
    waitForDownload(id).finally(() => URL.revokeObjectURL(url));
    return id;
  } catch (e) {
    URL.revokeObjectURL(url);
    throw new Error(`${filename} : ${e.message}`);
  }
}

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

async function runDownload() {
  const selected = state.attachments.filter((a) => a.selected);
  if (!selected.length) return;
  hideError();
  saveSettings();

  const opts = formValues(downloadForm);
  const stamp = `${ymd(new Date())}_${new Date().toTimeString().slice(0, 5).replace(':', 'h')}`;
  const baseName = sanitize(opts.baseName || `Gmail-pieces-jointes_${stamp}`, 80);
  const allocator = new PathAllocator();
  const entries = [];
  const totalBytes = selected.reduce((s, a) => s + a.size, 0) || 1;
  let doneBytes = 0;
  let doneCount = 0;

  state.abort = new AbortController();
  const { signal } = state.abort;
  setBusy(true);

  const progress = (verb) =>
    setProgress(
      `${verb} ${doneCount} / ${selected.length} pièces jointes (${formatSize(doneBytes)} / ${formatSize(totalBytes)})`,
      doneBytes / totalBytes,
    );

  // Récupère une pièce jointe ; les échecs sont consignés sans interrompre le lot.
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
  };

  try {
    if (opts.format === 'zip') {
      const maxBytes = Math.max(50, Number(opts.maxZipMB) || 1000) * 1024 * 1024;
      const groups = splitBySize(selected, maxBytes);
      for (let g = 0; g < groups.length; g++) {
        const zip = new JSZip();
        const start = entries.length;
        await pool(
          groups[g],
          FETCH_CONCURRENCY,
          (att) =>
            fetchOne(att, (bytes, path) => {
              zip.file(path, bytes, { date: att.date, binary: true });
            }).then(() => progress('Téléchargement :')),
          signal,
        );
        if (opts.includeIndex) zip.file('index.csv', toCsv(indexRows(entries.slice(start))));
        const suffix = groups.length > 1 ? `_partie-${g + 1}-sur-${groups.length}` : '';
        const blob = await zip.generateAsync(
          {
            type: 'blob',
            compression: opts.compress ? 'DEFLATE' : 'STORE',
            compressionOptions: { level: 6 },
          },
          (meta) => setProgress(`Création du ZIP ${g + 1}/${groups.length} : ${Math.round(meta.percent)} %`, meta.percent / 100),
        );
        if (signal.aborted) throw new DOMException('Annulé', 'AbortError');
        await saveBlob(blob, `${baseName}${suffix}.zip`);
      }
    } else {
      await pool(
        selected,
        FETCH_CONCURRENCY,
        (att) =>
          fetchOne(att, async (bytes, path) => {
            await saveBlob(new Blob([bytes], { type: att.mimeType || 'application/octet-stream' }), `${baseName}/${path}`);
          }).then(() => progress('Enregistrement :')),
        signal,
      );
      if (opts.includeIndex) await saveBlob(csvBlob(indexRows(entries)), `${baseName}/index.csv`);
    }

    const failed = entries.filter((e) => e.error);
    setProgress(`Terminé : ${entries.length - failed.length} fichiers enregistrés.`, 1);
    if (failed.length) {
      showError(
        `${failed.length} pièce(s) jointe(s) en échec :\n` +
          failed.slice(0, 15).map((e) => `• ${e.att.filename} (${e.att.subject}) : ${e.error}`).join('\n') +
          (failed.length > 15 ? `\n… et ${failed.length - 15} autres (voir index.csv).` : ''),
      );
    }
  } catch (e) {
    if (e.name !== 'AbortError') showError(`Erreur pendant le téléchargement : ${e.message}`);
  } finally {
    setTimeout(() => setBusy(false), 1500);
  }
}

async function exportCsv() {
  const list = state.attachments.filter((a) => a.selected);
  const rows = indexRows(list.map((att) => ({ att })));
  rows.forEach((r) => r.splice(6, 2)); // ni chemin ni statut : rien n'a encore été téléchargé
  await saveBlob(csvBlob(rows), `Gmail-liste-pieces-jointes_${ymd(new Date())}.csv`);
}

// ---------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch();
});
searchForm.addEventListener('input', updateQueryPreview);
searchForm.addEventListener('change', saveSettings);

downloadForm.addEventListener('submit', (e) => {
  e.preventDefault();
  runDownload();
});
downloadForm.addEventListener('change', () => {
  updateZipFields();
  saveSettings();
});

$('#rows').addEventListener('change', (e) => {
  if (e.target.type !== 'checkbox') return;
  const tr = e.target.closest('tr');
  const att = state.attachments[Number(tr.dataset.index)];
  att.selected = e.target.checked;
  tr.className = att.selected ? '' : 'off';
  updateStats();
});
$('#checkAll').addEventListener('change', (e) => setSelection(visibleAttachments(), e.target.checked));
$('#btnSelectAll').addEventListener('click', () => setSelection(visibleAttachments(), true));
$('#btnSelectNone').addEventListener('click', () => setSelection(visibleAttachments(), false));
$('#filterText').addEventListener('input', renderTable);
$('#btnExportCsv').addEventListener('click', () => exportCsv().catch((e) => showError(e.message)));
$('#btnCancel').addEventListener('click', () => state.abort?.abort());
$('#btnConnect').addEventListener('click', () => connect(true));
$('#btnDisconnect').addEventListener('click', disconnect);

window.addEventListener('beforeunload', (e) => {
  if (state.busy) e.preventDefault();
});

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

(async function init() {
  const clientId = chrome.runtime.getManifest().oauth2?.client_id || '';
  if (clientId.startsWith('REMPLACER')) {
    $('#extId').textContent = chrome.runtime.id;
    $('#setupBanner').hidden = false;
    $('#btnConnect').disabled = true;
    $('#btnSearch').disabled = true;
  }
  await restoreSettings();
  updateQueryPreview();
  updateZipFields();
  if (!clientId.startsWith('REMPLACER')) await connect(false);
})();
