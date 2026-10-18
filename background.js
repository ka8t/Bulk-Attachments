// Service d'arrière-plan : relais entre la popup et le document hors écran.
// Le document hors écran (offscreen.html) fait le travail long (analyse, ZIP) et
// survit à la fermeture de la popup ; il n'a accès qu'à chrome.runtime, donc les
// jetons OAuth, les téléchargements et le badge de l'icône passent par ici.

const OFFSCREEN_URL = 'offscreen.html';
let creating = null;

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['BLOBS'],
      justification: 'Construire les archives ZIP et les fichiers à télécharger',
    })
    .finally(() => (creating = null));
  await creating;
}

async function getToken(interactive) {
  const r = await chrome.identity.getAuthToken({ interactive });
  const token = typeof r === 'string' ? r : r?.token;
  if (!token) throw new Error('Aucun jeton OAuth obtenu.');
  return token;
}

const handlers = {
  ensureOffscreen: () => ensureOffscreen().then(() => true),
  getToken: ({ interactive }) => getToken(Boolean(interactive)),
  dropToken: ({ token }) => chrome.identity.removeCachedAuthToken({ token }).then(() => true),
  signOut: async ({ token }) => {
    if (token) {
      await chrome.identity.removeCachedAuthToken({ token });
      await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: 'POST' }).catch(() => {});
    }
    await chrome.identity.clearAllCachedAuthTokens();
    return true;
  },
  download: ({ url, filename }) =>
    chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false }),
  badge: async ({ text, color }) => {
    await chrome.action.setBadgeText({ text: text || '' });
    if (color) await chrome.action.setBadgeBackgroundColor({ color });
    return true;
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'background' || !handlers[msg.type]) return false;
  handlers[msg.type](msg)
    .then((value) => sendResponse({ ok: true, value }))
    .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
  return true;
});

// Fin d'un téléchargement : le document hors écran peut libérer la mémoire du fichier.
chrome.downloads.onChanged.addListener((delta) => {
  const state = delta.state?.current;
  if (state !== 'complete' && state !== 'interrupted') return;
  chrome.runtime
    .sendMessage({ target: 'offscreen', type: 'downloadEnded', id: delta.id, state, error: delta.error?.current })
    .catch(() => {});
});
