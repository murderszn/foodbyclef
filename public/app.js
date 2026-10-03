import { rules, cubeSvg } from './rules.js';

const element = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const percent = value => `${Math.round((value || 0) * 100)}%`;
let image;
let controller;
let currentResult;
let history = [];
let imageSequence = 0;
try { const saved = JSON.parse(localStorage.getItem('cube-rule-history') || '[]'); history = Array.isArray(saved) ? saved.filter(item => rules.some(rule => rule.id === item.category) && typeof item.label === 'string' && item.probabilities && typeof item.date === 'number').slice(0, 30) : []; } catch {}

element('empty-cube').innerHTML = cubeSvg(rules[0]);
element('rule-grid').innerHTML = rules.map(rule => `<button class="rule-card" data-rule="${rule.id}" aria-expanded="false" aria-controls="rule-detail"><div class="rule-card-top"><span>0${rule.number}</span><span>${rule.number <= 6 ? `${rule.number} STARCH SURFACE${rule.number === 1 ? '' : 'S'}` : rule.id === 'cake' ? 'STACKED LAYERS' : 'SCATTERED STARCH'}</span></div>${cubeSvg(rule)}<h3>${rule.name}</h3><p>${rule.examples.slice(0, 2).join(' · ')}</p><span class="arrow">↗</span></button>`).join('');

async function checkConnection() {
  element('version').textContent = 'Checking connection…';
  try {
    const data = await fetch('/api/status').then(response => response.json());
    const ready = data.online && data.installed;
    element('version').textContent = ready ? `Ollama ${data.version} · ${data.model}` : data.online ? 'Model missing' : 'Ollama offline';
    if (!ready) element('setup').open = true;
  } catch { element('version').textContent = 'App disconnected'; }
}
element('retry').addEventListener('click', checkConnection);
checkConnection();

function showError(message) { element('error').textContent = message; element('error').hidden = false; }
function saveHistory() { try { localStorage.setItem('cube-rule-history', JSON.stringify(history)); } catch { showError('Your ruling is ready, but browser storage is unavailable. History could not be saved.'); } }
function renderHistory() {
  element('clear-history').hidden = !history.length;
  element('history').innerHTML = history.length ? history.map((item, index) => {
    const rule = rules.find(rule => rule.id === item.category);
    return `<button class="history-row" data-history="${index}" aria-label="View ruling for ${escapeHtml(item.label)}"><span class="history-label">${escapeHtml(item.label)}</span><span class="history-category">${rule.emoji} ${rule.name} ↗</span><span class="history-time">${new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></button>`;
  }).join('') : '<p class="history-empty">No cases yet. Your first ruling starts a local collection.</p>';
}
renderHistory();
element('clear-history').addEventListener('click', () => { history = []; saveHistory(); renderHistory(); });
element('history').addEventListener('click', event => { const button = event.target.closest('[data-history]'); if (button && !controller) { renderResult(history[Number(button.dataset.history)]); element('classify').scrollIntoView({ behavior: 'smooth' }); } });

element('rule-grid').addEventListener('click', event => {
  const button = event.target.closest('[data-rule]');
  if (!button) return;
  const isOpen = button.classList.contains('selected');
  document.querySelectorAll('[data-rule]').forEach(card => { card.classList.remove('selected'); card.setAttribute('aria-expanded', 'false'); });
  element('rule-detail').hidden = isOpen;
  if (isOpen) return;
  button.classList.add('selected'); button.setAttribute('aria-expanded', 'true');
  const rule = rules.find(rule => rule.id === button.dataset.rule);
  element('rule-detail').innerHTML = `<div><h3>${rule.emoji} ${rule.name}: the evidence</h3><p>${rule.description} ${rule.criteria}</p><button data-try="${escapeHtml(rule.examples[0])}">Put ${escapeHtml(rule.examples[0].toLowerCase())} on trial ↗</button></div><button data-close>Close ×</button>`;
});
element('rule-detail').addEventListener('click', event => {
  const tryButton = event.target.closest('[data-try]');
  if (tryButton) setExample(tryButton.dataset.try);
  if (event.target.closest('[data-close]')) { element('rule-detail').hidden = true; document.querySelector('.rule-card.selected')?.focus(); document.querySelectorAll('[data-rule]').forEach(card => { card.classList.remove('selected'); card.setAttribute('aria-expanded', 'false'); }); }
});
function setExample(text) { if (controller) return; removeImage(); element('food').value = text; element('classify').scrollIntoView({ behavior: 'smooth' }); element('food').focus({ preventScroll: true }); }
document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => setExample(button.dataset.example)));

