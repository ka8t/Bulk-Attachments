// Test de bout en bout : charge la vraie page app.html dans Chrome (headless),
// avec les API chrome.* et Gmail simulées.
// Lancer avec : npm install && npm run test:e2e   (nécessite Google Chrome installé)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import JSZip from 'jszip';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(os.tmpdir(), 'bulk-attachments-e2e');
const OUT = path.join(WORK, 'downloads');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: Boolean(cond) });
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
};

// --- Serveur statique de l'extension ---------------------------------------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(EXT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(EXT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }).end(fs.readFileSync(p));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// --- Fausse boîte Gmail ----------------------------------------------------
const b64url = (s) => Buffer.from(s).toString('base64url');
const day = (d) => String(new Date(d).getTime());
const H = (from, subject) => [{ name: 'From', value: from }, { name: 'Subject', value: subject }];
const att = (partId, filename, id, size, headers = [{ name: 'Content-Disposition', value: 'attachment' }]) => ({
  partId, filename, mimeType: 'application/octet-stream', headers, body: { attachmentId: id, size },
});
const messages = {
  m1: { id: 'm1', threadId: 't1', internalDate: day('2024-03-15T10:00'), payload: { headers: H('Le Patron <boss@x.fr>', 'Facture mars'), parts: [
    { partId: '0', mimeType: 'text/html', filename: '', body: { size: 10, data: b64url('<b>hi</b>') } },
    att('1', 'facture.pdf', 'A1', 17),
    att('2', 'logo.png', 'A2', 9, [{ name: 'Content-ID', value: '<logo>' }]),
  ] } },
  m2: { id: 'm2', threadId: 't2', internalDate: day('2024-04-02T09:00'), payload: { headers: H('boss@x.fr', 'TR: Facture mars'), parts: [
    att('1', 'facture.pdf', 'A3', 17),
    att('2', 'photo.jpg', 'A4', 30 * 1024 * 1024),
  ] } },
  m3: { id: 'm3', threadId: 't3', internalDate: day('2024-04-20T18:00'), payload: { headers: H('"Durand, Anne" <anne@y.fr>', 'Rapport / version finale'), parts: [
    att('1', 'rapport:final?.docx', 'A5', 40 * 1024 * 1024),
  ] } },
  m4: { id: 'm4', threadId: 't4', internalDate: day('2024-05-01T08:00'), payload: { headers: H('anne@y.fr', 'Export'), parts: [
    { partId: '1', filename: 'data.csv', mimeType: 'text/csv', headers: [], body: { size: 5, data: b64url('a;b;c') } },
    att('2', 'casse.pdf', 'BROKEN', 30),
  ] } },
};
const attContent = { A1: 'contenu facture A1', A3: 'contenu facture A1', A4: 'contenu photo A4', A5: 'contenu rapport A5', A2: 'logo' };
const apiLog = [];

function gmailResponse(url) {
  const u = new URL(url);
  const p = u.pathname.replace('/gmail/v1/users/me', '');
  apiLog.push(p + u.search);
  if (p === '/profile') return [200, { emailAddress: 'test@example.com', messagesTotal: 4321 }];
  if (p === '/labels') return [200, { labels: [{ id: 'INBOX', type: 'system', name: 'INBOX' }, { id: 'Label_1', type: 'user', name: 'Factures' }, { id: 'CHAT', type: 'system', name: 'CHAT' }] }];
  if (p === '/messages') {
    return u.searchParams.get('pageToken')
      ? [200, { messages: [{ id: 'm3' }, { id: 'm4' }] }]
      : [200, { messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'p2' }];
  }
  let m = /^\/messages\/(\w+)$/.exec(p);
  if (m) return [200, messages[m[1]]];
  m = /^\/messages\/(\w+)\/attachments\/(\w+)$/.exec(p);
  if (m) return m[2] in attContent ? [200, { size: 1, data: b64url(attContent[m[2]]) }] : [404, { error: { code: 404, message: 'Not Found' } }];
  return [404, {}];
}

