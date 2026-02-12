(() => {
  const FF_FLAG_CLASS = 'ff-flag';
  const FF_WRAPPER_CLASS = 'ff-wrapper';
  const FF_STYLE_ID = 'ff-style';

  const state = {
    injectedById: new Map(),
    cachedExtraction: null
  };

  function ensureStyles() {
    if (document.getElementById(FF_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = FF_STYLE_ID;
    style.textContent = `
      .${FF_FLAG_CLASS} { cursor: pointer; margin-left: 4px; font-size: 13px; vertical-align: middle; position: relative; }
      .ff-card { display:none; position:absolute; z-index:2147483647; top: 16px; left: 0; width: 280px; background:#111827; color:#f9fafb; border-radius:8px; padding:8px; box-shadow:0 6px 18px rgba(0,0,0,.35); font-size:12px; line-height:1.35; }
      .${FF_FLAG_CLASS}:hover .ff-card { display:block; }
      .ff-card h4 { margin:0 0 6px; font-size:12px; color:#93c5fd; }
      .ff-card p { margin:4px 0; }
      .ff-card ul { margin:4px 0 0 14px; padding:0; }
      .ff-card li { margin:3px 0; }
      .ff-card a { color:#93c5fd; }
    `;
    document.documentElement.appendChild(style);
  }

  function norm(text) {
    return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function visibleText() {
    const blocks = Array.from(document.querySelectorAll('article p, article h1, article h2, article li, main p, p'));
    const used = blocks.length ? blocks : Array.from(document.querySelectorAll('p, h1, h2, li'));
    const pieces = used
      .map((el) => el.innerText)
      .filter(Boolean)
      .map((t) => t.replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 30);

    const text = pieces.join('\n');
    const words = text.split(/\s+/).filter(Boolean);
    const capped = words.slice(0, 10000).join(' ');

    return {
      url: location.href,
      title: document.title,
      text: capped,
      links: Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map((a) => a.href)
    };
  }

  function walkerTextNodes() {
    const out = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('script, style, noscript, textarea')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
  }

  function findAnchorNode(anchor) {
    const needle = norm(anchor).slice(0, 120);
    if (!needle) return null;
    const nodes = walkerTextNodes();
    for (const node of nodes) {
      if (norm(node.nodeValue).includes(needle)) return node;
    }
    return null;
  }

  function badgeEmoji(label) {
    if (label === 'GREEN') return '🟩';
    if (label === 'RED') return '🟥';
    return '🟧';
  }

  function createCard(result) {
    const card = document.createElement('div');
    card.className = 'ff-card';
    const ev = (result.evidence || []).slice(0, 3);
    card.innerHTML = `
      <h4>FactFlags ${badgeEmoji(result.label)} ${result.label || 'ORANGE'}</h4>
      <p><strong>Statement:</strong> ${escapeHtml(result.statement || '')}</p>
      <p><strong>Reason:</strong> ${escapeHtml(result.short_reason || '')}</p>
      <p><strong>Mismatch:</strong> ${escapeHtml(result.mismatch_type || 'none')}</p>
      <p><strong>Evidence:</strong></p>
      <ul>${ev.map((item) => `<li><a href="${escapeAttr(item.url || '#')}" target="_blank" rel="noreferrer">${escapeHtml(item.title || 'source')}</a> — ${escapeHtml(item.snippet || '')}</li>`).join('')}</ul>
    `;
    return card;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/`/g, '');
  }

  function injectFlag(payload) {
    ensureStyles();
    const { id, anchor, statement } = payload;
    if (!id || state.injectedById.has(id)) return { ok: true, skipped: true };

    const node = findAnchorNode(anchor || statement);
    if (!node) return { ok: false, reason: 'anchor_not_found' };

    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);

    const span = document.createElement('span');
    span.className = FF_FLAG_CLASS;
    span.dataset.ffId = id;
    span.textContent = badgeEmoji(payload.label);
    span.appendChild(createCard(payload));

    range.insertNode(span);
    state.injectedById.set(id, span);
    return { ok: true };
  }

  function clearFlags() {
    for (const el of document.querySelectorAll(`.${FF_FLAG_CLASS}`)) el.remove();
    state.injectedById.clear();
    return { ok: true };
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === 'FF_EXTRACT') {
      state.cachedExtraction = visibleText();
      return Promise.resolve({ ok: true, data: state.cachedExtraction });
    }
    if (message?.type === 'FF_INJECT') return Promise.resolve(injectFlag(message.payload || {}));
    if (message?.type === 'FF_CLEAR') return Promise.resolve(clearFlags());
    return undefined;
  });
})();
