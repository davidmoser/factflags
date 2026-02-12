# FactFlags (Firefox WebExtension prototype)

FactFlags is a browser extension prototype that annotates article pages with inline evidence flags:
- 🟩 supported
- 🟧 unknown / weak evidence
- 🟥 contradicted or misrepresented

It uses **only the OpenAI ChatGPT API** (no custom backend server).

## How it works
1. Open a news/article page.
2. Click the FactFlags extension icon.
3. Paste and save your OpenAI API key.
4. Click **Analyze**.
5. The extension extracts the page URL and readable text and sends it to OpenAI.
6. Prompt A extracts exactly 10 checkable claims.
7. Prompt B verifies each claim serially.
8. As each result returns, an inline flag is injected immediately near the matching text.

## Load in Firefox (`about:debugging`)
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select the `manifest.json` file from this folder.
4. Open any article page and use the toolbar icon.

## Set the OpenAI API key
- Open the popup.
- Paste key into **OpenAI API Key** field (`sk-...`).
- Click **Save Key**.
- The key is stored in `browser.storage.local` on your machine.

## Privacy note
- FactFlags sends extracted article text and URL to OpenAI for claim extraction and verification.
- Do not use on sensitive/private pages unless you accept this behavior.

## Limitations
- Text matching is best-effort and may miss anchors or place flags imperfectly.
- Paywalled or script-heavy pages may produce weak extraction.
- Model outputs and web retrieval may be incomplete or incorrect.
- Verification labels are heuristics and should not be treated as definitive truth.

## Technical notes
- Manifest V2 (Firefox-compatible prototype).
- Background script orchestrates serial verification + cancellation/rate limiting.
- Content script handles extraction, inline flag injection, and clear/reset.
- Popup provides API key settings, Analyze/Clear actions, and live counts.
