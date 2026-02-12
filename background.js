const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-5-mini';

const runsByTab = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getApiKey() {
  const result = await browser.storage.local.get(['ff_api_key']);
  return result.ff_api_key || '';
}

function notifyPopup(update) {
  browser.runtime.sendMessage({ type: 'FF_PROGRESS', payload: update }).catch(() => undefined);
}

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function initialProgress() {
  return {
    running: false,
    processed: 0,
    total: 10,
    counts: { GREEN: 0, ORANGE: 0, RED: 0 },
    error: null,
    startedAt: null
  };
}

async function setProgress(tabId, progress) {
  await browser.storage.local.set({ [`ff_progress_${tabId}`]: progress });
  notifyPopup({ tabId, progress });
}

async function readProgress(tabId) {
  const out = await browser.storage.local.get([`ff_progress_${tabId}`]);
  return out[`ff_progress_${tabId}`] || initialProgress();
}

async function callOpenAI(apiKey, systemPrompt, userPrompt) {
  const body = {
    model: MODEL,
    temperature: 0.1,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: { type: 'json_object' }
  };

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${text.slice(0, 400)}`);
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Missing model response content');

  return content;
}

async function parseJsonWithRepair(apiKey, raw, repairContext) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    const repaired = await callOpenAI(
      apiKey,
      'You repair invalid JSON. Return valid JSON only and preserve original meaning.',
      `Repair this into valid JSON only:\n\n${raw}\n\nContext:${repairContext}`
    );
    return JSON.parse(repaired);
  }
}

function promptA({ url, pageText }) {
  return `You are FactFlags extraction mode. Return JSON only.
Input URL: ${url}
Input page_text:\n${pageText}

Task:
1) Return article_text with boilerplate/navigation/ads removed.
2) Extract exactly 10 most newsworthy and checkable factual statements.
- Prioritize quotes, allegations, numbers, and strong claims.
- Each statement must be one sentence.
- Include a short verbatim anchor likely present in article <=120 chars.
- type must be one of quote|factual|statistical|attribution.
- ids MUST be s1..s10.

Output schema:
{
  "article_text": "...",
  "items": [
    {"id":"s1","statement":"...","anchor":"...","type":"quote"}
  ]
}`;
}

function promptB({ url, articleText, item }) {
  return `You are FactFlags verification mode. Return JSON only.

Given URL: ${url}
Statement id: ${item.id}
Statement: ${item.statement}
Article context:\n${articleText}

You must:
- Check whether statement is supported by article itself.
- Use external sources (primary if possible) to verify factual accuracy.
- Detect title/quote/context distortions.

Label rules:
- GREEN: supported and externally corroborated.
- ORANGE: uncertain, weak, unavailable, conflicting, or only social-media evidence.
- RED: contradicted/misrepresented/distorted.

Return:
{
  "id":"${item.id}",
  "label":"GREEN|ORANGE|RED",
  "short_reason":"<=40 words",
  "evidence":[{"title":"...","url":"...","snippet":"<=25 words"}],
  "mismatch_type":"certainty_inflation|attribution_injection|quote_inaccuracy|scope_inflation|other|null"
}`;
}

function sanitizeItems(items) {
  const out = Array.isArray(items) ? items.slice(0, 10) : [];
  while (out.length < 10) {
    out.push({ id: `s${out.length + 1}`, statement: 'Statement unavailable.', anchor: '', type: 'factual' });
  }
  return out.map((item, i) => ({
    id: `s${i + 1}`,
    statement: String(item.statement || '').slice(0, 400),
    anchor: String(item.anchor || '').slice(0, 120),
    type: ['quote', 'factual', 'statistical', 'attribution'].includes(item.type) ? item.type : 'factual'
  }));
}

async function clearTab(tabId) {
  await browser.tabs.sendMessage(tabId, { type: 'FF_CLEAR' }).catch(() => undefined);
}

function cancelRun(tabId) {
  const run = runsByTab.get(tabId);
  if (run) run.cancelled = true;
}

async function analyzeActiveTab() {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error('No active tab');
  const tabId = tab.id;

  cancelRun(tabId);
  const run = { cancelled: false, startedAt: Date.now() };
  runsByTab.set(tabId, run);

  await clearTab(tabId);
  const progress = initialProgress();
  progress.running = true;
  progress.startedAt = run.startedAt;
  await setProgress(tabId, progress);

  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('Missing API key. Add it in popup settings.');

    const extract = await browser.tabs.sendMessage(tabId, { type: 'FF_EXTRACT' });
    const data = extract?.data;
    if (!data?.text) throw new Error('Could not extract article text from page.');

    const rawA = await callOpenAI(apiKey, 'You extract structured news claims.', promptA({ url: data.url, pageText: data.text }));
    const parsedA = await parseJsonWithRepair(apiKey, rawA, 'schema: {article_text, items[10]}');
    const articleText = String(parsedA.article_text || data.text).slice(0, 120000);
    const items = sanitizeItems(parsedA.items);

    for (const item of items) {
      if (run.cancelled) break;

      let result;
      try {
        const rawB = await callOpenAI(apiKey, 'You verify claims with evidence and output strict JSON.', promptB({ url: data.url, articleText, item }));
        const parsedB = await parseJsonWithRepair(apiKey, rawB, 'schema: verification result');
        result = {
          id: item.id,
          statement: item.statement,
          anchor: item.anchor,
          label: ['GREEN', 'ORANGE', 'RED'].includes(parsedB.label) ? parsedB.label : 'ORANGE',
          short_reason: String(parsedB.short_reason || 'Verification uncertain.').slice(0, 200),
          evidence: Array.isArray(parsedB.evidence) ? parsedB.evidence.slice(0, 3) : [],
          mismatch_type: parsedB.mismatch_type || null
        };
      } catch (error) {
        result = {
          id: item.id,
          statement: item.statement,
          anchor: item.anchor,
          label: 'ORANGE',
          short_reason: `Verification failed: ${error.message.slice(0, 100)}`,
          evidence: [],
          mismatch_type: 'other'
        };
      }

      await browser.tabs.sendMessage(tabId, { type: 'FF_INJECT', payload: result }).catch(() => undefined);

      const current = await readProgress(tabId);
      current.processed = Math.min(10, current.processed + 1);
      current.counts[result.label] = (current.counts[result.label] || 0) + 1;
      current.running = current.processed < 10 && !run.cancelled;
      await setProgress(tabId, current);

      await sleep(900);
    }

    const done = await readProgress(tabId);
    done.running = false;
    await setProgress(tabId, done);
  } catch (error) {
    const failed = await readProgress(tabId);
    failed.running = false;
    failed.error = error.message;
    await setProgress(tabId, failed);
    throw error;
  } finally {
    if (runsByTab.get(tabId) === run) runsByTab.delete(tabId);
  }
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === 'FF_ANALYZE') {
    return analyzeActiveTab().then(() => ({ ok: true })).catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === 'FF_CLEAR_ACTIVE') {
    return getActiveTab().then(async (tab) => {
      if (!tab?.id) return { ok: false };
      cancelRun(tab.id);
      await clearTab(tab.id);
      await setProgress(tab.id, initialProgress());
      return { ok: true };
    });
  }
  if (message?.type === 'FF_GET_PROGRESS') {
    return getActiveTab().then((tab) => (tab?.id ? readProgress(tab.id) : initialProgress()));
  }
  return undefined;
});
