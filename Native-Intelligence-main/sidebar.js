// sidebar.js — Native Intelligence (Groq + Indigenous fact checker)

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB cap for the file picker
const SERPER_URL = 'https://google.serper.dev/search';

// EmailJS — for Indigenous Library submissions
const EMAILJS_URL = 'https://api.emailjs.com/api/v1.0/email/send';
const EMAILJS_SERVICE_ID  = 'service_v66tsap';
const EMAILJS_TEMPLATE_ID = 'template_ncefvmu';
const EMAILJS_PUBLIC_KEY  = 'uMPcsh06lhWbIOkg_';

function getApiKey() {
  return new Promise(resolve => {
    chrome.storage.local.get(['groqKey'], ({ groqKey }) => resolve(groqKey || ''));
  });
}

function getSerperKey() {
  return new Promise(resolve => {
    chrome.storage.local.get(['serperKey'], ({ serperKey }) => resolve(serperKey || ''));
  });
}

async function callGroq(userPrompt, systemPrompt = '') {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('NO_KEY');
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: GROQ_MODEL, messages, max_tokens: 1400, temperature: 0.9 })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Groq API error');
  incrementRequestCount();
  return data.choices?.[0]?.message?.content || '';
}

// ── Eco: request counter ──────────────────────────────────────────────────────
function incrementRequestCount() {
  chrome.storage.local.get(['requestCount'], ({ requestCount = 0 }) => {
    const n = requestCount + 1;
    chrome.storage.local.set({ requestCount: n });
    const el = document.getElementById('request-counter');
    if (el) el.textContent = `⚡ ${n} API call${n === 1 ? '' : 's'} made`;
  });
}
chrome.storage.local.get(['requestCount'], ({ requestCount = 0 }) => {
  const el = document.getElementById('request-counter');
  if (el && requestCount > 0) el.textContent = `⚡ ${requestCount} API calls made`;
});

// ── Eco: cache ────────────────────────────────────────────────────────────────
function getCacheKey(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) { h = ((h << 5) - h) + text.charCodeAt(i); h |= 0; }
  return 'cache_' + Math.abs(h);
}
function getCachedResult(text) {
  return new Promise(resolve => {
    chrome.storage.local.get([getCacheKey(text)], data => {
      const c = data[getCacheKey(text)];
      resolve(c && (Date.now() - c.timestamp) < 7 * 24 * 60 * 60 * 1000 ? c : null);
    });
  });
}
function setCachedResult(text, result) {
  chrome.storage.local.set({ [getCacheKey(text)]: { ...result, timestamp: Date.now() } });
}

// ── Eco: batched API call (1 call instead of 5) ───────────────────────────────
async function callGroqBatched(text) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('NO_KEY');

  const prompt = `You are running a three-analyst debate about a piece of text. Analyse this text and return ALL of the following in ONE response.

Text to analyse: "${text}"

The three analysts are:
- Analyst A: argues the text IS AI-generated (focus on writing style, structure, vocabulary)
- Analyst B: argues the text is HUMAN-written (focus on personality, quirks, authenticity)
- Analyst C: evaluates REALISM and CREDIBILITY — is this text factually plausible, satire, fiction, misinformation, or real news? This analyst does NOT care about AI vs human — they only judge whether the CONTENT itself is realistic, credible, and likely to be true. They should identify if it is satire, parody, onion-style humour, exaggeration, propaganda, fiction, or genuine reporting, and explain why.

IMPORTANT: Return ONLY a raw JSON object. No markdown, no backticks, no explanation. Start with { and end with }.

{
  "analystA_opening": "Analyst A argues the text IS AI-generated with 3 specific linguistic features, 3-4 sentences",
  "analystB_opening": "Analyst B argues the text is HUMAN-written with 3 specific features, 3-4 sentences",
  "analystC_opening": "Analyst C evaluates the realism and credibility of the CONTENT ITSELF — is it plausible real news, satire, fiction, misinformation, or something else? Give a clear verdict with specific reasons from the text. 3-4 sentences.",
  "analystA_rebuttal": "Analyst A rebuts Analyst B in 2-3 sentences",
  "analystB_rebuttal": "Analyst B rebuts Analyst A in 2-3 sentences",
  "summary": {
    "ai_contentions": ["strongest AI point 1", "strongest AI point 2", "strongest AI point 3"],
    "human_contentions": ["strongest human point 1", "strongest human point 2", "strongest human point 3"],
    "realism_verdict": "one of: Real/Credible | Likely Real | Uncertain | Likely Satire/Fiction | Satire/Parody | Misinformation",
    "realism_summary": "1-2 sentence plain English verdict on whether the content is real or not"
  }
}`;

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 1400, temperature: 0.7 })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Groq API error');
  incrementRequestCount();

  const raw = data.choices?.[0]?.message?.content || '';
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {}
  if (!parsed) { try { parsed = JSON.parse(raw.replace(/```json|```/gi, '').trim()); } catch {} }
  if (!parsed) { const m = raw.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch {} } }

  // Fallback: individual calls if JSON still fails
  if (!parsed) {
    const sysA = 'You are Analyst A — a forensic linguist who detects AI-generated text. Be assertive and specific, never hedge.';
    const sysB = 'You are Analyst B — a literary critic who champions authentic human writing. Be assertive and specific, never hedge.';
    const argA   = await callGroq(`Argue this text IS AI-generated. Quote 2-3 specific phrases. 3-4 sentences.\n\nText: "${text}"`, sysA);
    const argB   = await callGroq(`Argue this text was written by a HUMAN. Quote 2-3 specific phrases. 3-4 sentences.\n\nText: "${text}"`, sysB);
    const rebutA = await callGroq(`Analyst B said: "${argB}"\nDismantle in 2-3 sentences.\n\nOriginal text: "${text}"`, sysA);
    const rebutB = await callGroq(`Analyst A said: "${rebutA}"\nDismantle in 2-3 sentences.\n\nOriginal text: "${text}"`, sysB);
    parsed = {
      analystA_opening: argA, analystB_opening: argB,
      analystA_rebuttal: rebutA, analystB_rebuttal: rebutB,
      summary: {
        ai_contentions: ['See Analyst A argument above', 'See rebuttal above', 'Review text for AI patterns'],
        human_contentions: ['See Analyst B argument above', 'See rebuttal above', 'Review text for human quirks']
      }
    };
  }
  return parsed;
}

