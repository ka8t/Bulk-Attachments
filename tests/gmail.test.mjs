// Lancer avec : node --test tests/gmail.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PathAllocator,
  b64urlToBytes,
  buildPath,
  buildQuery,
  extractAttachments,
  localDayToEpoch,
  parseExtensions,
  parseSender,
  pool,
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

test('buildQuery assemble les filtres avec des dates inclusives en heure locale', () => {
  const q = buildQuery({ from: 'a@b.fr', after: '2024-01-01', before: '2024-01-31', extensions: '.pdf, docx', minSizeMB: 2 });
  assert.equal(
    q,
    `has:attachment from:(a@b.fr) after:${localDayToEpoch('2024-01-01')} before:${localDayToEpoch('2024-02-01')} {filename:pdf filename:docx} larger:2M`,
  );
  assert.equal(buildQuery({}), 'has:attachment');
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
