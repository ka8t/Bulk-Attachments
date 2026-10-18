// Test de bout en bout de la vraie extension, chargée dans Google Chrome (headless) :
// fausse page Gmail (structure du DOM relevée sur Gmail), API Gmail simulée dans le
// moteur hors écran, jeton OAuth simulé dans le service d'arrière-plan, vrais
// téléchargements Chrome.
// Lancer avec : npm install && npm run test:e2e   (Google Chrome doit être installé)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import JSZip from 'jszip';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(os.tmpdir(), 'bulk-attachments-e2e');
const OUT = path.join(WORK, 'downloads');
const PROFILE = path.join(WORK, 'profile');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ID = 'dbangjhmkaaijopbjedmcpjnnhndngfl';

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(path.join(PROFILE, 'Default'), { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
// Dossier de téléchargement du profil de test, sans fenêtre de confirmation.
fs.writeFileSync(
  path.join(PROFILE, 'Default', 'Preferences'),
  JSON.stringify({ download: { default_directory: OUT, prompt_for_download: false, directory_upgrade: true } }),
);

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: Boolean(cond) });
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForFiles(names, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (names.every((n) => fs.existsSync(path.join(OUT, n)))) return true;
    await sleep(200);
  }
  return false;
}
const listOut = (dir = OUT, prefix = '') =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listOut(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  );

// --- Fausse boîte Gmail (servie par le fetch simulé du moteur) ---------------
const b64url = (s) => Buffer.from(s).toString('base64url');
const day = (d) => String(new Date(d).getTime());
const H = (from, subject) => [{ name: 'From', value: from }, { name: 'Subject', value: subject }];
const att = (partId, filename, id, size, headers = [{ name: 'Content-Disposition', value: 'attachment' }]) => ({
  partId, filename, mimeType: 'application/octet-stream', headers, body: { attachmentId: id, size },
});
const MB = 1024 * 1024;
const messages = {
  m1: { id: 'm1', threadId: 't1', internalDate: day('2024-03-15T10:00'), payload: { headers: H('Le Patron <boss@x.fr>', 'Facture mars'), parts: [
    { partId: '0', mimeType: 'text/html', filename: '', body: { size: 10, data: b64url('<b>hi</b>') } },
    att('1', 'facture.pdf', 'A1', 17),
    att('2', 'logo.png', 'A2', 9, [{ name: 'Content-ID', value: '<logo>' }]),
  ] } },
  m2: { id: 'm2', threadId: 't2', internalDate: day('2024-04-02T09:00'), payload: { headers: H('boss@x.fr', 'TR: Facture mars'), parts: [
    att('1', 'facture.pdf', 'A3', 17),
    att('2', 'photo.jpg', 'A4', 30 * MB),
  ] } },
  m3: { id: 'm3', threadId: 't3', internalDate: day('2024-04-20T18:00'), payload: { headers: H('"Durand, Anne" <anne@y.fr>', 'Rapport / version finale'), parts: [
    att('1', 'rapport:final?.docx', 'A5', 40 * MB),
  ] } },
  m4: { id: 'm4', threadId: 't4', internalDate: day('2024-05-01T08:00'), payload: { headers: H('anne@y.fr', 'Export'), parts: [
    { partId: '1', filename: 'data.csv', mimeType: 'text/csv', headers: [], body: { size: 5, data: b64url('a;b;c') } },
    att('2', 'casse.pdf', 'BROKEN', 30),
  ] } },
};
const threads = { t1: ['m1'], t2: ['m2'], t3: ['m3'], t4: ['m4'] };
const attContent = { A1: 'contenu facture A1', A3: 'contenu facture A1', A4: 'contenu photo A4', A5: 'contenu rapport A5', A2: 'logo' };

// Installé dans le document hors écran : remplace fetch pour gmail.googleapis.com.
function installFakeGmail({ messages, threads, attContent, profileEmail }) {
  const realFetch = globalThis.fetch;
  globalThis.__apiLog = [];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const b64 = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.host !== 'gmail.googleapis.com') return realFetch(input, init);
    if (init?.headers?.Authorization !== 'Bearer fake-token') return json(401, {});
    const p = url.pathname.replace('/gmail/v1/users/me', '');
    globalThis.__apiLog.push(p + url.search);
    if (p === '/profile') return json(200, { emailAddress: profileEmail, messagesTotal: 4321 });
    if (p === '/messages') {
      return url.searchParams.get('pageToken')
        ? json(200, { messages: [{ id: 'm3' }, { id: 'm4' }] })
        : json(200, { messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'p2' });
    }
    let m = /^\/threads\/(\w+)$/.exec(p);
    if (m) return json(200, { id: m[1], messages: threads[m[1]].map((id) => messages[id]) });
    m = /^\/messages\/(\w+)$/.exec(p);
    if (m) return json(200, messages[m[1]]);
    m = /^\/messages\/(\w+)\/attachments\/(\w+)$/.exec(p);
    if (m) return m[2] in attContent ? json(200, { size: 1, data: b64(attContent[m[2]]) }) : json(404, { error: { code: 404 } });
    return json(404, {});
  };
}

