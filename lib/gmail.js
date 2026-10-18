// Logique Gmail : construction de requête, extraction des pièces jointes,
// nommage des fichiers. Les fonctions pures n'utilisent aucune API Chrome,
// ce qui permet de les tester avec Node (voir tests/).

export const API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// ---------------------------------------------------------------------------
// Vue Gmail -> requête de recherche
// ---------------------------------------------------------------------------

export function parseExtensions(text) {
  return (text || '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().replace(/^\*?\./, '').toLowerCase())
    .filter(Boolean);
}

const decodeHashPart = (s) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
};

// Nom de libellé tel que la recherche Gmail l'attend : "Mes Factures/2024" -> "mes-factures-2024".
export const labelToken = (name) => name.trim().toLowerCase().replace(/[\s/&]+/g, '-');

const VIEW_QUERIES = {
  inbox: 'in:inbox',
  starred: 'is:starred',
  snoozed: 'is:snoozed',
  imp: 'is:important',
  sent: 'in:sent',
  scheduled: 'in:scheduled',
  drafts: 'in:drafts',
  all: '',
  spam: 'in:spam',
  trash: 'in:trash',
};

const SUBSET_QUERIES = {
  all: '',
  mail: '',
  inbox: 'in:inbox',
  read: 'is:read',
  unread: 'is:unread',
  starred: 'is:starred',
  sent: 'in:sent',
  drafts: 'in:drafts',
  spam: 'in:spam',
  trash: 'in:trash',
  chats: 'is:chat',
};

const WITHIN_DAYS = { '1d': 1, '3d': 3, '1w': 7, '2w': 14, '1m': 31, '2m': 62, '6m': 183, '1y': 365 };
const SIZE_UNITS = { s_smb: 'M', s_skb: 'K', s_sb: '' };

// Formulaire « Recherche avancée » de Gmail (#advanced-search/from=...&query=...).
function advancedSearchQuery(p) {
  const parts = [];
  if (p.get('from')) parts.push(`from:(${p.get('from')})`);
  if (p.get('to')) parts.push(`to:(${p.get('to')})`);
  if (p.get('subject')) parts.push(`subject:(${p.get('subject')})`);
  if (p.get('query')) parts.push(p.get('query'));
  if (p.get('hasnot')) parts.push(`-{${p.get('hasnot')}}`);
  const subset = p.get('subset');
  if (subset) parts.push(subset in SUBSET_QUERIES ? SUBSET_QUERIES[subset] : `label:${labelToken(subset)}`);
  if (p.get('size') && p.get('sizeoperator')) {
    const op = p.get('sizeoperator') === 's_ss' ? 'smaller' : 'larger';
    parts.push(`${op}:${p.get('size')}${SIZE_UNITS[p.get('sizeunit')] ?? 'M'}`);
  }
  // « Date à moins de 1 semaine du 15/03/2024 » -> intervalle autour de la date.
  const days = WITHIN_DAYS[p.get('within')];
  const date = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(p.get('date') || '');
  if (days && date) {
    const center = new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
    const fmt = (d) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    const shift = (n) => new Date(center.getFullYear(), center.getMonth(), center.getDate() + n);
    parts.push(`after:${fmt(shift(-days))} before:${fmt(shift(days + 1))}`);
  }
  return parts.filter(Boolean).join(' ');
}

