// Un clic sur l'icône ouvre l'application dans un onglet (une popup se fermerait
// dès qu'elle perd le focus et interromprait les téléchargements).
// Si l'onglet actif est une recherche Gmail, la requête est reprise dans l'application.

function gmailSearchFromUrl(url) {
  const m = /^https:\/\/mail\.google\.com\/mail\/u\/\d+\/#search\/([^/?]+)/.exec(url || '');
  if (!m) return '';
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' '));
  } catch {
    return '';
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  const appUrl = chrome.runtime.getURL('app.html');
  const q = gmailSearchFromUrl(tab?.url);
  const target = q ? `${appUrl}?q=${encodeURIComponent(q)}` : appUrl;

  // getContexts liste les pages de l'extension sans demander la permission "tabs".
  const [existing] = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  if (existing) {
    await chrome.tabs.update(existing.tabId, { active: true, ...(q ? { url: target } : {}) });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: target });
  }
});