// --- Fausse page Gmail (classes et attributs relevés sur la vraie interface) --
const GMAIL_URL = 'https://mail.google.com/mail/u/0/#advanced-search/attach_or_drive=true&query=facture+after%3A2022%2F01%2F01&isrefinement=true';
const row = (id, subject) =>
  `<tr class="zA yO"><td class="oZ-x3 xY aid"><div role="checkbox" aria-checked="false"></div></td>` +
  `<td><span data-thread-id="#thread-f:${id}" data-legacy-thread-id="${id}">${subject}</span></td></tr>`;
const GMAIL_HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>Résultats de recherche - test@example.com - Gmail</title></head><body>
<div role="main">
  <div gh="mtb"><div role="checkbox" aria-checked="false"></div></div>
  <div id="banner" style="display:none"><span>Les 4 conversations correspondant à cette recherche sont sélectionnées.</span> <span role="link">Effacer la sélection</span></div>
  <table class="F" id="list"><tbody>${row('t1', 'Facture mars')}${row('t2', 'TR: Facture mars')}${row('t3', 'Rapport')}${row('t4', 'Export')}</tbody></table>
  <h2 class="hP" data-legacy-thread-id="t3" style="display:none">Rapport / version finale</h2>
</div></body></html>`;

// --- Navigateur --------------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  pipe: true,
  enableExtensions: true,
  userDataDir: PROFILE,
  args: ['--no-first-run'],
});
const extId = await browser.installExtension(EXT);
check('Extension chargée avec l\'ID attendu', extId === ID, extId);

const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(ID));
const sw = await swTarget.worker();
const errors = [];
sw.on('console', (m) => m.type() === 'error' && errors.push(`sw: ${m.text()}`));

// Jeton simulé : refusé en mode silencieux tant que l'utilisateur n'a pas cliqué « Se connecter ».
await sw.evaluate(() => {
  globalThis.__granted = false;
  chrome.identity.getAuthToken = async ({ interactive }) => {
    if (!interactive && !globalThis.__granted) throw new Error('OAuth2 not granted or revoked.');
    globalThis.__granted = true;
    return { token: 'fake-token' };
  };
  chrome.identity.removeCachedAuthToken = async () => {};
  chrome.identity.clearAllCachedAuthTokens = async () => {
    globalThis.__granted = false;
  };
});

// Moteur hors écran créé d'avance pour y installer la fausse API avant toute requête.
await sw.evaluate(() => ensureOffscreen());
const offTarget = await browser.waitForTarget((t) => t.url().endsWith('/offscreen.html'));
const off = await offTarget.asPage();
off.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(`offscreen: ${m.text()}`));
off.on('pageerror', (e) => errors.push(`offscreen: ${e}`));
await off.evaluate(installFakeGmail, { messages, threads, attContent, profileEmail: 'test@example.com' });
const apiLog = () => off.evaluate(() => globalThis.__apiLog.slice());

// Onglet Gmail simulé.
const gmail = await browser.newPage();
await gmail.setRequestInterception(true);
gmail.on('request', (req) =>
  req.url().startsWith('https://mail.google.com/')
    ? req.respond({ status: 200, contentType: 'text/html', body: GMAIL_HTML })
    : req.continue(),
);
await gmail.goto(GMAIL_URL);
const gmailTabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://mail.google.com/*' }))[0].id);

const setGmail = (fn, ...args) => gmail.evaluate(fn, ...args);
const checkRows = (ids) =>
  setGmail((ids) => {
    document.querySelectorAll('tr.zA').forEach((tr) => {
      const id = tr.querySelector('[data-legacy-thread-id]').getAttribute('data-legacy-thread-id');
      const on = ids.includes(id);
      tr.querySelector('[role=checkbox]').setAttribute('aria-checked', String(on));
      tr.classList.toggle('x7', on);
    });
  }, ids);

let popup = null;
async function openPopup(tabId = gmailTabId) {
  if (popup && !popup.isClosed()) await popup.close();
  popup = await browser.newPage();
  await popup.setViewport({ width: 460, height: 640 });
  popup.on('pageerror', (e) => errors.push(`popup: ${e}`));
  popup.on('console', (m) => m.type() === 'error' && errors.push(`popup: ${m.text()}`));
  await popup.goto(`chrome-extension://${ID}/popup.html?tab=${tabId}`);
  return popup;
}
const text = (sel) => popup.$eval(sel, (e) => e.textContent.trim());
const isShown = (sel) => popup.$eval(sel, (e) => !e.hidden && e.offsetParent !== null);
const waitShown = (sel, timeout = 15000) =>
  popup.waitForFunction((s) => { const e = document.querySelector(s); return e && !e.hidden && e.offsetParent !== null; }, { timeout }, sel);
