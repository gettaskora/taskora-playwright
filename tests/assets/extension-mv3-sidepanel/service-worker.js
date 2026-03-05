// Side panel test extension service worker
globalThis.MAGIC = 42;
globalThis.__logs = [];

function log(msg) {
  globalThis.__logs.push(msg);
  console.log('[SidePanelExt] ' + msg);
}

log('Service worker started');

// Use setPanelBehavior to auto-open side panel on action click.
// This avoids the chrome.sidePanel.open() user gesture requirement
// because Chrome handles the open internally when the action is clicked.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .then(() => log('setPanelBehavior(openPanelOnActionClick: true) set'))
  .catch(err => log('setPanelBehavior error: ' + err.message));