// Traduit l'adresse de la vue Gmail (partie après #) en requête de recherche.
// Le dernier segment éventuel (identifiant d'une conversation ouverte) est ignoré.
export function queryFromGmailHash(hash) {
  const [view = '', first = ''] = (hash || '').replace(/^#/, '').split('/');
  switch (view) {
    case 'search':
      return decodeHashPart(first);
    case 'advanced-search':
      return advancedSearchQuery(new URLSearchParams(first));
    case 'label':
      return `label:${labelToken(decodeHashPart(first))}`;
    case 'category':
      return `category:${first}`;
    default:
      return VIEW_QUERIES[view] ?? '';
  }
}

// ---------------------------------------------------------------------------
// Lecture de la page Gmail
// ---------------------------------------------------------------------------

// Injectée dans l'onglet Gmail par chrome.scripting.executeScript : elle doit rester
// autonome (aucune référence extérieure). Repères du DOM de Gmail utilisés :
//   tr.zA                                ligne de la liste
//   [role=checkbox][aria-checked=true]   case cochée
//   [data-legacy-thread-id]              identifiant de conversation (= threadId de l'API)
//   h2.hP[data-legacy-thread-id]         objet d'une conversation ouverte
export function readGmailSelection() {
  const isVisible = (el) => Boolean(el && el.offsetParent !== null);
  const main = [...document.querySelectorAll('div[role=main]')].find(isVisible) || document.body;
  const email = (document.title.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [''])[0];
  const base = { hash: location.hash, accountEmail: email, url: location.href };

  const rows = [...main.querySelectorAll('tr.zA')].filter(isVisible);
  const checked = rows.filter((r) => r.querySelector('[role=checkbox]')?.getAttribute('aria-checked') === 'true');
  const threadIds = [
    ...new Set(checked.map((r) => r.querySelector('[data-legacy-thread-id]')?.getAttribute('data-legacy-thread-id')).filter(Boolean)),
  ];

  if (checked.length) {
    // Après « Sélectionner les N conversations correspondant à cette recherche »,
    // Gmail affiche un lien « Effacer la sélection » au-dessus de la liste.
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let banner = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (/^(Effacer la sélection|Clear selection)$/i.test(n.textContent.trim()) && isVisible(n.parentElement)) {
        banner = n.parentElement.parentElement;
        break;
      }
    }
    if (banner && checked.length === rows.length) {
      const count = (banner.textContent.match(/(\d[\d\s  .,]*)\s+conversations?/i) || [])[1];
      return { ...base, kind: 'all', threadIds, total: count ? Number(count.replace(/\D/g, '')) : null };
    }
    return { ...base, kind: 'selection', threadIds };
  }

  const opened = [...main.querySelectorAll('h2[data-legacy-thread-id]')].find(isVisible);
  if (opened) {
    return { ...base, kind: 'thread', threadIds: [opened.getAttribute('data-legacy-thread-id')], subject: opened.textContent.trim() };
  }
  return { ...base, kind: 'none', threadIds: [], visibleCount: rows.length };
}

// ---------------------------------------------------------------------------
// Analyse d'un message
// ---------------------------------------------------------------------------

function header(headers, name) {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

export function parseSender(from) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from || '');
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() };
  const email = (from || '').trim().toLowerCase();
  return { name: email, email };
}

function isInline(part) {
  const disp = header(part.headers, 'Content-Disposition').toLowerCase();
  if (disp.startsWith('attachment')) return false;
  if (disp.startsWith('inline')) return true;
  return Boolean(header(part.headers, 'Content-ID'));
}

export function extensionOf(filename) {
  const i = filename.lastIndexOf('.');
  return i > 0 ? filename.slice(i + 1).toLowerCase() : '';
}

// Renvoie la liste des pièces jointes d'un message (format=full).
export function extractAttachments(message, opts = {}) {
  const { includeInline = false, extensions = [] } = opts;
  const headers = message.payload?.headers || [];
  const sender = parseSender(header(headers, 'From'));
  const meta = {
    messageId: message.id,
    threadId: message.threadId,
    date: new Date(Number(message.internalDate)),
    subject: header(headers, 'Subject') || '(sans objet)',
    fromName: sender.name,
    fromEmail: sender.email,
  };

  const out = [];
  const walk = (part) => {
    if (!part) return;
    const body = part.body || {};
    if (part.filename && (body.attachmentId || body.data)) {
      const inline = isInline(part);
      const ext = extensionOf(part.filename);
      const extOk = !extensions.length || extensions.includes(ext);
      if ((includeInline || !inline) && extOk) {
        out.push({
          ...meta,
          partId: part.partId,
          attachmentId: body.attachmentId || null,
          data: body.attachmentId ? null : body.data,
          filename: part.filename,
          mimeType: part.mimeType,
          size: body.size || 0,
          inline,
        });
      }
    }
    (part.parts || []).forEach(walk);
  };
  walk(message.payload);
  return out;
}

export function b64urlToBytes(s) {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad) b64 += '='.repeat(4 - pad);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// Nommage
// ---------------------------------------------------------------------------

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

// Nettoie un segment de chemin pour qu'il soit valide sous Windows, macOS et Linux.
export function sanitize(name, maxLen = 120) {
  let s = String(name || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|~]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (!s) s = 'sans_nom';
  if (WINDOWS_RESERVED.test(s.split('.')[0])) s = `_${s}`;
  if (s.length > maxLen) {
    const ext = extensionOf(s);
    const keep = ext && ext.length < 10 ? `.${ext}` : '';
    s = s.slice(0, maxLen - keep.length).trimEnd() + keep;
  }
  return s;
}

const pad2 = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const ym = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

export function folderFor(att, mode) {
  switch (mode) {
    case 'sender':
      return sanitize(att.fromEmail);
    case 'senderName':
      return sanitize(att.fromName);
    case 'month':
      return ym(att.date);
    case 'date':
      return ymd(att.date);
    case 'type':
      return sanitize(extensionOf(att.filename).toUpperCase() || 'AUTRES');
    case 'email':
      return sanitize(`${ymd(att.date)} - ${att.subject}`, 100);
    default:
      return '';
  }
}