// ── Eco: batched IMAGE call (vision model, two analysts) ──────────────────────
async function callGroqBatchedImage(imageDataUrl) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('NO_KEY');

  const prompt = `You are running a two-analyst debate about an IMAGE. Look at the attached image carefully and return ALL of the following in ONE response.

The two analysts are:
- Analyst A: argues the image IS AI-generated (e.g. deepfake, AI art, heavy manipulation). They point to SPECIFIC visual evidence visible in the image: malformed hands or fingers, asymmetric features, weird reflections or shadow directions, garbled text or signage, plastic-looking skin, repeating textures, impossible anatomy, melted backgrounds, telltale generator artefacts.
- Analyst B: argues the image is AUTHENTIC — a real photo or genuine human-made art. They point to SPECIFIC visual evidence: consistent lighting and shadows, natural skin/material imperfections, plausible physics, coherent background details, sharp/realistic text, EXIF-style realism markers in the composition.

Each analyst must reference what they actually SEE in the image. Do not give generic advice — point to concrete things in this specific image.

IMPORTANT: Return ONLY a raw JSON object. No markdown, no backticks, no explanation. Start with { and end with }.

{
  "analystA_opening": "Analyst A's case that this image IS AI-generated, citing 3 specific visual cues observed in THIS image, 3-4 sentences",
  "analystB_opening": "Analyst B's case that this image is AUTHENTIC, citing 3 specific visual cues observed in THIS image, 3-4 sentences",
  "analystA_rebuttal": "Analyst A rebuts Analyst B in 2-3 sentences, referencing visible details",
  "analystB_rebuttal": "Analyst B rebuts Analyst A in 2-3 sentences, referencing visible details",
  "summary": {
    "ai_contentions": ["specific visual AI tell 1", "specific visual AI tell 2", "specific visual AI tell 3"],
    "human_contentions": ["specific authentic evidence 1", "specific authentic evidence 2", "specific authentic evidence 3"]
  }
}`;

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
      }],
      max_tokens: 1400,
      temperature: 0.7
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Groq API error');
  incrementRequestCount();

  const raw = data.choices?.[0]?.message?.content || '';
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {}
  if (!parsed) { try { parsed = JSON.parse(raw.replace(/```json|```/gi, '').trim()); } catch {} }
  if (!parsed) { const m = raw.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch {} } }

  if (!parsed) {
    // Last-resort fallback: surface the raw response so the user at least sees something
    parsed = {
      analystA_opening: 'Could not parse a structured response from the vision model. Raw output:\n\n' + (raw.slice(0, 400) || '(empty)'),
      analystB_opening: 'Try again, or use a clearer image.',
      analystA_rebuttal: '—',
      analystB_rebuttal: '—',
      summary: {
        ai_contentions: ['Vision model returned malformed JSON', 'Try re-analysing', 'Or try a different image'],
        human_contentions: ['Vision model returned malformed JSON', 'Try re-analysing', 'Or try a different image']
      }
    };
  }
  return parsed;
}
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'history') renderHistory('all');
    if (btn.dataset.tab === 'settings') loadKeyPreview();
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SWITCH_TAB' && msg.tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === msg.tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + msg.tab));
  }
});

document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    renderHistory(chip.dataset.filter);
  });
});

// ── Setup ─────────────────────────────────────────────────────────────────────
document.getElementById('save-key-btn').addEventListener('click', () => {
  const key = document.getElementById('api-key-field').value.trim();
  if (!key) return;
  if (!key.startsWith('gsk_')) {
    document.getElementById('key-status').style.color = 'var(--ai-color)';
    document.getElementById('key-status').textContent = '⚠️ Groq keys start with gsk_ — double check.';
    return;
  }
  chrome.storage.local.set({ groqKey: key }, () => {
    document.getElementById('key-status').style.color = 'var(--judge)';
    document.getElementById('key-status').textContent = '✓ Key saved!';
    document.getElementById('api-key-field').value = '';
    checkKeyAndShowWarning();
  });
});

async function loadKeyPreview() {
  const key = await getApiKey();
  document.getElementById('api-key-field').placeholder = key ? 'Key saved ✓ — paste a new one to update' : 'gsk_xxxxxxxxxxxxxxxxxxxxxxxx';
  const serperKey = await getSerperKey();
  const serperField = document.getElementById('serper-key-field');
  if (serperField) {
    serperField.placeholder = serperKey ? 'Key saved ✓ — paste a new one to update' : 'Serper API key…';
  }
}

// ── Serper key save ───────────────────────────────────────────────────────────
document.getElementById('save-serper-btn').addEventListener('click', () => {
  const key = document.getElementById('serper-key-field').value.trim();
  const status = document.getElementById('serper-key-status');
  if (!key) {
    status.style.color = 'var(--ai-color)';
    status.textContent = 'Please enter a Serper API key.';
    return;
  }
  chrome.storage.local.set({ serperKey: key }, () => {
    status.style.color = 'var(--judge)';
    status.textContent = '✓ Serper key saved!';
    document.getElementById('serper-key-field').value = '';
    document.getElementById('serper-key-field').placeholder = 'Key saved ✓ — paste a new one to update';
    setTimeout(() => { status.textContent = ''; }, 4000);
  });
});

async function checkKeyAndShowWarning() {
  const key = await getApiKey();
  const el = document.getElementById('verify-key-warning');
  el.innerHTML = key ? '' : `<div class="api-banner"><h3>⚠️ No API Key Found</h3><p>Go to the <strong>⚙️ Setup</strong> tab and add your free Groq key from <strong>console.groq.com</strong>.</p></div>`;
}
checkKeyAndShowWarning();

// ── Debate helpers ────────────────────────────────────────────────────────────
function addDebateMessage(role, label, avatarClass, text) {
  const log = document.getElementById('debate-log');
  const div = document.createElement('div');
  div.className = `debate-message ${role}`;
  div.innerHTML = `
    <div class="debate-avatar ${avatarClass}">${label.slice(0,2)}</div>
    <div class="debate-bubble"><div class="debate-label">${label}</div>${text}</div>`;
  log.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function setDebateStatus(text, live = false) {
  const el = document.getElementById('debate-status');
  el.textContent = text;
  el.className = 'debate-badge' + (live ? ' live' : '');
}

function loadingBubble(label, avatarClass) {
  const log = document.getElementById('debate-log');
  const div = document.createElement('div');
  div.className = 'debate-message';
  div.innerHTML = `
    <div class="debate-avatar ${avatarClass}">${label.slice(0,2)}</div>
    <div class="debate-bubble"><div class="debate-label">${label}</div>
    <div class="loading-dots"><span></span><span></span><span></span></div></div>`;
  log.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return div;
}

function noKeyError(containerId) {
  document.getElementById(containerId).innerHTML = `<div class="api-banner"><h3>⚠️ No API Key</h3><p>Go to the <strong>⚙️ Setup</strong> tab and add your free Groq key from <strong>console.groq.com</strong>.</p></div>`;
}

// ── VERIFY ────────────────────────────────────────────────────────────────────
document.getElementById('verify-btn').addEventListener('click', runVerify);
let pendingVerdict = null;

// ── Verify mode toggle (Text / Image) ─────────────────────────────────────────
let verifyMode = 'text';
let currentImage = null; // { dataUrl, name, sizeBytes }

document.querySelectorAll('.verify-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.verifyMode;
    if (mode === verifyMode) return;
    verifyMode = mode;
    document.querySelectorAll('.verify-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.verifyMode === mode);
    });
    const textWrap  = document.querySelector('.verify-textarea-wrap');
    const imageArea = document.getElementById('verify-image-area');
    if (mode === 'image') {
      textWrap.classList.add('hidden');
      imageArea.classList.add('active');
      document.getElementById('verify-empty').innerHTML = 'Two AI analysts will examine the image for AI-generation tells — then you deliver the verdict.';
    } else {
      textWrap.classList.remove('hidden');
      imageArea.classList.remove('active');
      document.getElementById('verify-empty').innerHTML = "Two AI analysts will debate the text's authenticity — then you deliver the verdict.";
    }
  });
});

