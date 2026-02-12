async function loadApiKey() {
  const result = await browser.storage.local.get(['ff_api_key']);
  document.getElementById('apiKey').value = result.ff_api_key || '';
}

async function saveApiKey() {
  const value = document.getElementById('apiKey').value.trim();
  await browser.storage.local.set({ ff_api_key: value });
  renderStatus('API key saved.');
}

function renderStatus(text) {
  document.getElementById('status').textContent = text;
}

function renderCounts(progress) {
  const counts = progress?.counts || { GREEN: 0, ORANGE: 0, RED: 0 };
  document.getElementById('counts').textContent = `🟩 ${counts.GREEN || 0} • 🟧 ${counts.ORANGE || 0} • 🟥 ${counts.RED || 0}`;
  const running = progress?.running ? 'Running' : 'Idle';
  const processed = progress?.processed || 0;
  const total = progress?.total || 10;
  const err = progress?.error ? ` | Error: ${progress.error}` : '';
  renderStatus(`${running}: ${processed}/${total}${err}`);
}

async function refreshProgress() {
  const progress = await browser.runtime.sendMessage({ type: 'FF_GET_PROGRESS' });
  renderCounts(progress || {});
}

async function analyze() {
  renderStatus('Starting analysis...');
  const result = await browser.runtime.sendMessage({ type: 'FF_ANALYZE' });
  if (!result?.ok && result?.error) renderStatus(`Error: ${result.error}`);
}

async function clearAll() {
  await browser.runtime.sendMessage({ type: 'FF_CLEAR_ACTIVE' });
  await refreshProgress();
}

document.getElementById('saveKey').addEventListener('click', saveApiKey);
document.getElementById('analyze').addEventListener('click', analyze);
document.getElementById('clear').addEventListener('click', clearAll);

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === 'FF_PROGRESS') renderCounts(message.payload?.progress || {});
});

loadApiKey().then(refreshProgress);