export function fileNameFor(att, mode) {
  const base = sanitize(att.filename);
  switch (mode) {
    case 'date':
      return `${ymd(att.date)}_${base}`;
    case 'sender':
      return `${sanitize(att.fromEmail, 60)}_${base}`;
    case 'dateSender':
      return `${ymd(att.date)}_${sanitize(att.fromEmail, 60)}_${base}`;
    default:
      return base;
  }
}

// Attribue des chemins uniques (insensibles à la casse) en ajoutant " (2)", " (3)"...
export class PathAllocator {
  constructor() {
    this.used = new Set();
  }
  allocate(path) {
    let candidate = path;
    const slash = path.lastIndexOf('/');
    const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
    const file = path.slice(slash + 1);
    const dot = file.lastIndexOf('.');
    const stem = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot) : '';
    for (let n = 2; this.used.has(candidate.toLowerCase()); n++) {
      candidate = `${dir}${stem} (${n})${ext}`;
    }
    this.used.add(candidate.toLowerCase());
    return candidate;
  }
}

export function buildPath(att, { folderMode, fileMode }) {
  const folder = folderFor(att, folderMode);
  const file = fileNameFor(att, fileMode);
  return folder ? `${folder}/${file}` : file;
}

// Clé de doublon : même nom et même taille (fichier transféré plusieurs fois).
export const duplicateKey = (att) => `${att.filename.toLowerCase()}|${att.size}`;

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  const units = ['Ko', 'Mo', 'Go'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0).replace('.', ',')} ${units[i]}`;
}

export function toCsv(rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Point-virgule + BOM : Excel en français ouvre le fichier correctement.
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
}

// ---------------------------------------------------------------------------
// Utilitaires d'exécution
// ---------------------------------------------------------------------------

// Exécute fn sur chaque élément avec au plus `limit` appels simultanés.
export async function pool(items, limit, fn, signal) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Annulé', 'AbortError'));
    });
  });

// ---------------------------------------------------------------------------
// Client API Gmail
// ---------------------------------------------------------------------------

export class GmailClient {
  // getToken(interactive) -> Promise<string> ; dropToken(token) -> Promise<void>
  constructor({ getToken, dropToken }) {
    this.getToken = getToken;
    this.dropToken = dropToken;
    this.token = null;
  }

  async request(path, params = {}, signal) {
    const url = new URL(API_BASE + path);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      (Array.isArray(v) ? v : [v]).forEach((x) => url.searchParams.append(k, x));
    }
    for (let attempt = 0; ; attempt++) {
      if (!this.token) this.token = await this.getToken(false);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` }, signal });
      if (res.ok) return res.json();
      if (res.status === 401 && attempt < 2) {
        await this.dropToken(this.token);
        this.token = null;
        continue;
      }
      // 429 et 5xx : quota ou incident temporaire, on réessaie avec un délai croissant.
      if ((res.status === 429 || res.status >= 500 || res.status === 403) && attempt < 6) {
        const body = await res.text();
        if (res.status === 403 && !/rate|quota/i.test(body)) throw new Error(`Gmail 403 : ${body}`);
        await sleep(Math.min(32000, 1000 * 2 ** attempt) + Math.random() * 500, signal);
        continue;
      }
      throw new Error(`Gmail ${res.status} : ${await res.text()}`);
    }
  }

  profile() {
    return this.request('/profile');
  }

  async labels() {
    const { labels = [] } = await this.request('/labels');
    return labels;
  }

  // Liste les identifiants de messages correspondant à la requête.
  async listMessageIds({ q, labelIds, includeSpamTrash, max }, onProgress, signal) {
    const ids = [];
    let pageToken;
    do {
      const r = await this.request(
        '/messages',
        { q, labelIds, includeSpamTrash, maxResults: Math.min(500, max - ids.length), pageToken },
        signal,
      );
      (r.messages || []).forEach((m) => ids.push(m.id));
      pageToken = r.nextPageToken;
      onProgress?.(ids.length);
    } while (pageToken && ids.length < max);
    return ids;
  }

  message(id, signal) {
    return this.request(`/messages/${id}`, { format: 'full' }, signal);
  }

  // Conversation complète : tous ses messages, au format full.
  thread(id, signal) {
    return this.request(`/threads/${id}`, { format: 'full' }, signal);
  }

  async attachmentBytes(att, signal) {
    if (att.data) return b64urlToBytes(att.data);
    const r = await this.request(`/messages/${att.messageId}/attachments/${att.attachmentId}`, {}, signal);
    return b64urlToBytes(r.data);
  }
}