// File picker — open native dialog when drop zone clicked
document.getElementById('image-drop-zone').addEventListener('click', () => {
  document.getElementById('verify-image-input').click();
});

document.getElementById('verify-image-input').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('Please pick an image file (JPG, PNG, WebP, or GIF).');
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    alert(`That image is ${mb} MB — please use one under 4 MB.`);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    currentImage = { dataUrl: reader.result, name: file.name, sizeBytes: file.size };
    document.getElementById('image-preview').src = reader.result;
    document.getElementById('image-preview-wrap').classList.add('visible');
    document.getElementById('image-drop-zone').classList.add('has-file');
    document.getElementById('image-preview-meta-text').textContent =
      `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
    document.getElementById('verify-image-btn').disabled = false;
  };
  reader.onerror = () => alert('Could not read the image file.');
  reader.readAsDataURL(file);
  // Reset so picking the same file twice still fires `change`
  e.target.value = '';
});

document.getElementById('image-remove-btn').addEventListener('click', () => {
  currentImage = null;
  document.getElementById('image-preview').src = '';
  document.getElementById('image-preview-wrap').classList.remove('visible');
  document.getElementById('image-drop-zone').classList.remove('has-file');
  document.getElementById('verify-image-btn').disabled = true;
});

document.getElementById('verify-image-btn').addEventListener('click', runVerifyImage);

async function runVerifyImage() {
  if (!currentImage) return;
  const cacheKey = currentImage.dataUrl; // hashed inside getCacheKey

  // Check cache first
  const cached = await getCachedResult(cacheKey);
  if (cached) {
    document.getElementById('verify-empty').style.display = 'none';
    document.getElementById('verify-results').style.display = 'block';
    document.getElementById('debate-log').innerHTML = '';
    document.getElementById('verdict-area').innerHTML = '';
    setDebateStatus('Loaded from cache ♻️');

    document.getElementById('debate-log').innerHTML = `<div class="eco-cache-notice">♻️ Result loaded from cache — no API call made.</div>`;
    addDebateMessage('bot-a', 'Analyst A — Pro AI',    'bot-a', cached.argA);
    addDebateMessage('bot-b', 'Analyst B — Pro Human', 'bot-b', cached.argB);
    addDebateMessage('bot-a', 'Analyst A — Rebuttal',  'bot-a', cached.rebutA);
    addDebateMessage('bot-b', 'Analyst B — Rebuttal',  'bot-b', cached.rebutB);

    pendingVerdict = { text: `[Image: ${currentImage.name}]` };
    if (window.setMascotPose) setMascotPose('done', true);
    setDebateStatus('Awaiting your verdict');
    renderJudgeUI(cached.summary);
    return;
  }

  document.getElementById('verify-empty').style.display = 'none';
  document.getElementById('verify-results').style.display = 'block';
  document.getElementById('debate-log').innerHTML = '';
  document.getElementById('verdict-area').innerHTML = '';
  document.getElementById('verify-image-btn').disabled = true;
  pendingVerdict = null;
  setDebateStatus('Live', true);

  if (window.setMascotPose) setMascotPose('working');
  await new Promise(r => setTimeout(r, 800));
  const bubble = loadingBubble('Examining image…', 'bot-a');
  try {
    const batch = await callGroqBatchedImage(currentImage.dataUrl);
    bubble.remove();

    addDebateMessage('bot-a', 'Analyst A — Pro AI',    'bot-a', batch.analystA_opening);
    addDebateMessage('bot-b', 'Analyst B — Pro Human', 'bot-b', batch.analystB_opening);
    setDebateStatus('Rebuttal round', true);
    addDebateMessage('bot-a', 'Analyst A — Rebuttal',  'bot-a', batch.analystA_rebuttal);
    addDebateMessage('bot-b', 'Analyst B — Rebuttal',  'bot-b', batch.analystB_rebuttal);

    const summary = batch.summary || { ai_contentions: ['See debate above'], human_contentions: ['See debate above'] };

    setCachedResult(cacheKey, {
      argA: batch.analystA_opening, argB: batch.analystB_opening,
      rebutA: batch.analystA_rebuttal, rebutB: batch.analystB_rebuttal,
      summary
    });

    pendingVerdict = { text: `[Image: ${currentImage.name}]` };
    setDebateStatus('Awaiting your verdict');
    if (window.setMascotPose) setMascotPose('done', true);
    renderJudgeUI(summary);

  } catch (err) {
    if (bubble) bubble.remove();
    if (window.setMascotPose) setMascotPose('idle');
    if (err.message === 'NO_KEY') noKeyError('debate-log');
    else document.getElementById('debate-log').innerHTML += `<div class="empty-state" style="color:var(--ai-color)">Error: ${err.message}</div>`;
    setDebateStatus('Error');
  }
  document.getElementById('verify-image-btn').disabled = false;
}

async function runVerify() {
  const text = document.getElementById('verify-input').value.trim();
  if (!text) return;

  // ── Eco: text length warning ──────────────────────────────────────────────
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount > 300) {
    const warn = document.getElementById('length-warning');
    warn.innerHTML = `<div class="eco-warning">🌱 Your text is ${wordCount} words. For eco-friendliness, consider trimming to under 300 words — shorter text uses less compute. <button class="eco-trim-btn" id="trim-btn">Trim & Continue</button> <button class="eco-trim-btn" id="continue-anyway-btn">Continue Anyway</button></div>`;
    warn.style.display = 'block';
    return;
  }
  document.getElementById('length-warning').style.display = 'none';

  // ── Eco: check cache first ────────────────────────────────────────────────
  const cached = await getCachedResult(text);
  if (cached) {
    document.getElementById('verify-empty').style.display = 'none';
    document.getElementById('verify-results').style.display = 'block';
    document.getElementById('debate-log').innerHTML = '';
    document.getElementById('verdict-area').innerHTML = '';
    setDebateStatus('Loaded from cache ♻️');

    // Show cache notice
    document.getElementById('debate-log').innerHTML = `<div class="eco-cache-notice">♻️ Result loaded from cache — no API call made.</div>`;

    addDebateMessage('bot-a', 'Analyst A — Pro AI', 'bot-a', cached.argA);
    addDebateMessage('bot-b', 'Analyst B — Pro Human', 'bot-b', cached.argB);
    addDebateMessage('bot-a', 'Analyst A — Rebuttal', 'bot-a', cached.rebutA);
    addDebateMessage('bot-b', 'Analyst B — Rebuttal', 'bot-b', cached.rebutB);

    pendingVerdict = { text: text.length > 80 ? text.slice(0, 80) + '…' : text };
    if (window.setMascotPose) setMascotPose('done', true);
    setDebateStatus('Awaiting your verdict');
    renderJudgeUI(cached.summary);
    return;
  }

  document.getElementById('verify-empty').style.display = 'none';
  document.getElementById('verify-results').style.display = 'block';
  document.getElementById('debate-log').innerHTML = '';
  document.getElementById('verdict-area').innerHTML = '';
  document.getElementById('verify-btn').disabled = true;
  pendingVerdict = null;
  setDebateStatus('Live', true);

  // ── Eco: single batched API call instead of 5 ────────────────────────────
  if (window.setMascotPose) setMascotPose('working');
  // Slightly longer load so mascot animation feels natural
  await new Promise(r => setTimeout(r, 800));
  const bubble = loadingBubble('Analysing…', 'bot-a');
  try {
    const batch = await callGroqBatched(text);
    bubble.remove();

    addDebateMessage('bot-a', 'Analyst A — Pro AI', 'bot-a', batch.analystA_opening);
    addDebateMessage('bot-b', 'Analyst B — Pro Human', 'bot-b', batch.analystB_opening);
    if (batch.analystC_opening) {
      addDebateMessage('bot-c', 'Analyst C — Realism Check', 'bot-c', batch.analystC_opening);
    }
    setDebateStatus('Rebuttal round', true);
    addDebateMessage('bot-a', 'Analyst A — Rebuttal', 'bot-a', batch.analystA_rebuttal);
    addDebateMessage('bot-b', 'Analyst B — Rebuttal', 'bot-b', batch.analystB_rebuttal);

    const summary = batch.summary || { ai_contentions: ['See debate above'], human_contentions: ['See debate above'], realism_verdict: 'Uncertain', realism_summary: '' };

    // Cache the result
    setCachedResult(text, {
      argA: batch.analystA_opening,
      argB: batch.analystB_opening,
      rebutA: batch.analystA_rebuttal,
      rebutB: batch.analystB_rebuttal,
      summary
    });

    pendingVerdict = { text: text.length > 80 ? text.slice(0, 80) + '…' : text };
    setDebateStatus('Awaiting your verdict');
    if (window.setMascotPose) setMascotPose('done', true);
    renderJudgeUI(summary);

  } catch (err) {
    if (bubble) bubble.remove();
    if (window.setMascotPose) setMascotPose('idle');
    if (err.message === 'NO_KEY') noKeyError('debate-log');
    else document.getElementById('debate-log').innerHTML += `<div class="empty-state" style="color:var(--ai-color)">Error: ${err.message}</div>`;
    setDebateStatus('Error');
  }
  document.getElementById('verify-btn').disabled = false;
}

function renderJudgeUI(summary) {
  const area = document.getElementById('verdict-area');
  const aiPoints    = summary.ai_contentions.map((p, i) => `
    <div class="contention-row" data-side="ai" data-index="${i}">
      <div class="contention-text">${p}</div>
      <div class="contention-btns">
        <button class="agree-btn" data-side="ai" data-index="${i}">✓ Convincing</button>
        <button class="disagree-btn" data-side="ai" data-index="${i}">✗ Weak</button>
      </div>
    </div>`).join('');
  const humanPoints = summary.human_contentions.map((p, i) => `
    <div class="contention-row" data-side="human" data-index="${i}">
      <div class="contention-text">${p}</div>
      <div class="contention-btns">
        <button class="agree-btn" data-side="human" data-index="${i}">✓ Convincing</button>
        <button class="disagree-btn" data-side="human" data-index="${i}">✗ Weak</button>
      </div>
    </div>`).join('');

  const realismVerdict  = summary.realism_verdict;
  const realismSummary  = summary.realism_summary  || '';
  const hasRealism      = !!realismVerdict;
  const realismColor    = !hasRealism ? 'var(--text-muted)'
                        : realismVerdict.includes('Satire') || realismVerdict.includes('Fiction') ? 'var(--neutral-color)'
                        : realismVerdict.includes('Misinformation') ? 'var(--ai-color)'
                        : realismVerdict.includes('Real') ? 'var(--human-color)'
                        : 'var(--text-muted)';
  const realismIcon     = !hasRealism ? '❓'
                        : realismVerdict.includes('Satire') ? '😂'
                        : realismVerdict.includes('Fiction') ? '📖'
                        : realismVerdict.includes('Misinformation') ? '⚠️'
                        : realismVerdict.includes('Real') ? '✅'
                        : '❓';

  area.innerHTML = `
    <div class="judge-panel">
      <div class="judge-title">⚖️ You Are the Judge</div>
      <div class="judge-subtitle">Rate each argument — then deliver your verdict.</div>

      <div class="contention-block">
        <div class="contention-header ai-header">🤖 Arguments for AI-Generated</div>
        <div id="ai-contentions">${aiPoints}</div>
      </div>
      <div class="contention-block">
        <div class="contention-header human-header">✍️ Arguments for Human-Written</div>
        <div id="human-contentions">${humanPoints}</div>
      </div>

      ${hasRealism ? `<div class="realism-block">
        <div class="realism-header">🔎 Realism &amp; Credibility Check</div>
        <div class="realism-body">
          <span class="realism-badge" style="background:${realismColor}20;color:${realismColor};border:1.5px solid ${realismColor}40">
            ${realismIcon} ${realismVerdict}
          </span>
          ${realismSummary ? `<p class="realism-text">${realismSummary}</p>` : ''}
        </div>
      </div>` : ''}

      <div class="slider-section">
        <div class="slider-label">
          <span>Your verdict</span>
          <span id="slider-pct-label" class="slider-pct-display">50% AI</span>
        </div>
        <div class="slider-track-wrap">
          <span class="slider-end-label">Human</span>
          <input type="range" id="verdict-slider" min="0" max="100" value="50" step="1"/>
          <span class="slider-end-label">AI</span>
        </div>
        <div class="slider-hint">Drag to set your confidence level</div>
      </div>
      <button class="btn" id="deliver-verdict-btn" style="width:100%;margin-top:4px">Deliver My Verdict</button>
    </div>`;

  const ratings = { ai: {}, human: {} };

  area.querySelectorAll('.agree-btn, .disagree-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const side = btn.dataset.side, index = btn.dataset.index;
      const row  = area.querySelector(`.contention-row[data-side="${side}"][data-index="${index}"]`);
      row.querySelectorAll('button').forEach(b => b.classList.remove('selected-agree', 'selected-disagree'));
      ratings[side][index] = btn.classList.contains('agree-btn') ? 'convincing' : 'weak';
      btn.classList.add(btn.classList.contains('agree-btn') ? 'selected-agree' : 'selected-disagree');
      row.dataset.rated = ratings[side][index];
      updateSliderFromRatings(ratings);
    });
  });

  const slider = area.querySelector('#verdict-slider');
  slider.addEventListener('input', () => updateSliderLabel(slider.value));
  updateSliderLabel(50);

  area.querySelector('#deliver-verdict-btn').addEventListener('click', () => {
    deliverUserVerdict(parseInt(slider.value), ratings, summary);
  });
}

function updateSliderLabel(val) {
  val = parseInt(val);
  const el = document.getElementById('slider-pct-label');
  if (!el) return;
  const label = val > 65 ? 'AI-Generated' : val < 35 ? 'Human-Written' : 'Mixed / Uncertain';
  el.textContent = `${val}% AI — ${label}`;
  el.className = 'slider-pct-display ' + (val > 65 ? 'ai-result' : val < 35 ? 'human-result' : 'mixed-result');
}

function updateSliderFromRatings(ratings) {
  const slider = document.getElementById('verdict-slider');
  if (!slider) return;
  const convincingAI    = Object.values(ratings.ai).filter(v => v === 'convincing').length;
  const convincingHuman = Object.values(ratings.human).filter(v => v === 'convincing').length;
  const total = convincingAI + convincingHuman;
  if (total === 0) { slider.value = 50; updateSliderLabel(50); return; }
  const pct = Math.round((convincingAI / total) * 100);
  slider.value = pct;
  updateSliderLabel(pct);
}

function deliverUserVerdict(pct, ratings, summary) {
  const area = document.getElementById('verdict-area');
  const verdictLabel = pct > 65 ? 'AI-Generated' : pct < 35 ? 'Human-Written' : 'Mixed';
  const barClass     = pct > 65 ? 'bar-ai' : pct < 35 ? 'bar-human' : 'bar-mixed';
  const pctClass     = pct > 65 ? 'ai-result' : pct < 35 ? 'human-result' : 'mixed-result';
  const convincingAI    = summary.ai_contentions.filter((_, i) => ratings.ai[i]    === 'convincing');
  const convincingHuman = summary.human_contentions.filter((_, i) => ratings.human[i] === 'convincing');
  const winnerNote = convincingAI.length > convincingHuman.length ? 'You found the AI arguments more convincing overall.'
    : convincingHuman.length > convincingAI.length ? 'You found the human arguments more convincing overall.'
    : 'You found both sides equally convincing.';

  area.innerHTML = `
    <div class="verdict-card" style="margin-top:14px">
      <div class="verdict-header">Your Verdict</div>
      <div class="verdict-pct ${pctClass}">${pct}% AI</div>
      <div class="verdict-label">${verdictLabel}</div>
      <div class="probability-bar-wrap"><div class="probability-bar ${barClass}" style="width:${pct}%"></div></div>
      <div class="probability-labels"><span>Human</span><span>AI</span></div>
      <div class="verdict-reasoning">${winnerNote}</div>
      ${convincingAI.length ? `<div style="margin-top:10px;font-size:12px;color:var(--text-secondary)"><strong>AI arguments you found convincing:</strong><ul style="margin-top:4px;padding-left:16px">${convincingAI.map(p=>`<li>${p}</li>`).join('')}</ul></div>` : ''}
      ${convincingHuman.length ? `<div style="margin-top:8px;font-size:12px;color:var(--text-secondary)"><strong>Human arguments you found convincing:</strong><ul style="margin-top:4px;padding-left:16px">${convincingHuman.map(p=>`<li>${p}</li>`).join('')}</ul></div>` : ''}
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="copy-btn" id="copy-verdict">📋 Copy result</button>
        <button class="copy-btn" id="retry-btn">🔄 Re-analyse</button>
      </div>
    </div>`;

  document.getElementById('copy-verdict').addEventListener('click', () => {
    const out = `Native Intelligence — Your Verdict\n${'─'.repeat(30)}\n${pct}% AI-Generated (${verdictLabel})\n\n${winnerNote}\n\nConvincing AI signals:\n${convincingAI.map(p=>'• '+p).join('\n') || 'None'}\n\nConvincing Human signals:\n${convincingHuman.map(p=>'• '+p).join('\n') || 'None'}`;
    navigator.clipboard.writeText(out);
    document.getElementById('copy-verdict').textContent = '✓ Copied!';
    setTimeout(() => { document.getElementById('copy-verdict').innerHTML = '📋 Copy result'; }, 2000);
  });

  document.getElementById('retry-btn').addEventListener('click', () => {
    document.getElementById('verify-results').style.display = 'none';
    document.getElementById('verify-empty').style.display = 'block';
    document.getElementById('verify-input').value = '';
    document.getElementById('verify-btn').disabled = false;
    setDebateStatus('Waiting…', false);
    if (window.setMascotPose) setMascotPose('idle');
  });

  setDebateStatus('Complete');
  if (pendingVerdict) {
    saveHistory({ type: 'verify', text: pendingVerdict.text, pct: pct + '% AI', date: formatDate() });
    pendingVerdict = null;
  }
}



// ── SOURCE DETECTION (Serper-powered real Google search) ─────────────────────
document.getElementById('source-btn').addEventListener('click', runSource);

// Build a good Google query from input text.
// - If short (≤30 words), use the whole thing as an exact-match quoted phrase
// - If longer, pull a distinctive middle slice (avoids generic openers)
function buildSearchQuery(text) {
  const words = text.trim().split(/\s+/);
  if (words.length <= 30) {
    return `"${words.join(' ').replace(/"/g, '')}"`;
  }
  // Take a 20-word window from the middle; usually most distinctive
  const start = Math.floor(words.length / 3);
  const slice = words.slice(start, start + 20).join(' ').replace(/"/g, '');
  return `"${slice}"`;
}

