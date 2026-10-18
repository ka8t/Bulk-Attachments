// Logique Gmail : construction de requête, extraction des pièces jointes,
// nommage des fichiers. Les fonctions pures n'utilisent aucune API Chrome,
// ce qui permet de les tester avec Node (voir tests/).

export const API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// ---------------------------------------------------------------------------
// Requête de recherche
// ---------------------------------------------------------------------------

// Convertit "2024-03-15" en secondes epoch à minuit heure locale.
// Gmail accepte after:/before: en secondes epoch, ce qui évite le décalage
// de fuseau horaire des dates au format AAAA/MM/JJ (interprétées en heure du Pacifique).
export function localDayToEpoch(isoDate, addDays = 0) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Math.floor(new Date(y, m - 1, d + addDays).getTime() / 1000);
}

export function parseExtensions(text) {
  return (text || '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().replace(/^\*?\./, '').toLowerCase())
    .filter(Boolean);
}

export function buildQuery(f) {
  const parts = ['has:attachment'];
  if (f.from) parts.push(`from:(${f.from})`);
  if (f.to) parts.push(`to:(${f.to})`);
  if (f.subject) parts.push(`subject:(${f.subject})`);
  if (f.after) parts.push(`after:${localDayToEpoch(f.after)}`);
  // before: est exclusif chez Gmail ; on ajoute un jour pour inclure la date de fin.
  if (f.before) parts.push(`before:${localDayToEpoch(f.before, 1)}`);
  const exts = parseExtensions(f.extensions);
  if (exts.length) parts.push(`{${exts.map((e) => `filename:${e}`).join(' ')}}`);
  if (f.minSizeMB > 0) parts.push(`larger:${f.minSizeMB}M`);
  if (f.raw) parts.push(f.raw.trim());
  return parts.join(' ');
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

  async attachmentBytes(att, signal) {
    if (att.data) return b64urlToBytes(att.data);
    const r = await this.request(`/messages/${att.messageId}/attachments/${att.attachmentId}`, {}, signal);
    return b64urlToBytes(r.data);
  }
}