async function loadImage(file) {
  if (!file || controller) return;
  const sequence = ++imageSequence;
  element('error').hidden = true;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return showError('Please choose a PNG, JPEG or WebP image.');
  if (file.size > 8 * 1024 * 1024) return showError('That image is too large. Choose a photo under 8 MB.');
  element('submit').disabled = true;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const dataUrl = canvas.toDataURL('image/jpeg', .88);
    if (sequence !== imageSequence) return;
    image = dataUrl.split(',')[1];
    element('preview').src = dataUrl; element('image-name').textContent = file.name || 'Pasted food photo';
    element('image-preview').hidden = false; document.querySelector('.upload-label').hidden = true;
  } catch { if (sequence === imageSequence) showError('We couldn’t read that photograph. Try another image.'); }
  finally { if (sequence === imageSequence && !controller) element('submit').disabled = false; }
}
function removeImage() { imageSequence++; image = undefined; element('image').value = ''; element('preview').removeAttribute('src'); element('image-preview').hidden = true; document.querySelector('.upload-label').hidden = false; if (!controller) element('submit').disabled = false; }
element('image').addEventListener('change', event => loadImage(event.target.files[0]));
element('remove-image').addEventListener('click', removeImage);
['dragover', 'dragenter'].forEach(type => element('drop-zone').addEventListener(type, event => { event.preventDefault(); element('drop-zone').classList.add('dragging'); }));
['dragleave', 'drop'].forEach(type => element('drop-zone').addEventListener(type, event => { event.preventDefault(); element('drop-zone').classList.remove('dragging'); if (type === 'drop') loadImage(event.dataTransfer.files[0]); }));
document.addEventListener('paste', event => { const file = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'))?.getAsFile(); if (file) { event.preventDefault(); loadImage(file); } });

function renderResult(result) {
  currentResult = result;
  const rule = rules.find(rule => rule.id === result.category);
  const sorted = Object.entries(result.probabilities).filter(([id, probability]) => rules.some(rule => rule.id === id) && Number.isFinite(probability)).sort((first, second) => second[1] - first[1]);
  const notFood = result.foodProbability < .5;
  const uncertain = result.ambiguity > .5 || (sorted[0]?.[1] ?? 0) < .6;
  const notice = notFood ? 'This input may not contain identifiable food. Treat this ruling as inconclusive and try a clearer description or photo.' : uncertain ? 'A contested ruling. The structure may be unclear. Add details about the crust, open ends, or layers and try again.' : '';
  element('result').innerHTML = `<div class="panel-top"><span class="eyebrow">THE VERDICT</span><span class="small-tag">${notFood ? 'INCONCLUSIVE' : uncertain ? 'OPEN TO DEBATE' : 'CASE CLOSED'}</span></div><div class="verdict-head"><div><p class="verdict-kicker">${notFood ? 'TENTATIVE CATEGORY' : 'ACCORDING TO THE CUBE'}</p><h3 class="verdict-name"><span class="verdict-number">${rule.number}</span>${rule.name}.</h3></div>${cubeSvg(rule)}</div><p class="verdict-for">${escapeHtml(result.label)}</p>${notice ? `<div class="notice">${notice}</div>` : ''}<p class="rule-explanation">${rule.description}</p><p class="eyebrow">THE MODEL’S VOTE</p><div class="distribution">${sorted.map(([id, probability]) => `<div class="probability-row"><span>${rules.find(rule => rule.id === id).name}</span><div class="bar"><div class="bar-fill" data-width="${Math.min(100, Math.max(0, probability * 100))}"></div></div><span>${percent(probability)}</span></div>`).join('')}</div><p class="score-note">These are model preference scores, not guarantees of correctness. Explanation describes the selected rule; Clef does not generate a written rationale.</p><div class="result-actions"><button id="copy-result">Copy ruling ↗</button><button id="export-result">Save case file ↓</button></div><div class="result-foot"><span>${escapeHtml(result.model)} · ${(result.elapsedMs / 1000).toFixed(1)}S</span><span>PROCESSED LOCALLY ↗</span></div>`;
  document.querySelectorAll('[data-width]').forEach(bar => { bar.style.width = `${bar.dataset.width}%`; });
  element('copy-result').addEventListener('click', async () => { try { await navigator.clipboard.writeText(`${result.label} → ${rule.name}\n${rule.description}\nCube Rule · ${result.model} · processed locally`); element('copy-result').textContent = 'Copied ✓'; } catch { showError('Clipboard is unavailable. Use Save case file to export the ruling.'); } });
  element('export-result').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `cube-rule-${rule.id}-${result.date}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
}

element('cancel').addEventListener('click', () => controller?.abort());
element('classify-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (controller) return;
  element('error').hidden = true;
  const text = element('food').value.trim();
  if (!text && !image) { showError('Give the cube a food name or photograph first.'); element('food').focus(); return; }
  const label = text || element('image-name').textContent || 'Food photograph';
  controller = new AbortController();
  const previousMarkup = element('result').innerHTML;
  const previousResult = currentResult;
  element('submit').disabled = true; element('food').disabled = true; element('image').disabled = true; element('remove-image').disabled = true; element('cancel').hidden = false;
  element('result').setAttribute('aria-busy', 'true');
  element('result').innerHTML = `<div class="panel-top"><span class="eyebrow">EXAMINING THE EVIDENCE</span><span class="small-tag">CLEF IS THINKING</span></div><div class="empty-result loading">${cubeSvg(rules[3])}<h3>Locating the starch…</h3><p>The first ruling may take a moment<br>while Clef loads into memory.</p></div>`;
  try {
    const response = await fetch('/api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, ...(image ? { image } : {}) }), signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The ruling could not be completed.');
    const result = { ...data, label, date: Date.now(), hasImage: Boolean(image) };
    renderResult(result);
    if (data.foodProbability >= .5) { history.unshift(result); history = history.slice(0, 30); saveHistory(); renderHistory(); }
  } catch (error) {
    if (previousResult) renderResult(previousResult); else element('result').innerHTML = previousMarkup;
    showError(error.name === 'AbortError' ? 'Classification canceled. Your evidence is ready when you are.' : error.message);
  } finally {
    controller = undefined;
    element('submit').disabled = false; element('food').disabled = false; element('image').disabled = false; element('remove-image').disabled = false; element('cancel').hidden = true;
    element('result').setAttribute('aria-busy', 'false');
  }
});