async function serperSearch(query, apiKey) {
  const res = await fetch(SERPER_URL, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: 10 })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Serper ${res.status}: ${errText.slice(0, 120) || 'request failed'}`);
  }
  return res.json();
}

function noSerperKeyError(containerId) {
  document.getElementById(containerId).innerHTML = `<div class="api-banner"><h3>⚠️ No Serper API Key</h3><p>The Source tab uses real Google search via Serper to find actual URLs (avoids AI hallucination). Go to <strong>⚙️ Setup</strong> and add your free key from <strong>serper.dev</strong>.</p></div>`;
}

async function runSource() {
  const text = document.getElementById('source-input').value.trim();
  if (!text) return;

  document.getElementById('source-empty').style.display = 'none';
  document.getElementById('source-results').style.display = 'block';
  document.getElementById('source-list').innerHTML = `<div style="text-align:center;padding:20px">
    <div class="loading-dots" style="justify-content:center"><span></span><span></span><span></span></div>
    <div style="margin-top:8px;font-size:12px;color:var(--text-muted)">Searching Google for matching sources…</div>
  </div>`;
  document.getElementById('source-btn').disabled = true;
  if (window.setMascotPose) setMascotPose('working', false);

  try {
    const serperKey = await getSerperKey();
    if (!serperKey) { noSerperKeyError('source-list'); if (window.setMascotPose) setMascotPose('idle'); document.getElementById('source-btn').disabled = false; return; }

    // First try: quoted exact-match search
    let query = buildSearchQuery(text);
    let data = await serperSearch(query, serperKey);
    let organic = data.organic || [];
    let usedExact = true;

    // Fallback: unquoted search if no exact match
    if (!organic.length) {
      usedExact = false;
      query = query.replace(/"/g, '');
      data = await serperSearch(query, serperKey);
      organic = data.organic || [];
    }

    if (!organic.length) {
      document.getElementById('source-list').innerHTML = `<div class="empty-state">
        <div class="icon">🔍</div>
        No matching sources found on Google.<br/>
        <small style="color:var(--text-muted)">Try a longer, more distinctive passage.</small>
      </div>`;
      if (window.setMascotPose) setMascotPose('idle');
      document.getElementById('source-btn').disabled = false;
      return;
    }

    // Top 5 results
    const results = organic.slice(0, 5);
    const matchBanner = usedExact
      ? `<div style="padding:8px 12px;background:#e8f4ee;color:#14532d;border-radius:var(--radius);font-size:12px;margin-bottom:10px">✓ Exact-phrase match found on Google — these are real URLs that contain the text.</div>`
      : `<div style="padding:8px 12px;background:#fdf3e3;color:#78350f;border-radius:var(--radius);font-size:12px;margin-bottom:10px">⚠ No exact match found. Showing closest related results — verify carefully.</div>`;

    // Confidence: exact-match results from earlier positions = higher confidence
    const confidence = (i) => usedExact
      ? (i === 0 ? 'High' : i < 3 ? 'Medium' : 'Low')
      : (i === 0 ? 'Medium' : 'Low');
    const confMap = { 'High': 'conf-high', 'Medium': 'conf-med', 'Low': 'conf-low' };

    // Pull a clean hostname for display
    const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

    let html = matchBanner + results.map((r, i) => {
      const conf = confidence(i);
      return `<div class="source-result">
        <div class="source-title">${r.title || hostOf(r.link)}</div>
        <span class="source-confidence ${confMap[conf]}">${conf} confidence</span>
        <span style="font-size:10px;color:var(--text-muted);margin-left:6px">${hostOf(r.link)}</span>
        <div class="source-url" style="margin-top:6px">
          <a href="${r.link}" target="_blank" style="color:var(--accent);font-size:12px;word-break:break-all;text-decoration:none">${r.link}</a>
        </div>
        ${r.snippet ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:6px">${r.snippet}</div>` : ''}
      </div>`;
    }).join('');

    html += `<div style="margin-top:10px;padding:10px 12px;background:var(--surface-2);border-radius:var(--radius);font-size:12px;color:var(--text-secondary)">
      <strong>Search query used:</strong> <code style="background:var(--surface);padding:1px 6px;border-radius:3px">${query.replace(/</g, '&lt;')}</code>
    </div>`;
    html += `<div style="margin-top:8px"><button class="copy-btn" id="copy-source">📋 Copy result</button></div>`;

    document.getElementById('source-list').innerHTML = html;
    if (window.setMascotPose) setMascotPose('done', true);

    document.getElementById('copy-source').addEventListener('click', () => {
      const srcLines = results.map((r, i) => `${r.title || hostOf(r.link)} (${confidence(i)}) — ${r.link}`);
      const copyOut = 'Native Intelligence — Source Detection\n' + srcLines.join('\n');
      navigator.clipboard.writeText(copyOut);
      document.getElementById('copy-source').textContent = '✓ Copied!';
      setTimeout(() => { document.getElementById('copy-source').innerHTML = '📋 Copy result'; }, 2000);
    });

    const snippet = text.length > 80 ? text.slice(0, 80) + '...' : text;
    saveHistory({ type: 'source', text: snippet, pct: null, date: formatDate() });

  } catch (err) {
    if (window.setMascotPose) setMascotPose('idle');
    document.getElementById('source-list').innerHTML = `<div class="empty-state" style="color:var(--ai-color)">Error: ${err.message}</div>`;
  }
  document.getElementById('source-btn').disabled = false;
}


// ── History ───────────────────────────────────────────────────────────────────
function saveHistory(item) {
  chrome.storage.local.get(['history'], ({ history = [] }) => {
    history.unshift(item);
    if (history.length > 50) history = history.slice(0, 50);
    chrome.storage.local.set({ history });
  });
}

function renderHistory(filter = 'all') {
  chrome.storage.local.get(['history'], ({ history = [] }) => {
    const el = document.getElementById('all-history');
    const filtered = filter === 'all' ? history : history.filter(h => h.type === filter);
    if (!filtered.length) {
      el.innerHTML = `<div class="empty-state"><div class="icon">🕐</div>No history yet</div>`;
      return;
    }
    el.innerHTML = filtered.map(item => {
      const pillMap   = { verify: item.pct, source: 'Source', indigenous: item.pct || 'Check' };
      const classMap  = { verify: parseInt(item.pct) > 65 ? 'pill-ai' : parseInt(item.pct) < 35 ? 'pill-human' : 'pill-mixed', source: 'pill-source', indigenous: 'pill-indigenous' };
      return `<div class="history-item">
        <span class="history-pill ${classMap[item.type] || 'pill-source'}">${pillMap[item.type] || '?'}</span>
        <span class="history-text">${item.text}</span>
        <span class="history-date">${item.date}</span>
      </div>`;
    }).join('');
  });
}

function formatDate() {
  return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

renderHistory('all');

// ── Eco: trim & continue button handlers ──────────────────────────────────────
document.addEventListener('click', e => {
  if (e.target.id === 'trim-btn') {
    const textarea = document.getElementById('verify-input');
    const words    = textarea.value.trim().split(/\s+/);
    textarea.value = words.slice(0, 300).join(' ') + '…';
    document.getElementById('length-warning').style.display = 'none';
    runVerify();
  }
  if (e.target.id === 'continue-anyway-btn') {
    document.getElementById('length-warning').style.display = 'none';
    // Bypass length check
    const text = document.getElementById('verify-input').value.trim();
    if (!text) return;
    document.getElementById('verify-empty').style.display = 'none';
    document.getElementById('verify-results').style.display = 'block';
    document.getElementById('debate-log').innerHTML = '';
    document.getElementById('verdict-area').innerHTML = '';
    document.getElementById('verify-btn').disabled = true;
    pendingVerdict = null;
    setDebateStatus('Live', true);
    const bubble = loadingBubble('Analysing…', 'bot-a');
    callGroqBatched(text).then(batch => {
      bubble.remove();
      addDebateMessage('bot-a', 'Analyst A — Pro AI', 'bot-a', batch.analystA_opening);
      addDebateMessage('bot-b', 'Analyst B — Pro Human', 'bot-b', batch.analystB_opening);
      if (batch.analystC_opening) {
        addDebateMessage('bot-c', 'Analyst C — Realism Check', 'bot-c', batch.analystC_opening);
      }
      setDebateStatus('Rebuttal round', true);
      addDebateMessage('bot-a', 'Analyst A — Rebuttal', 'bot-a', batch.analystA_rebuttal);
      addDebateMessage('bot-b', 'Analyst B — Rebuttal', 'bot-b', batch.analystB_rebuttal);
      const summary = batch.summary || { ai_contentions: ['See debate above'], human_contentions: ['See debate above'], realism_verdict: 'Uncertain', realism_summary: '' };
      setCachedResult(text, { argA: batch.analystA_opening, argB: batch.analystB_opening, rebutA: batch.analystA_rebuttal, rebutB: batch.analystB_rebuttal, summary });
      pendingVerdict = { text: text.length > 80 ? text.slice(0, 80) + '…' : text };
      setDebateStatus('Awaiting your verdict');
      renderJudgeUI(summary);
    }).catch(err => {
      if (bubble) bubble.remove();
      document.getElementById('debate-log').innerHTML += `<div class="empty-state" style="color:var(--ai-color)">Error: ${err.message}</div>`;
      setDebateStatus('Error');
    }).finally(() => { document.getElementById('verify-btn').disabled = false; });
  }
});

// ── INDIGENOUS LIBRARY (ZERO AI) ──────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  if (btn.dataset.tab === 'knowledge') {
    btn.addEventListener('click', () => { renderKBSection('qa'); renderPendingSubmissions(); });
  }
});

function handleAsk() {
  const raw  = document.getElementById('kb-question-input').value.trim();
  const area = document.getElementById('kb-answer-area');
  if (!raw) return;
  const q = raw.toLowerCase();

  const scored = INDIGENOUS_KB.qa.map(item => {
    const tagScore  = item.tags.filter(t => q.includes(t)).length * 3;
    const wordScore = item.question.toLowerCase().split(/\s+/).filter(w => w.length > 3 && q.includes(w)).length * 2;
    const ansScore  = item.answer.toLowerCase().split(/\s+/).filter(w => w.length > 4 && q.includes(w)).length;
    return { item, score: tagScore + wordScore + ansScore };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);

  const termMatches = INDIGENOUS_KB.terminology.filter(t => q.includes(t.avoid.toLowerCase()) || t.preferred.toLowerCase().split(/\s+/).some(w => w.length > 3 && q.includes(w)));
  const mythMatches = INDIGENOUS_KB.myths.filter(m => m.tags.some(t => q.includes(t)) || m.myth.toLowerCase().split(/\s+/).filter(w => w.length > 4).some(w => q.includes(w)));

  if (!scored.length && !termMatches.length && !mythMatches.length) {
    area.innerHTML = `<div class="kb-no-answer"><div style="font-size:20px;margin-bottom:6px">🔍</div><strong>No answer found for "${raw}"</strong><div style="margin-top:6px">Try browsing the Q&A below, or submit this as a new question using the form at the bottom.</div></div>`;
    return;
  }

  let html = '';
  if (scored.length) {
    const best = scored[0].item;
    html += `<div class="kb-answer-card"><div class="kb-answer-q">❓ ${best.question}</div><div class="kb-answer-body">${best.answer}</div><div class="kb-answer-sources"><div style="font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">Verified Sources</div>${best.sources.map(s => `<a class="kb-source-link" href="${s.url}" target="_blank">🔗 ${s.title}</a>`).join('')}</div></div>`;
    if (scored.length > 1) {
      html += `<div style="font-size:11px;color:var(--text-muted);margin:10px 0 6px">Also relevant:</div>`;
      scored.slice(1, 3).forEach(r => { html += `<div class="kb-related-item" data-qa-id="${r.item.id}"><span>❓ ${r.item.question}</span><span class="kb-related-arrow">›</span></div>`; });
    }
  }
  if (termMatches.length) {
    html += `<div class="kb-answer-card" style="margin-top:10px"><div class="kb-answer-q">🗣️ Terminology note</div>`;
    termMatches.forEach(t => { html += `<div style="margin-bottom:10px"><span class="avoid-tag">✗ ${t.avoid}</span> → <span class="prefer-tag">✓ ${t.preferred}</span><div style="font-size:12px;color:var(--text-secondary);margin-top:4px">${t.context}</div><a class="kb-source-link" href="${t.source_url}" target="_blank">🔗 ${t.source}</a></div>`; });
    html += `</div>`;
  }
  if (mythMatches.length) {
    html += `<div class="kb-answer-card" style="margin-top:10px"><div class="kb-answer-q">⚠️ Common myth about this topic</div>`;
    mythMatches.forEach(m => { html += `<div style="margin-bottom:10px"><div style="font-size:12px;font-weight:600;color:var(--ai-color);margin-bottom:4px">"${m.myth}"</div><div class="kb-fact-block">${m.fact}</div><a class="kb-source-link" href="${m.source_url}" target="_blank">🔗 ${m.source}</a></div>`; });
    html += `</div>`;
  }

  area.innerHTML = html;
  area.querySelectorAll('.kb-related-item').forEach(el => {
    el.addEventListener('click', () => {
      const item = INDIGENOUS_KB.qa.find(q => q.id === el.dataset.qaId);
      if (!item) return;
      document.getElementById('kb-question-input').value = item.question;
      handleAsk();
    });
  });
}

document.getElementById('kb-ask-btn').addEventListener('click', handleAsk);
document.getElementById('kb-question-input').addEventListener('keydown', e => { if (e.key === 'Enter') handleAsk(); });

document.addEventListener('click', e => {
  if (e.target.classList.contains('kb-nav-btn')) {
    document.querySelectorAll('.kb-nav-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    renderKBSection(e.target.dataset.section);
  }
  if (e.target.closest('.kb-card-header')) {
    const body   = e.target.closest('.kb-card').querySelector('.kb-card-body');
    const isOpen = body.classList.contains('open');
    document.querySelectorAll('.kb-card-body.open').forEach(b => b.classList.remove('open'));
    if (!isOpen) body.classList.add('open');
  }
});

function renderKBSection(section) {
  const el = document.getElementById('kb-content');
  if (!el) return;
  if (section === 'qa') {
    el.innerHTML = `<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">Click any question to expand the full answer and sources.</div>` +
      INDIGENOUS_KB.qa.map(q => `<div class="kb-card"><div class="kb-card-header"><span>${q.question}</span><span class="kb-badge badge-qa">Q&A</span></div><div class="kb-card-body"><div style="white-space:pre-line;margin-bottom:10px;font-size:calc(var(--font-size-base) - 1px);line-height:1.65">${q.answer}</div><div style="display:flex;flex-wrap:wrap;gap:6px">${q.sources.map(s => `<a class="kb-source-link" href="${s.url}" target="_blank">🔗 ${s.title}</a>`).join('')}</div></div></div>`).join('');
  } else if (section === 'myths') {
    el.innerHTML = INDIGENOUS_KB.myths.map(m => `<div class="kb-card"><div class="kb-card-header"><span>${m.myth}</span><span class="kb-badge badge-myth">Myth</span></div><div class="kb-card-body"><div class="kb-fact-block">${m.fact}</div><a class="kb-source-link" href="${m.source_url}" target="_blank">🔗 ${m.source}</a></div></div>`).join('');
  } else if (section === 'terms') {
    el.innerHTML = INDIGENOUS_KB.terminology.map(t => `<div class="kb-card"><div class="kb-card-header"><span><span class="avoid-tag">✗ ${t.avoid}</span> → <span class="prefer-tag">✓ ${t.preferred}</span></span><span class="kb-badge badge-term">Term</span></div><div class="kb-card-body"><div style="margin-bottom:8px">${t.context}</div><a class="kb-source-link" href="${t.source_url}" target="_blank">🔗 ${t.source}</a></div></div>`).join('');
  } else if (section === 'orgs') {
    el.innerHTML = INDIGENOUS_KB.organisations.map(o => `<div class="kb-card"><div class="kb-card-header"><span>${o.name}</span><span class="kb-badge badge-org">${o.region.split('—')[0].trim()}</span></div><div class="kb-card-body"><div style="margin-bottom:8px">${o.desc}</div><a class="kb-source-link" href="${o.url}" target="_blank">🔗 Visit ${o.name}</a></div></div>`).join('');
  } else if (section === 'ack') {
    el.innerHTML = INDIGENOUS_KB.acknowledgements.map(a => `<div class="kb-card"><div class="kb-card-header"><span>${a.region}</span><span class="kb-badge badge-ack">Territory</span></div><div class="kb-card-body">${a.nations.length ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Nations: ${a.nations.join(', ')}</div>` : ''}<div class="kb-fact-block" style="border-left-color:var(--accent);font-style:italic">"${a.example}"</div>${a.notes ? `<div style="margin-top:8px;font-size:12px">${a.notes}</div>` : ''}<a class="kb-source-link" href="${a.url}" target="_blank">🔗 More info</a></div></div>`).join('');
  }
}

// Send a submission via EmailJS REST API. Returns true on success.
async function sendSubmissionEmail({ type, content, date }) {
  const body = {
    service_id: EMAILJS_SERVICE_ID,
    template_id: EMAILJS_TEMPLATE_ID,
    user_id: EMAILJS_PUBLIC_KEY,
    template_params: {
      title: `New ${type} submission — Native Intelligence`,
      name: 'Native Intelligence user (anonymous)',
      time: date,
      message: `Type: ${type}\nDate: ${date}\n\nContent:\n${content}`,
      email: 'no-reply@native-intelligence.local'
    }
  };
  const res = await fetch(EMAILJS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`EmailJS ${res.status}: ${errText.slice(0, 200) || 'send failed'}`);
  }
  return true;
}

document.getElementById('kb-submit-btn').addEventListener('click', async () => {
  const type    = document.getElementById('kb-submit-type').value.trim();
  const content = document.getElementById('kb-submit-content').value.trim();
  const status  = document.getElementById('kb-submit-status');
  const btn     = document.getElementById('kb-submit-btn');
  if (!type || !content) { status.style.color = 'var(--ai-color)'; status.textContent = '⚠️ Please fill in both fields.'; return; }

  const submission = { id: 'sub-' + Date.now(), type, content, date: formatDate(), status: 'pending' };

  // Save locally first (so we don't lose data if email fails)
  await new Promise(resolve => {
    chrome.storage.local.get(['kb_submissions'], ({ kb_submissions = [] }) => {
      kb_submissions.unshift(submission);
      chrome.storage.local.set({ kb_submissions }, resolve);
    });
  });

  // Then try to email it
  btn.disabled = true;
  status.style.color = 'var(--text-muted)';
  status.textContent = 'Sending…';
  try {
    await sendSubmissionEmail(submission);
    status.style.color = 'var(--judge)';
    status.textContent = '✓ Saved locally and emailed to the team.';
    document.getElementById('kb-submit-type').value    = '';
    document.getElementById('kb-submit-content').value = '';
  } catch (err) {
    status.style.color = 'var(--ai-color)';
    status.textContent = '⚠️ Saved locally, but email failed: ' + err.message;
  }
  renderPendingSubmissions();
  btn.disabled = false;
  setTimeout(() => { status.textContent = ''; }, 6000);
});

function renderPendingSubmissions() {
  chrome.storage.local.get(['kb_submissions'], ({ kb_submissions = [] }) => {
    const el = document.getElementById('kb-pending-list');
    if (!el || !kb_submissions.length) return;
    el.innerHTML = `<div class="section-label" style="margin-top:12px;margin-bottom:6px">Pending (${kb_submissions.length})</div>` +
      kb_submissions.slice(0, 5).map(s => `<div class="kb-pending-item"><div class="kb-pending-label">${s.type} — ${s.date}</div><div>${s.content.slice(0, 120)}${s.content.length > 120 ? '…' : ''}</div></div>`).join('');
  });
}

setTimeout(() => { renderKBSection('qa'); renderPendingSubmissions(); }, 100);