const rowNames = () => popup.$$eval('#rows li', (lis) => lis.map((li) => ({
  name: li.querySelector('.name span').textContent, checked: li.querySelector('input').checked,
})));
async function setOption(name, value) {
  const opened = await popup.$eval('#options', (d) => d.open);
  if (!opened) await popup.click('#options summary');
  await popup.$eval(`[name=${name}]`, (el, v) => {
    if (el.type === 'checkbox') el.checked = v;
    else el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
const waitDone = () => waitShown('#result', 30000);

// 1. Pas encore autorisé : la popup propose la connexion
await checkRows(['t1', 't2']);
await openPopup();
await waitShown('#auth');
check('Sans autorisation : bouton « Se connecter » affiché', await isShown('#btnConnect'));

// 2. Connexion puis analyse automatique de la sélection
await popup.click('#btnConnect');
await waitShown('#list');
check('Sélection lue dans Gmail', (await text('#sourceTitle')) === '2 conversations sélectionnées', await text('#sourceTitle'));
check('Compte affiché', (await text('#account')) === 'test@example.com');
let log = await apiLog();
check('Seules les conversations cochées sont lues', log.filter((l) => l.startsWith('/threads/')).sort().join() === '/threads/t1?format=full,/threads/t2?format=full', log.join(' '));
let rows = await rowNames();
check('3 pièces jointes, image intégrée exclue', rows.length === 3 && !rows.some((r) => r.name.startsWith('logo')), rows.map((r) => r.name).join(', '));
check('Doublon décoché', rows.filter((r) => r.name.includes('doublon')).every((r) => !r.checked));
check('Bouton de téléchargement avec total', (await text('#btnDownload')) === 'Télécharger 2 fichiers (30 Mo)', await text('#btnDownload'));
check('Aucun avertissement de compte', !(await isShown('#warning')));
await popup.screenshot({ path: path.join(WORK, 'popup-selection.png') });

// 3. ZIP rangé par expéditeur
await setOption('format', 'zip');
await setOption('folderMode', 'sender');
await setOption('fileMode', 'original');
await setOption('baseName', 'Selection');
await popup.click('#btnDownload');
await waitDone();
check('ZIP enregistré par Chrome', await waitForFiles(['Selection.zip']));
const zip = await JSZip.loadAsync(fs.readFileSync(path.join(OUT, 'Selection.zip')));
const entries = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
check('Contenu du ZIP', JSON.stringify(entries) === JSON.stringify(['boss@x.fr/facture.pdf', 'boss@x.fr/photo.jpg', 'index.csv']), entries.join(', '));
check('Contenu des fichiers', (await zip.file('boss@x.fr/facture.pdf').async('string')) === 'contenu facture A1');
check('Message de fin', (await text('#result')).startsWith('Terminé : 2 fichiers enregistrés'), (await text('#result')).split('\n')[0]);
check('Badge « OK » sur l\'icône', (await sw.evaluate(() => chrome.action.getBadgeText({}))) === 'OK');

// 4. Réouverture sur la même sélection : résultat conservé, pas de nouvelle analyse
const before = (await apiLog()).length;
await openPopup();
await waitShown('#result');
await sleep(500);
check('Réouverture : état conservé sans nouvelle requête', (await apiLog()).length === before && (await isShown('#list')));

// 5. Conversation ouverte, téléchargement en fichiers séparés
await checkRows([]);
await setGmail(() => {
  document.querySelector('#list').style.display = 'none';
  document.querySelector('h2.hP').style.display = '';
});
await openPopup();
await waitShown('#list');
check('Conversation ouverte détectée', (await text('#sourceTitle')) === 'Conversation ouverte' && (await text('#sourceDetail')) === 'Rapport / version finale');
rows = await rowNames();
check('Pièce jointe de la conversation', rows.length === 1 && rows[0].name === 'rapport:final?.docx');
await setOption('format', 'files');
check('Options ZIP masquées en mode fichiers', !(await isShown('[name=maxZipMB]')));
await setOption('folderMode', 'month');
await setOption('fileMode', 'date');
await setOption('baseName', 'Fichiers');
await popup.click('#btnDownload');
await waitDone();
check('Fichiers séparés enregistrés (nom nettoyé, dossier par mois, index)',
  await waitForFiles(['Fichiers/2024-04/2024-04-20_rapport_final_.docx', 'Fichiers/index.csv']), listOut().filter((f) => f.startsWith('Fichiers')).join(', '));

// 6. Rien de coché : proposition d'analyser la vue, sans analyse automatique
await setGmail(() => {
  document.querySelector('#list').style.display = '';
  document.querySelector('h2.hP').style.display = 'none';
});
await openPopup();
await waitShown('#source');
await sleep(500);
check('Aucune sélection : titre et requête de la vue', (await text('#sourceTitle')) === 'Aucun e-mail coché' && (await text('#sourceDetail')).includes('facture after:2022/01/01'), await text('#sourceDetail'));
check('Pas d\'analyse automatique', !(await isShown('#list')));
await popup.click('#btnScan');
await waitShown('#list');
log = await apiLog();
const listCall = log.find((l) => l.startsWith('/messages?'));
check('Recherche lancée avec la requête de la vue Gmail', new URLSearchParams(listCall.split('?')[1]).get('q') === 'has:attachment facture after:2022/01/01', listCall);
rows = await rowNames();
check('6 pièces jointes sur toute la recherche (pagination suivie)', rows.length === 6, String(rows.length));

// 7. Fermeture de la popup pendant le téléchargement : le travail continue
await setOption('format', 'zip');
await setOption('folderMode', 'none');
await setOption('baseName', 'Arriere-plan');
await setOption('maxZipMB', '50');
await popup.click('#btnDownload');
await popup.close();
check('Popup fermée : les ZIP arrivent quand même (découpage en 2 parties)',
  await waitForFiles(['Arriere-plan_partie-1-sur-2.zip', 'Arriere-plan_partie-2-sur-2.zip'], 30000));
let total = 0;
for (const z of ['Arriere-plan_partie-1-sur-2.zip', 'Arriere-plan_partie-2-sur-2.zip']) {
  total += Object.keys((await JSZip.loadAsync(fs.readFileSync(path.join(OUT, z)))).files).filter((n) => n !== 'index.csv').length;
}
check('Tous les fichiers répartis entre les parties, échec exclu', total === 4, String(total));

// 8. « Toutes les conversations de la recherche » sélectionnées
await checkRows(['t1', 't2', 't3', 't4']);
await setGmail(() => (document.querySelector('#banner').style.display = ''));
await openPopup();
await waitShown('#result');
check('Sélection de toute la recherche détectée', (await text('#sourceTitle')) === 'Les 4 conversations de la recherche', await text('#sourceTitle'));
check('Échec d\'une pièce jointe signalé', (await text('#result')).includes('casse.pdf'));

// 9. Compte Gmail différent du compte autorisé
await setGmail(() => (document.title = 'Boîte de réception - autre@example.com - Gmail'));
await openPopup();
await waitShown('#warning');
check('Avertissement si le compte Gmail diffère', (await text('#warning')).includes('autre@example.com'));

// 10. Onglet qui n'est pas Gmail
// Sans permission sur un site, Chrome masque son adresse : l'onglet est repéré par différence.
const tabIds = () => sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id));
const knownTabs = await tabIds();
const other = await browser.newPage();
await other.goto('https://example.org/');
const otherId = (await tabIds()).find((id) => !knownTabs.includes(id));
await openPopup(otherId);
await waitShown('#notGmail');
check('Hors de Gmail : invitation à ouvrir Gmail', await isShown('#btnOpenGmail'));

// 11. Déconnexion
await openPopup();
await waitShown('#btnSignOut');
await popup.click('#btnSignOut');
await popup.waitForFunction(() => document.querySelector('#account').textContent === '');
check('Déconnexion', !(await isShown('#btnSignOut')));

check('Aucune erreur JavaScript (popup, moteur, arrière-plan)', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications réussies`);
process.exit(failed ? 1 : 0);