// --- Navigateur ------------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: path.join(WORK, 'profile'),
  args: ['--no-first-run', '--window-size=1400,1000'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
// les 404 de la pièce jointe volontairement cassée (BROKEN) sont attendues
page.on('console', (m) => m.type() === 'error' && !m.location()?.url?.includes('/attachments/BROKEN') && consoleErrors.push(`${m.text()} ${m.location()?.url}`));

const saved = [];
await page.exposeFunction('__saveDownload', (filename, b64) => {
  const dest = path.join(OUT, filename);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
  saved.push(filename);
});

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
await page.evaluateOnNewDocument((manifest) => {
  // stockage simulé persistant entre rechargements (comme chrome.storage.local)
  const store = new Proxy({}, {
    get: (_, k) => JSON.parse(localStorage.getItem(`s:${String(k)}`) ?? 'null'),
    set: (_, k, v) => (localStorage.setItem(`s:${String(k)}`, JSON.stringify(v)), true),
    has: (_, k) => localStorage.getItem(`s:${String(k)}`) !== null,
  });
  const listeners = [];
  let nextId = 1;
  window.chrome = {
    runtime: { id: 'dbangjhmkaaijopbjedmcpjnnhndngfl', getManifest: () => manifest },
    identity: {
      getAuthToken: async () => ({ token: 'fake-token' }),
      removeCachedAuthToken: async () => {},
      clearAllCachedAuthTokens: async () => {},
    },
    storage: { local: {
      get: async (k) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
      set: async (o) => Object.assign(store, structuredClone(o)),
    } },
    downloads: {
      onChanged: { addListener: (f) => listeners.push(f), removeListener: (f) => listeners.splice(listeners.indexOf(f), 1) },
      download: async ({ url, filename }) => {
        if (filename.split('/').some((s) => s === '..' || /[<>:"|?*\\]/.test(s))) throw new Error('Invalid filename');
        const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        await window.__saveDownload(filename, btoa(bin));
        const id = nextId++;
        setTimeout(() => [...listeners].forEach((f) => f({ id, state: { current: 'complete' } })), 10);
        return id;
      },
    },
  };
}, manifest);

await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = req.url();
  if (!url.startsWith('https://gmail.googleapis.com/') && !url.startsWith('https://oauth2.googleapis.com/')) return req.continue();
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization', 'Access-Control-Allow-Methods': 'GET,POST' };
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
  if (url.startsWith('https://oauth2')) return req.respond({ status: 200, headers: cors, body: '{}' });
  const auth = req.headers().authorization;
  if (auth !== 'Bearer fake-token') return req.respond({ status: 401, headers: cors, body: '{}' });
  const [status, body] = gmailResponse(url);
  req.respond({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
});

const text = (sel) => page.$eval(sel, (e) => e.textContent.trim());
const visible = (sel) => page.$eval(sel, (e) => !e.hidden && e.offsetParent !== null);
const waitIdle = () => page.waitForFunction(() => document.querySelector('#progressBar').hidden, { timeout: 30000 });

// 1. Démarrage + connexion silencieuse
await page.goto(`${base}/app.html?q=${encodeURIComponent('is:starred')}`);
await page.waitForFunction(() => document.querySelector('#accountEmail').textContent.includes('@'), { timeout: 10000 });
check('Connexion et profil affichés', (await text('#accountEmail')).includes('test@example.com'), await text('#accountEmail'));
check('Bannière de configuration masquée (client_id renseigné)', !(await visible('#setupBanner')));
const labelOpts = await page.$$eval('select[name=label] option', (os) => os.map((o) => o.textContent));
check('Libellés chargés (système traduits, CHAT ignoré)', labelOpts.join('|') === 'Tous les e-mails|Boîte de réception|Factures', labelOpts.join('|'));
check('Recherche Gmail reprise depuis ?q=', (await page.$eval('input[name=raw]', (e) => e.value)) === 'is:starred');

// 2. Recherche
await page.type('input[name=from]', 'boss@x.fr');
await page.$eval('input[name=after]', (e) => { e.value = '2024-01-01'; e.dispatchEvent(new Event('input', { bubbles: true })); });
await page.select('select[name=label]', 'Label_1');
const preview = await text('#queryPreview');
check('Aperçu de la requête', /^has:attachment from:\(boss@x\.fr\) after:\d+ is:starred$/.test(preview), preview);
await page.click('#btnSearch');
await page.waitForFunction(() => !document.querySelector('#resultsCard').hidden, { timeout: 15000 });
await waitIdle();
const listCall = apiLog.find((l) => l.startsWith('/messages?'));
const listParams = new URLSearchParams(listCall.split('?')[1]);
check('Appel messages.list avec la requête et le libellé', listParams.get('q') === preview && listParams.get('labelIds') === 'Label_1', listCall);
check('Pagination suivie (2 pages)', apiLog.filter((l) => l.startsWith('/messages?')).length === 2);
const rows = await page.$$eval('#rows tr', (trs) => trs.map((tr) => ({
  file: tr.querySelector('.c-file').textContent, checked: tr.querySelector('input').checked,
})));
check('6 pièces jointes trouvées, image intégrée exclue', rows.length === 6 && !rows.some((r) => r.file.startsWith('logo')), rows.map((r) => r.file).join(', '));
const dupRows = rows.filter((r) => r.file.includes('doublon'));
check('Doublon détecté et décoché (copie la plus récente)', dupRows.length === 1 && !dupRows[0].checked);
check('Tri par date décroissante', rows[0].file.startsWith('data.csv') || rows[0].file.startsWith('casse.pdf'));
const stats = await text('#stats');
check('Statistiques', stats.includes('4 e-mails') && stats.includes('6 pièces jointes') && stats.includes('5 sélectionnées'), stats);
check('Aucune bannière d\'erreur après recherche', !(await visible('#errorBanner')));

// 3. Filtre texte + cases
await page.type('#filterText', 'anne');
const filtered = await page.$$eval('#rows tr', (t) => t.length);
check('Filtre texte', filtered === 3, `${filtered} lignes`);
await page.click('#btnSelectNone');
check('Tout décocher (lignes filtrées seulement)', (await text('#stats')).includes('2 sélectionnées'), await text('#stats'));
await page.click('#btnSelectAll');
await page.$eval('#filterText', (e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
check('Tout cocher', (await text('#stats')).includes('5 sélectionnées'), await text('#stats'));
await page.screenshot({ path: path.join(WORK, 'capture.png'), fullPage: true });

// 4. Téléchargement ZIP, rangé par expéditeur, avec index
await page.select('select[name=format]', 'zip');
await page.select('select[name=folderMode]', 'sender');
await page.select('select[name=fileMode]', 'original');
await page.$eval('input[name=baseName]', (e) => { e.value = 'TestZip'; });
await page.click('#btnDownload');
await page.waitForFunction(() => document.querySelector('#progressLabel').textContent.startsWith('Terminé'), { timeout: 30000 });
await waitIdle();
check('ZIP enregistré', saved.includes('TestZip.zip'), saved.join(', '));
const zip = await JSZip.loadAsync(fs.readFileSync(path.join(OUT, 'TestZip.zip')));
const entries = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
const expected = ['anne@y.fr/data.csv', 'anne@y.fr/rapport_final_.docx', 'boss@x.fr/facture.pdf', 'boss@x.fr/photo.jpg', 'index.csv'];
check('Contenu du ZIP (dossiers + noms nettoyés, échec exclu)', JSON.stringify(entries) === JSON.stringify(expected), entries.join(', '));
check('Contenu binaire correct', (await zip.file('boss@x.fr/facture.pdf').async('string')) === 'contenu facture A1'
  && (await zip.file('anne@y.fr/data.csv').async('string')) === 'a;b;c');
check('Date du fichier = date de l\'e-mail', zip.file('boss@x.fr/facture.pdf').date.getMonth() === 2);
const idx = await zip.file('index.csv').async('string');
check('Index CSV : BOM, échec signalé, lien Gmail', idx.startsWith('﻿') && /casse\.pdf.*Échec/.test(idx) && idx.includes('mail.google.com/mail/?authuser=test%40example.com#all/t1'));
const err = (await visible('#errorBanner')) ? await text('#errorBanner') : '';
check('Échec signalé à l\'utilisateur', err.includes('casse.pdf'), err.split('\n')[0]);

// 5. Fichiers séparés, rangés par mois, nom préfixé par la date
await page.select('select[name=format]', 'files');
check('Champs ZIP masqués en mode fichiers', !(await visible('input[name=maxZipMB]')));
await page.select('select[name=folderMode]', 'month');
await page.select('select[name=fileMode]', 'date');
await page.$eval('input[name=baseName]', (e) => { e.value = 'TestFiles'; });
saved.length = 0;
await page.click('#btnDownload');
await page.waitForFunction(() => document.querySelector('#progressLabel').textContent.startsWith('Terminé'), { timeout: 30000 });
await waitIdle();
const files = saved.slice().sort();
const expFiles = ['TestFiles/2024-03/2024-03-15_facture.pdf', 'TestFiles/2024-04/2024-04-02_photo.jpg', 'TestFiles/2024-04/2024-04-20_rapport_final_.docx', 'TestFiles/2024-05/2024-05-01_data.csv', 'TestFiles/index.csv'];
check('Fichiers séparés enregistrés', JSON.stringify(files) === JSON.stringify(expFiles), files.join(', '));

// 6. Découpage en plusieurs ZIP (tailles déclarées : rapport 40 Mo, photo 30 Mo)
await page.select('select[name=format]', 'zip');
await page.select('select[name=folderMode]', 'none');
await page.select('select[name=fileMode]', 'original');
await page.$eval('input[name=baseName]', (e) => { e.value = 'TestSplit'; });
await page.$eval('input[name=maxZipMB]', (e) => { e.value = '50'; });
saved.length = 0;
await page.click('#btnDownload');
await page.waitForFunction(() => document.querySelector('#progressLabel').textContent.startsWith('Terminé'), { timeout: 30000 });
await waitIdle();
check('Découpage en 2 ZIP', JSON.stringify(saved.slice().sort()) === JSON.stringify(['TestSplit_partie-1-sur-2.zip', 'TestSplit_partie-2-sur-2.zip']), saved.join(', '));
let total = 0;
for (const z of saved) total += Object.keys((await JSZip.loadAsync(fs.readFileSync(path.join(OUT, z)))).files).filter((n) => n !== 'index.csv').length;
check('Tous les fichiers répartis entre les parties', total === 4, String(total));
saved.length = 0;

// 7. Export CSV de la liste
await page.click('#btnExportCsv');
await new Promise((r) => setTimeout(r, 500));
const csvName = saved.find((s) => s.startsWith('Gmail-liste'));
const csv = csvName ? fs.readFileSync(path.join(OUT, csvName), 'utf8') : '';
check('Export CSV de la liste', csv.split('\r\n').length === 6 && csv.includes('Expéditeur'), csvName);

// 8. Persistance des réglages
await page.reload();
await page.waitForFunction(() => document.querySelector('#accountEmail').textContent.includes('@'));
const persisted = await page.evaluate(() => ({
  from: document.querySelector('input[name=from]').value,
  label: document.querySelector('select[name=label]').value,
  folder: document.querySelector('select[name=folderMode]').value,
}));
check('Réglages conservés après rechargement', persisted.from === 'boss@x.fr' && persisted.label === 'Label_1' && persisted.folder === 'none', JSON.stringify(persisted));

// 9. Déconnexion
await page.click('#btnDisconnect');
await page.waitForFunction(() => document.querySelector('#accountEmail').textContent === 'Non connecté');
check('Déconnexion', !(await visible('#btnDisconnect')) && (await visible('#btnConnect')));

check('Aucune erreur JavaScript dans la console', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications réussies`);
process.exit(failed ? 1 : 0);
