// Popup : lit la sélection de l'onglet Gmail, affiche les pièces jointes trouvées et
// pilote le moteur (offscreen.js), qui continue de travailler après fermeture.
import { formatSize, queryFromGmailHash, readGmailSelection } from './lib/gmail.js';

const $ = (sel) => document.querySelector(sel);
const optionsForm = $('#optionsForm');
const OPTIONS_KEY = 'options';
const SCAN_OPTIONS = ['skipDuplicates', 'includeInline', 'extensions', 'max'];

let source = null; // ce que l'utilisateur a sélectionné dans Gmail
let gmailEmail = '';
let state = null; // dernier état connu du moteur

// ---------------------------------------------------------------------------
// Messagerie
// ---------------------------------------------------------------------------

async function send(target, type, data = {}) {
  const r = await chrome.runtime.sendMessage({ target, type, ...data });
  if (!r?.ok) throw new Error(r?.error || 'Pas de réponse.');
  return r.value;
}
const engine = (type, data) => send('offscreen', type, data);
const background = (type, data) => send('background', type, data);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'popup') return;
  if (msg.type === 'state') render(msg.state);
  if (msg.type === 'progress') renderProgress(msg.progress);
});

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

function options() {
  const out = {};
  for (const el of optionsForm.elements) {
    if (el.name) out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return out;
}

async function restoreOptions() {
  const { [OPTIONS_KEY]: saved = {} } = await chrome.storage.local.get(OPTIONS_KEY);
  for (const el of optionsForm.elements) {
    if (!el.name || !(el.name in saved)) continue;
    if (el.type === 'checkbox') el.checked = saved[el.name];
    else el.value = saved[el.name];
  }
  updateZipFields();
}

function updateZipFields() {
  const zip = optionsForm.elements.format.value === 'zip';
  document.querySelectorAll('[data-zip]').forEach((el) => (el.hidden = !zip));
}

// ---------------------------------------------------------------------------
// Sélection Gmail
// ---------------------------------------------------------------------------

async function targetTab() {
  // ?tab=<id> permet d'ouvrir la popup dans un onglet pour le débogage et les tests.
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  if (forced) return chrome.tabs.get(forced);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const plural = (n, one, many) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;

function describeSource(sel) {
  const query = queryFromGmailHash(sel.hash);
  switch (sel.kind) {
    case 'selection':
      return {
        kind: 'selection',
        threadIds: sel.threadIds,
        title: `${plural(sel.threadIds.length, 'conversation sélectionnée', 'conversations sélectionnées')}`,
        detail: 'Toutes les pièces jointes de ces conversations.',
        auto: true,
      };
    case 'thread':
      return {
        kind: 'thread',
        threadIds: sel.threadIds,
        title: 'Conversation ouverte',
        detail: sel.subject,
        auto: true,
      };
    case 'all':
      return {
        kind: 'query',
        query,
        title: sel.total
          ? `Les ${sel.total.toLocaleString('fr-FR')} conversations de la recherche`
          : 'Toutes les conversations de la recherche',
        detail: query ? `Recherche : ${query}` : 'Tous les e-mails',
        auto: false,
      };
    default:
      return {
        kind: 'query',
        query,
        title: 'Aucun e-mail coché',
        detail: `Cochez des e-mails dans Gmail, ou analysez toute la vue actuelle${query ? ` (${query})` : ''}.`,
        auto: false,
      };
  }
}

const sourceKey = (s) => (s ? `${s.kind}|${(s.threadIds || []).join(',')}|${s.query || ''}` : '');

// ---------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' });

function show(id, visible) {
  $(id).hidden = !visible;
}

function setError(msg) {
  $('#error').textContent = msg || '';
  show('#error', Boolean(msg));
}

function visibleAttachments() {
  const f = $('#filterText').value.trim().toLowerCase();
  const list = state?.attachments || [];
  if (!f) return list;
  return list.filter((a) => `${a.filename} ${a.fromName} ${a.fromEmail} ${a.subject}`.toLowerCase().includes(f));
}

function renderRows() {
  const items = visibleAttachments().map((a) => {
    const li = document.createElement('li');
    li.className = a.selected ? '' : 'off';
    li.dataset.index = a.index;
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: a.selected });
    cb.setAttribute('aria-label', a.filename);

    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('div');
    name.className = 'name';
    const fileName = document.createElement('span');
    fileName.textContent = a.filename;
    if (a.duplicate) fileName.append(Object.assign(document.createElement('span'), { className: 'tag', textContent: 'doublon' }));
    if (a.inline) fileName.append(Object.assign(document.createElement('span'), { className: 'tag', textContent: 'intégrée' }));
    name.append(fileName, Object.assign(document.createElement('span'), { className: 'size', textContent: formatSize(a.size) }));
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${a.fromName} · ${dateFmt.format(new Date(a.date))} · ${a.subject}`;
    meta.title = meta.textContent;
    info.append(name, meta);

    li.append(cb, info);
    return li;
  });
  $('#rows').replaceChildren(...items);
  renderStats();
}

function renderStats() {
  const all = state?.attachments || [];
  const sel = all.filter((a) => a.selected);
  const bytes = sel.reduce((s, a) => s + a.size, 0);
  $('#stats').textContent = `${sel.length} / ${plural(all.length, 'pièce jointe', 'pièces jointes')} · ${plural(state.emailCount, 'e-mail', 'e-mails')}`;
  const visible = visibleAttachments();
  const checkAll = $('#checkAll');
  checkAll.checked = visible.length > 0 && visible.every((a) => a.selected);
  checkAll.indeterminate = !checkAll.checked && visible.some((a) => a.selected);
  const busy = state.phase === 'downloading' || state.phase === 'scanning';
  const btn = $('#btnDownload');
  btn.disabled = busy || sel.length === 0;
  btn.textContent = sel.length ? `Télécharger ${plural(sel.length, 'fichier', 'fichiers')} (${formatSize(bytes)})` : 'Télécharger';
}

function renderProgress(progress) {
  if (!progress) return;
  $('#progressLabel').textContent = progress.label;
  $('#progressFill').style.width = progress.ratio == null ? '100%' : `${Math.round(Math.min(1, progress.ratio) * 100)}%`;
}

function render(next) {
  state = next;
  const { phase } = state;
  const busy = phase === 'scanning' || phase === 'downloading';
  const sameSource = sourceKey(state.source) === sourceKey(source);

  $('#account').textContent = state.account || '';
  show('#btnSignOut', Boolean(state.account));
  if (state.account && gmailEmail && state.account.toLowerCase() !== gmailEmail.toLowerCase()) {
    $('#warning').textContent =
      `Gmail affiche le compte ${gmailEmail}, mais l'extension lit le compte ${state.account} (compte du profil Chrome). ` +
      'Les e-mails sélectionnés ne seront pas trouvés : utilisez le profil Chrome de ce compte.';
    show('#warning', true);
  } else {
    show('#warning', false);
  }

  show('#auth', phase === 'needAuth');
  setError(phase === 'error' ? state.error : '');

  // Une opération en cours sur une autre sélection reste affichée jusqu'à la fin.
  const shown = busy && !sameSource ? state.source : source;
  if (shown) {
    $('#sourceTitle').textContent = shown.title;
    $('#sourceDetail').textContent = busy && !sameSource ? `${shown.detail} (opération en cours)` : shown.detail;
  }
  show('#source', Boolean(shown) && phase !== 'needAuth');
  const scanned = sameSource && (phase === 'ready' || phase === 'done');
  $('#btnScan').textContent = scanned ? 'Actualiser' : 'Analyser';
  $('#btnScan').disabled = busy;

  const hasList = state.attachments.length > 0 && (sameSource || busy) && phase !== 'scanning';
  show('#list', hasList);
  show('#btnExport', hasList);
  if (hasList) renderRows();
  $('#truncated').textContent = state.truncated
    ? 'Limite du nombre d\'e-mails atteinte : augmentez-la dans les options pour tout analyser.'
    : '';
  show('#truncated', hasList && state.truncated);

  if ((phase === 'ready' || phase === 'done') && sameSource && state.attachments.length === 0) {
    setError('Aucune pièce jointe dans cette sélection.');
  }
  if (!hasList) $('#btnDownload').disabled = true;

  show('#progress', busy);
  if (busy) renderProgress(state.progress || { label: phase === 'scanning' ? 'Analyse…' : 'Téléchargement…', ratio: null });

  const r = state.result;
  if (phase === 'done' && r) {
    let text = `Terminé : ${plural(r.count, 'fichier enregistré', 'fichiers enregistrés')} (${formatSize(r.bytes)}) dans le dossier Téléchargements :\n${r.saved.join('\n')}`;
    if (r.failed.length) {
      text += `\n\n${plural(r.failed.length, 'échec', 'échecs')} :\n` +
        r.failed.slice(0, 8).map((f) => `• ${f.filename} : ${f.error}`).join('\n') +
        (r.failed.length > 8 ? `\n… voir index.csv` : '');
    }
    $('#result').textContent = text;
  }
  show('#result', phase === 'done' && Boolean(r) && sameSource);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function startScan() {
  setError('');
  await engine('scan', { source, options: options() });
}

async function connect() {
  setError('');
  try {
    await background('getToken', { interactive: true });
    await startScan();
  } catch (e) {
    setError(`Connexion impossible : ${e.message}`);
  }
}

async function saveOptions(e) {
  updateZipFields();
  await chrome.storage.local.set({ [OPTIONS_KEY]: options() });
  // Une option d'analyse modifiée invite à relancer l'analyse.
  if (SCAN_OPTIONS.includes(e?.target?.name) && state?.phase === 'ready') $('#btnScan').textContent = 'Actualiser';
}

optionsForm.addEventListener('change', saveOptions);
optionsForm.addEventListener('submit', (e) => e.preventDefault());
$('#btnScan').addEventListener('click', () => startScan().catch((e) => setError(e.message)));
$('#btnConnect').addEventListener('click', connect);
$('#btnCancel').addEventListener('click', () => engine('cancel'));
$('#btnSignOut').addEventListener('click', () => engine('signOut').catch((e) => setError(e.message)));
$('#btnExport').addEventListener('click', () => engine('exportList').catch((e) => setError(e.message)));
$('#btnDownload').addEventListener('click', () => {
  setError('');
  engine('download', { opts: options() }).catch((e) => setError(e.message));
});
$('#btnOpenGmail').addEventListener('click', () => chrome.tabs.create({ url: 'https://mail.google.com/' }));

$('#filterText').addEventListener('input', renderRows);
$('#rows').addEventListener('change', (e) => {
  if (e.target.type !== 'checkbox') return;
  const li = e.target.closest('li');
  const att = state.attachments[Number(li.dataset.index)];
  att.selected = e.target.checked;
  li.className = att.selected ? '' : 'off';
  engine('setSelected', { indexes: [att.index], value: att.selected });
  renderStats();
});
$('#checkAll').addEventListener('change', (e) => {
  const list = visibleAttachments();
  list.forEach((a) => (a.selected = e.target.checked));
  engine('setSelected', { indexes: list.map((a) => a.index), value: e.target.checked });
  renderRows();
});

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

(async function init() {
  await restoreOptions();
  const tab = await targetTab();
  if (!tab?.url?.startsWith('https://mail.google.com/')) {
    show('#notGmail', true);
    show('#options', false);
    return;
  }

  try {
    const [{ result: sel }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readGmailSelection });
    gmailEmail = sel.accountEmail;
    source = describeSource(sel);
  } catch (e) {
    setError(`Lecture de la page Gmail impossible : ${e.message}. Rechargez Gmail puis réessayez.`);
    return;
  }

  await background('ensureOffscreen');
  const current = await engine('getState');
  const busy = current.phase === 'scanning' || current.phase === 'downloading';
  const alreadyScanned = sourceKey(current.source) === sourceKey(source) && ['ready', 'done'].includes(current.phase);
  render(current);
  if (!busy && !alreadyScanned && source.auto) await startScan();
})().catch((e) => setError(e.message));
