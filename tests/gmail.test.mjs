// Lancer avec : node --test tests/gmail.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PathAllocator,
  b64urlToBytes,
  buildPath,
  extractAttachments,
  labelToken,
  parseExtensions,
  parseSender,
  pool,
  queryFromGmailHash,
  sanitize,
  toCsv,
} from '../lib/gmail.js';

const message = {
  id: 'm1',
  threadId: 't1',
  internalDate: String(new Date(2024, 2, 15, 10, 30).getTime()),
  payload: {
    headers: [
      { name: 'From', value: '"Dupont, Jean" <Jean.Dupont@Exemple.fr>' },
      { name: 'Subject', value: 'Facture mars' },
    ],
    parts: [
      { partId: '0', mimeType: 'text/plain', filename: '', body: { size: 12, data: 'aGVsbG8' } },
      {
        partId: '1',
        mimeType: 'application/pdf',
        filename: 'facture.pdf',
        headers: [{ name: 'Content-Disposition', value: 'attachment; filename="facture.pdf"' }],
        body: { size: 2048, attachmentId: 'A1' },
      },
      {
        partId: '2',
        mimeType: 'multipart/related',
        filename: '',
        body: { size: 0 },
        parts: [
          {
            partId: '2.1',
            mimeType: 'image/png',
            filename: 'logo.png',
            headers: [{ name: 'Content-ID', value: '<logo@x>' }],
            body: { size: 300, attachmentId: 'A2' },
          },
          {
            partId: '2.2',
            mimeType: 'text/csv',
            filename: 'export.csv',
            headers: [],
            body: { size: 5, data: 'YSxiLGM' },
          },
        ],
      },
    ],
  },
};

test('extractAttachments ignore les images intégrées par défaut et parcourt les parties imbriquées', () => {
  const atts = extractAttachments(message);
  assert.deepEqual(atts.map((a) => a.filename), ['facture.pdf', 'export.csv']);
  assert.equal(atts[0].fromEmail, 'jean.dupont@exemple.fr');
  assert.equal(atts[0].fromName, 'Dupont, Jean');
  assert.equal(atts[0].attachmentId, 'A1');
  assert.equal(atts[1].data, 'YSxiLGM');
});

test('extractAttachments inclut les images intégrées et filtre par extension sur demande', () => {
  assert.equal(extractAttachments(message, { includeInline: true }).length, 3);
  const pdfOnly = extractAttachments(message, { includeInline: true, extensions: ['pdf'] });
  assert.deepEqual(pdfOnly.map((a) => a.filename), ['facture.pdf']);
});

test('parseSender gère les formats courants', () => {
  assert.deepEqual(parseSender('Marie <marie@x.fr>'), { name: 'Marie', email: 'marie@x.fr' });
  assert.deepEqual(parseSender('solo@x.fr'), { name: 'solo@x.fr', email: 'solo@x.fr' });
  assert.deepEqual(parseSender('<nu@x.fr>'), { name: 'nu@x.fr', email: 'nu@x.fr' });
});

test('queryFromGmailHash traduit la vue Gmail en requête', () => {
  // URL réelle de recherche avancée, avec et sans conversation ouverte
  const adv = '#advanced-search/attach_or_drive=true&query=appels+de+fonds+after%3A2022%2F01%2F01&isrefinement=true';
  assert.equal(queryFromGmailHash(adv), 'appels de fonds after:2022/01/01');
  assert.equal(queryFromGmailHash(`${adv}/FMfcgzQXJWbN`), 'appels de fonds after:2022/01/01');
  assert.equal(queryFromGmailHash('#search/from%3Aboss+facture/FMfcgz'), 'from:boss facture');
  assert.equal(queryFromGmailHash('#inbox'), 'in:inbox');
  assert.equal(queryFromGmailHash('#inbox/FMfcgz'), 'in:inbox');
  assert.equal(queryFromGmailHash('#all'), '');
  assert.equal(queryFromGmailHash('#label/Mes+Factures%2F2024'), 'label:mes-factures-2024');
  assert.equal(queryFromGmailHash('#category/promotions'), 'category:promotions');
  assert.equal(queryFromGmailHash(''), '');
  assert.equal(
    queryFromGmailHash('#advanced-search/from=a%40b.fr&subject=devis&hasnot=spam&subset=unread&sizeoperator=s_sl&size=2&sizeunit=s_smb'),
    'from:(a@b.fr) subject:(devis) -{spam} is:unread larger:2M',
  );
  assert.equal(
    queryFromGmailHash('#advanced-search/query=x&within=1w&date=2024%2F03%2F15'),
    'x after:2024/3/8 before:2024/3/23',
  );
});

test('labelToken suit la syntaxe de recherche Gmail', () => {
  assert.equal(labelToken('Clients/Dupont & Fils'), 'clients-dupont-fils');
});

test('parseExtensions normalise la saisie', () => {
  assert.deepEqual(parseExtensions(' *.PDF; .docx ,xlsx '), ['pdf', 'docx', 'xlsx']);
});

test('sanitize produit des noms valides sur tous les systèmes', () => {
  assert.equal(sanitize('a/b:c*?.pdf'), 'a_b_c__.pdf');
  assert.equal(sanitize('  ..cache. '), 'cache');
  assert.equal(sanitize('CON.txt'), '_CON.txt');
  assert.equal(sanitize(''), 'sans_nom');
  const long = sanitize(`${'x'.repeat(300)}.pdf`);
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('.pdf'));
});

test('buildPath et PathAllocator évitent les collisions', () => {
  const [att] = extractAttachments(message);
  assert.equal(buildPath(att, { folderMode: 'month', fileMode: 'date' }), '2024-03/2024-03-15_facture.pdf');
  assert.equal(buildPath(att, { folderMode: 'sender', fileMode: 'original' }), 'jean.dupont@exemple.fr/facture.pdf');
  const alloc = new PathAllocator();
  assert.equal(alloc.allocate('d/facture.pdf'), 'd/facture.pdf');
  assert.equal(alloc.allocate('d/Facture.pdf'), 'd/Facture (2).pdf');
  assert.equal(alloc.allocate('d/facture.pdf'), 'd/facture (3).pdf');
  assert.equal(alloc.allocate('README'), 'README');
  assert.equal(alloc.allocate('README'), 'README (2)');
});

test('b64urlToBytes décode le base64url de Gmail', () => {
  assert.equal(new TextDecoder().decode(b64urlToBytes('aGVsbG8')), 'hello');
  assert.deepEqual([...b64urlToBytes('-_8')], [0xfb, 0xff]);
});

test('toCsv échappe les séparateurs et guillemets', () => {
  assert.equal(toCsv([['a;b', 'c"d', 'e']]), '﻿"a;b";"c""d";e');
});

test('pool respecte la limite de concurrence', async () => {
  let running = 0;
  let peak = 0;
  const seen = [];
  await pool([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    seen.push(x);
    running--;
  });
  assert.equal(peak, 3);
  assert.equal(seen.length, 7);
});
