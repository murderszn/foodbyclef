import { rules, cubeSvg } from './rules.js';
import { specimens } from './specimens.js';

const element = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const percent = value => `${Math.round((value || 0) * 100)}%`;
const hosted = document.body.dataset.runtime === 'cloudflare';
const MODEL_STORAGE_KEY = 'cube-rule-model';
const HISTORY_STORAGE_KEY = 'cube-rule-history';
const SURPRISE_FOODS = [
  'Hot dog in a connected bun',
  'Cereal with cold milk',
  'Vanilla soy latte',
  'Chicago deep-dish pizza',
  'Big Mac with the middle bun',
  'Nigiri salmon sushi',
  'Soup in a sourdough bread bowl',
  'Corn dog on a stick',
  'Lasagna layered with pasta sheets',
  'Poutine with fries, cheese curds, and gravy',
  'Open-ended falafel wrap',
  'Pop-Tart with frosted top',
  'Folded cheese quesadilla',
  'Ramen noodles in tonkotsu broth',
  'Victoria sponge cake with jam'
];

let image;
let imageDataUrl;
let controller;
let currentResult;
let history = [];
let activeFilter = 'all';
let imageSequence = 0;
let selectedModel;
let lastStatusData;
let copyResetTimer;
const sessionImages = new Map();

try {
  const saved = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
  history = Array.isArray(saved)
    ? saved.filter(item => rules.some(rule => rule.id === item.category) && typeof item.label === 'string' && item.probabilities && typeof item.date === 'number').slice(0, 30)
    : [];
} catch {}

function surfaceLabel(rule) {
  if (rule.number <= 6) return `${rule.number} STARCH SURFACE${rule.number === 1 ? '' : 'S'}`;
  return rule.id === 'cake' ? 'STACKED LAYERS' : 'SCATTERED STARCH';
}

function getSavedModel() {
  try { return localStorage.getItem(MODEL_STORAGE_KEY); } catch { return null; }
}

function saveModel(name) {
  try { localStorage.setItem(MODEL_STORAGE_KEY, name); } catch {}
}

function updateStatusPill(state, text) {
  const pill = element('status-pill');
  const statusText = element('status-text');
  if (pill) {
    pill.classList.toggle('online', state === 'online');
    pill.classList.toggle('offline', state === 'offline');
  }
  if (statusText) statusText.textContent = text;
}

function updateCharCount() {
  const counter = element('char-count');
  if (!counter) return;
  const len = element('food').value.length;
  counter.hidden = len === 0;
  counter.textContent = len ? `${len.toLocaleString()} / 2,000` : '';
  counter.classList.toggle('near-limit', len >= 1800);
}

function closeRuleDetail(restoreFocus = false) {
  const detail = element('rule-detail');
  if (!detail || detail.hidden) return;
  const selected = document.querySelector('.rule-card.selected');
  const shouldRestoreFocus = restoreFocus || detail.contains(document.activeElement);
  detail.hidden = true;
  document.querySelectorAll('[data-rule]').forEach(card => {
    card.classList.remove('selected');
    card.setAttribute('aria-expanded', 'false');
  });
  if (shouldRestoreFocus) selected?.focus();
}

const specimenBoard = element('result').innerHTML;
let specimenIndex = 0;
function showSpecimen(index) {
  specimenIndex = (index + specimens.length) % specimens.length;
  const specimen = specimens[specimenIndex];
  const rule = rules.find(item => item.id === specimen.rule);
  if (!element('spec-image')) element('result').innerHTML = specimenBoard;
  currentResult = undefined;
  element('spec-image').src = '/' + specimen.image + '.webp';
  element('spec-image').alt = specimen.alt;
  for (const label of element('result').querySelectorAll('.annotation')) label.hidden = specimen.image !== 'burger';
  element('spec-title').textContent = specimen.title + '.';
  element('spec-category').textContent = rule.name;
  element('spec-note').textContent = specimen.note;
  element('spec-position').textContent = (specimenIndex + 1) + ' / ' + specimens.length;
  document.querySelector('.rule-card.is-verdict')?.classList.remove('is-verdict');
}
element('result').addEventListener('click', event => {
  if (controller) return;
  const control = event.target.closest('button');
  if (!control) return;
  if (control.hasAttribute('data-step')) showSpecimen(specimenIndex + Number(control.dataset.step));
  if (control.hasAttribute('data-try-specimen')) setExample(specimens[specimenIndex].dish);
  if (control.hasAttribute('data-return-specimens')) {
    showSpecimen(specimenIndex);
    element('result').querySelector('[data-step="1"]').focus();
  }
});

element('rule-grid').innerHTML = rules.map(rule => {
  const specimen = specimens.find(item => item.rule === rule.id);
  return `<button type="button" class="rule-card" data-rule="${rule.id}" aria-expanded="false" aria-controls="rule-detail">
    <span class="food-thumb"><img src="/${specimen.image}.webp" alt="" loading="lazy" width="180" height="180"></span>
    <span class="rule-summary"><span class="rule-card-top">${surfaceLabel(rule)}</span><strong>${rule.name}</strong><span class="food-name">${specimen.title}</span></span>
    ${cubeSvg(rule, 'rule-glyph')}</button>`;
}).join('');
updateCharCount();

async function checkConnection() {
  element('version').textContent = 'Checking connection…';
  try {
    const data = await fetch('/api/status').then(response => response.json());
    lastStatusData = data;
    const isCloudflare = hosted || data.runtime === 'cloudflare';
    const available = !isCloudflare && Array.isArray(data.availableModels) ? data.availableModels : [];
    const picker = element('model-picker');
    const select = element('model-select');

    let activeModel = data.model;
    if (!isCloudflare && available.length > 1) {
      const saved = getSavedModel();
      const matchedDefault = available.includes(data.model)
        ? data.model
        : available.find(name => name === `${data.model}:latest`);
      const initialModel = saved && available.includes(saved) ? saved : matchedDefault;
      if (select) {
        select.innerHTML = '';
        if (!initialModel) {
          const placeholder = document.createElement('option');
          placeholder.value = '';
          placeholder.textContent = 'Select a model…';
          placeholder.disabled = true;
          placeholder.selected = true;
          select.append(placeholder);
        }
        for (const name of available) {
          const option = document.createElement('option');
          option.value = name;
          option.textContent = name;
          select.append(option);
        }
        if (initialModel) select.value = initialModel;
      }
      if (picker) picker.hidden = false;
      selectedModel = initialModel || undefined;
      activeModel = initialModel || data.model;
    } else {
      if (picker) picker.hidden = true;
      selectedModel = undefined;
    }

    const modelInstalled = data.installed || (Boolean(selectedModel) && available.includes(selectedModel));
    const ready = Boolean(data.online && modelInstalled);
    if (ready) {
      if (isCloudflare) {
        element('version').textContent = 'Clef Flash · Cloudflare Workers AI';
        updateStatusPill('online', 'Clef Flash online');
      } else {
        const ver = data.version ? `Ollama ${data.version}` : 'Ollama';
        element('version').textContent = `${ver} · ${activeModel}`;
        updateStatusPill('online', `${activeModel} Ready`);
      }
    } else if (data.online) {
      element('version').textContent = 'Model missing';
      updateStatusPill('offline', 'Model Missing');
      element('setup').open = true;
    } else {
      element('version').textContent = 'Ollama offline';
      updateStatusPill('offline', 'Ollama Offline');
      element('setup').open = true;
    }
  } catch {
    lastStatusData = undefined;
    element('version').textContent = 'App disconnected';
    updateStatusPill('offline', 'Disconnected');
  }
}

element('retry').addEventListener('click', checkConnection);
element('status-pill')?.addEventListener('click', () => {
  const setup = element('setup');
  setup.open = true;
  setup.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
element('model-select')?.addEventListener('change', event => {
  const value = event.target.value;
  if (!value) return;
  selectedModel = value;
  saveModel(value);
  updateStatusPill('online', `${value} Ready`);
  if (lastStatusData?.online) {
    const ver = lastStatusData.version ? `Ollama ${lastStatusData.version}` : 'Ollama';
    element('version').textContent = `${ver} · ${value}`;
  }
});
checkConnection();

function showError(message) { element('error').textContent = message; element('error').hidden = false; }
function saveHistory() {
  try { localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history)); }
  catch { showError('Your ruling is ready, but browser storage is unavailable. History could not be saved.'); }
}

function renderHistory() {
  element('clear-history').hidden = !history.length;
  const controls = element('history-controls');
  if (controls) controls.hidden = !history.length;

  const counts = new Map();
  for (const item of history) {
    counts.set(item.category, (counts.get(item.category) || 0) + 1);
  }
  if (activeFilter !== 'all' && !counts.has(activeFilter)) {
    activeFilter = 'all';
  }

  const statsEl = element('history-stats');
  if (statsEl) {
    if (history.length) {
      const topCategoriesText = [...counts.entries()]
        .sort((first, second) => second[1] - first[1])
        .slice(0, 2)
        .map(([id, count]) => `${rules.find(rule => rule.id === id).name} (${count})`)
        .join(', ');
      statsEl.textContent = `${history.length} case${history.length === 1 ? '' : 's'} · Top: ${topCategoriesText}`;
    } else {
      statsEl.textContent = '';
    }
  }

  const filtersEl = element('history-filters');
  if (filtersEl) {
    if (history.length) {
      const pills = [`<button type="button" class="filter-pill${activeFilter === 'all' ? ' active' : ''}" data-filter="all">All (${history.length})</button>`];
      for (const rule of rules) {
        const count = counts.get(rule.id);
        if (count) {
          pills.push(`<button type="button" class="filter-pill${activeFilter === rule.id ? ' active' : ''}" data-filter="${rule.id}">${rule.emoji} ${rule.name} (${count})</button>`);
        }
      }
      filtersEl.innerHTML = pills.join('');
    } else {
      filtersEl.innerHTML = '';
    }
  }

  const visibleEntries = history
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => activeFilter === 'all' || item.category === activeFilter);

  element('history').innerHTML = visibleEntries.length
    ? visibleEntries.map(({ item, index }) => {
        const rule = rules.find(rule => rule.id === item.category);
        const dateText = new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        return `<div class="history-item"><button type="button" class="history-row" data-history="${index}" aria-label="View ruling for ${escapeHtml(item.label)}"><span class="history-label">${escapeHtml(item.label)}</span><span class="history-category">${rule.emoji} ${rule.name}</span><span class="history-time">${dateText}</span></button><button type="button" class="history-delete" data-delete="${index}" aria-label="Remove ${escapeHtml(item.label)}">×</button></div>`;
      }).join('')
    : '<p class="history-empty">Your first classified dish will appear here.</p>';
}
renderHistory();

element('clear-history').addEventListener('click', () => {
  for (const item of history) {
    if (currentResult?.date !== item.date) sessionImages.delete(item.date);
  }
  history = [];
  activeFilter = 'all';
  saveHistory();
  renderHistory();
});

element('history-filters')?.addEventListener('click', event => {
  const pill = event.target.closest('[data-filter]');
  if (!pill) return;
  activeFilter = pill.dataset.filter;
  renderHistory();
});

element('history').addEventListener('click', event => {
  const deleteButton = event.target.closest('[data-delete]');
  if (deleteButton) {
    const index = Number(deleteButton.dataset.delete);
    if (Number.isInteger(index) && index >= 0 && index < history.length) {
      const [removed] = history.splice(index, 1);
      if (removed && currentResult?.date !== removed.date) sessionImages.delete(removed.date);
      if (activeFilter !== 'all' && !history.some(item => item.category === activeFilter)) {
        activeFilter = 'all';
      }
      saveHistory();
      renderHistory();
    }
    return;
  }
  const button = event.target.closest('[data-history]');
  if (button && !controller) {
    const entry = history[Number(button.dataset.history)];
    if (entry) {
      element('error').hidden = true;
      renderResult(entry);
      element('classify').scrollIntoView({ behavior: 'smooth' });
    }
  }
});

element('rule-grid').addEventListener('click', event => {
  const button = event.target.closest('[data-rule]');
  if (!button) return;
  const isOpen = button.classList.contains('selected');
  document.querySelectorAll('[data-rule]').forEach(card => { card.classList.remove('selected'); card.setAttribute('aria-expanded', 'false'); });
  element('rule-detail').hidden = isOpen;
  if (isOpen) return;
  button.classList.add('selected'); button.setAttribute('aria-expanded', 'true');
  const rule = rules.find(rule => rule.id === button.dataset.rule);
  const specimen = specimens.find(item => item.rule === rule.id);
  element('rule-detail').innerHTML = `<div><h3>${rule.emoji} ${rule.name}: the evidence</h3><p>${rule.criteria}</p><div class="detail-actions"><button type="button" data-inspect="${rule.id}">View illustration</button><button type="button" data-try="${escapeHtml(specimen.dish)}">Try this dish</button></div></div><button type="button" data-close>Close ×</button>`;
  element('rule-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

element('rule-detail').addEventListener('click', event => {
  const inspect = event.target.closest('[data-inspect]');
  if (inspect && !controller) {
    showSpecimen(specimens.findIndex(item => item.rule === inspect.dataset.inspect));
    element('result').scrollIntoView({ block: 'center' });
    element('result').querySelector('[data-step="1"]').focus({ preventScroll: true });
  }
  const tryButton = event.target.closest('[data-try]');
  if (tryButton) setExample(tryButton.dataset.try);
  if (event.target.closest('[data-close]')) closeRuleDetail(true);
});

function setExample(text) {
  if (controller) return;
  element('food').value = text;
  updateCharCount();
  element('classify').scrollIntoView({ behavior: 'smooth' });
  element('food').focus({ preventScroll: true });
}

document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => setExample(button.dataset.example)));
element('surprise')?.addEventListener('click', () => {
  if (controller) return;
  const current = element('food').value.trim();
  const candidates = SURPRISE_FOODS.filter(item => item !== current);
  const pick = candidates[Math.floor(Math.random() * candidates.length)] || SURPRISE_FOODS[0];
  setExample(pick);
});

element('food').addEventListener('input', updateCharCount);
element('food').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    if (!controller) element('classify-form').requestSubmit();
  }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (controller) {
    controller.abort();
    return;
  }
  closeRuleDetail(false);
});

async function loadImage(file) {
  if (!file || controller) return;
  const sequence = ++imageSequence;
  element('error').hidden = true;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    element('image').value = '';
    return showError('Please choose a PNG, JPEG or WebP image.');
  }
  if (file.size > 8 * 1024 * 1024) {
    element('image').value = '';
    return showError('That image is too large. Choose a photo under 8 MB.');
  }
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
    imageDataUrl = dataUrl;
    image = dataUrl.split(',')[1];
    element('preview').src = dataUrl; element('image-name').textContent = file.name || 'Pasted food photo';
    element('image-preview').hidden = false; document.querySelector('.input-tools').hidden = true;
  } catch {
    if (sequence === imageSequence) {
      element('image').value = '';
      showError('We couldn’t read that photograph. Try another image.');
    }
  } finally {
    if (sequence === imageSequence && !controller) element('submit').disabled = false;
  }
}

function removeImage() {
  imageSequence++;
  image = undefined;
  imageDataUrl = undefined;
  element('image').value = '';
  element('preview').removeAttribute('src');
  element('image-preview').hidden = true;
  document.querySelector('.input-tools').hidden = false;
  if (!controller) element('submit').disabled = false;
}

element('image').addEventListener('change', event => loadImage(event.target.files[0]));
element('remove-image').addEventListener('click', removeImage);
['dragover', 'dragenter'].forEach(type => element('drop-zone').addEventListener(type, event => { event.preventDefault(); element('drop-zone').classList.add('dragging'); }));
['dragleave', 'drop'].forEach(type => element('drop-zone').addEventListener(type, event => { event.preventDefault(); element('drop-zone').classList.remove('dragging'); if (type === 'drop') loadImage(event.dataTransfer.files[0]); }));
document.addEventListener('paste', event => { const file = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'))?.getAsFile(); if (file) { event.preventDefault(); loadImage(file); } });

function drawCubeOnCanvas(ctx, rule, x, y, targetHeight) {
  const active = new Set(rule.faces);
  const scale = targetHeight / 204;
  const polygons = {
    back: [[80, 24], [146, 62], [146, 142], [80, 104]],
    left: [[14, 62], [80, 24], [80, 104], [14, 142]],
    bottom: [[14, 142], [80, 104], [146, 142], [80, 180]],
    right: [[80, 100], [146, 62], [146, 142], [80, 180]],
    front: [[14, 62], [80, 100], [80, 180], [14, 142]],
    top: [[80, 24], [146, 62], [80, 100], [14, 62]]
  };

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = 'rgba(243, 245, 248, 0.82)';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';

  for (const [face, points] of Object.entries(polygons)) {
    ctx.beginPath();
    points.forEach(([px, py], index) => {
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    if (active.has(face)) {
      ctx.fillStyle = 'rgba(255, 107, 53, 0.84)';
      ctx.fill();
    }
    ctx.stroke();
  }

  if (active.has('layers')) {
    ctx.fillStyle = '#ff6b35';
    for (const offset of [142, 102, 62]) {
      ctx.beginPath();
      ctx.moveTo(14, offset);
      ctx.lineTo(80, offset - 38);
      ctx.lineTo(146, offset);
      ctx.lineTo(80, offset + 38);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  if (active.has('pieces')) {
    ctx.fillStyle = '#ff6b35';
    ctx.lineWidth = 1.4;
    for (const [cx, cy, dx, dy, h] of [
      [64, 70, 11, 6, 10],
      [114, 98, 14, 8, 9],
      [44, 123, 13, 7, 13],
      [96, 144, 15, 9, 12]
    ]) {
      for (const face of [
        [[cx, cy - 2 * dy], [cx + dx, cy - dy], [cx, cy], [cx - dx, cy - dy]],
        [[cx - dx, cy - dy], [cx, cy], [cx, cy + h], [cx - dx, cy - dy + h]],
        [[cx, cy], [cx + dx, cy - dy], [cx + dx, cy - dy + h], [cx, cy + h]]
      ]) {
        ctx.beginPath();
        face.forEach(([px, py], index) => {
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function wrapCanvasText(ctx, text, maxWidth, maxLines) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let current = '';

  const fitTruncate = value => {
    let trimmed = value;
    while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
      trimmed = trimmed.slice(0, -1);
    }
    return `${trimmed}…`;
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      if (lines.length === maxLines - 1) {
        lines.push(fitTruncate(current));
        return lines;
      }
      lines.push(current);
      current = ctx.measureText(word).width <= maxWidth ? word : fitTruncate(word);
    } else {
      current = fitTruncate(word);
      if (lines.length === maxLines - 1) {
        lines.push(current);
        return lines;
      }
      lines.push(current);
      current = '';
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

function downloadShareCard(result, rule, sorted, statusTag, elapsedText) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const serifFont = "Georgia, 'Times New Roman', serif";
  const sansFont = "'Helvetica Neue', Helvetica, Arial, sans-serif";
  const monoFont = "ui-monospace, 'SFMono-Regular', Consolas, Menlo, monospace";

  // Specimen board ground & editorial frame
  ctx.fillStyle = '#191a17';
  ctx.fillRect(0, 0, 1200, 630);

  ctx.strokeStyle = '#494a40';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(36, 36, 1128, 558);

  // Header bar
  ctx.fillStyle = '#f07843';
  ctx.font = `700 18px ${serifFont}`;
  ctx.fillText('✳︎', 76, 88);
  ctx.fillStyle = '#f5f1e6';
  ctx.font = `600 13px ${monoFont}`;
  ctx.fillText('FOOD BY CLEF · CUBE RULE VERDICT', 102, 87);

  ctx.font = `600 12px ${monoFont}`;
  const tagWidth = ctx.measureText(statusTag).width + 24;
  ctx.fillStyle = '#3a3027';
  ctx.fillRect(1124 - tagWidth, 68, tagWidth, 28);
  ctx.strokeStyle = '#ad704f';
  ctx.lineWidth = 1;
  ctx.strokeRect(1124 - tagWidth, 68, tagWidth, 28);
  ctx.fillStyle = '#ffad80';
  ctx.textAlign = 'center';
  ctx.fillText(statusTag, 1124 - tagWidth / 2, 86);
  ctx.textAlign = 'left';

  ctx.strokeStyle = '#494a40';
  ctx.beginPath();
  ctx.moveTo(76, 116);
  ctx.lineTo(1124, 116);
  ctx.stroke();

  // Right column: specimen pedestal + isometric cube
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
  ctx.beginPath();
  ctx.arc(950, 304, 146, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#494a40';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.arc(950, 304, 166, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const cubeHeight = 240;
  const cubeScale = cubeHeight / 204;
  drawCubeOnCanvas(ctx, rule, 950 - 80 * cubeScale, 304 - 102 * cubeScale, cubeHeight);

  ctx.fillStyle = '#b6b7a8';
  ctx.font = `600 12px ${monoFont}`;
  ctx.textAlign = 'center';
  ctx.fillText(`0${rule.number} · ${surfaceLabel(rule)}`, 950, 494);
  ctx.textAlign = 'left';

  // Left column: kicker, verdict, label, description, top 3 bars
  const notFood = result.foodProbability < .5;
  ctx.fillStyle = '#f1b589';
  ctx.font = `600 12px ${monoFont}`;
  ctx.fillText(notFood ? 'TENTATIVE CATEGORY' : 'ACCORDING TO THE CUBE', 76, 160);

  ctx.fillStyle = '#f5f1e6';
  ctx.font = `400 70px ${serifFont}`;
  ctx.fillText(`${rule.name}.`, 76, 232);

  ctx.fillStyle = '#d5d4c6';
  ctx.font = `500 22px ${sansFont}`;
  const labelLines = wrapCanvasText(ctx, result.label, 650, 2);
  let cursorY = 274;
  for (const line of labelLines) {
    ctx.fillText(line, 76, cursorY);
    cursorY += 30;
  }

  ctx.fillStyle = '#b6b7a8';
  ctx.font = `400 17px ${sansFont}`;
  const descLines = wrapCanvasText(ctx, rule.description, 650, 2);
  cursorY += 8;
  for (const line of descLines) {
    ctx.fillText(line, 76, cursorY);
    cursorY += 23;
  }

  const votesTop = Math.max(cursorY + 20, 382);
  ctx.fillStyle = '#f1b589';
  ctx.font = `600 11px ${monoFont}`;
  ctx.fillText("THE MODEL'S VOTE", 76, votesTop);

  sorted.slice(0, 3).forEach(([id, probability], index) => {
    const rowRule = rules.find(item => item.id === id);
    const rowY = votesTop + 28 + index * 31;
    ctx.fillStyle = index === 0 ? '#ffab7a' : '#cccdbf';
    ctx.font = `${index === 0 ? 600 : 400} 14px ${monoFont}`;
    ctx.fillText(rowRule.name, 76, rowY);

    ctx.fillStyle = '#3c3e34';
    ctx.fillRect(190, rowY - 10, 420, 7);
    ctx.fillStyle = index === 0 ? '#f47740' : '#a6aa99';
    ctx.fillRect(190, rowY - 10, Math.round(420 * Math.min(1, Math.max(0, probability))), 7);

    ctx.fillStyle = index === 0 ? '#ffab7a' : '#cccdbf';
    ctx.font = `500 13px ${monoFont}`;
    ctx.textAlign = 'right';
    ctx.fillText(percent(probability), 672, rowY);
    ctx.textAlign = 'left';
  });

  // Footer bar
  ctx.strokeStyle = '#494a40';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(76, 526);
  ctx.lineTo(1124, 526);
  ctx.stroke();

  const runtimeLabel = result.runtime === 'cloudflare' ? 'CLOUDFLARE WORKERS AI' : 'PROCESSED LOCALLY';
  ctx.fillStyle = '#babcaf';
  ctx.font = `500 12px ${monoFont}`;
  ctx.fillText(`${result.model || 'clef-flash'} · ${elapsedText} · ${runtimeLabel}`, 76, 560);

  ctx.fillStyle = '#f1b589';
  ctx.textAlign = 'right';
  ctx.fillText('FOOD BY CLEF · CUBERULE.COM', 1124, 560);
  ctx.textAlign = 'left';

  canvas.toBlob(blob => {
    const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = url;
    link.download = `cube-rule-${rule.id}-${result.date}.png`;
    link.click();
    if (blob) setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

function renderResult(result) {
  currentResult = result;
  const rule = rules.find(rule => rule.id === result.category) || rules[0];
  const sorted = Object.entries(result.probabilities).filter(([id, probability]) => rules.some(rule => rule.id === id) && Number.isFinite(probability)).sort((first, second) => second[1] - first[1]);
  const notFood = result.foodProbability < .5;
  const uncertain = result.ambiguity > .5 || (sorted[0]?.[1] ?? 0) < .6;
  const statusTag = notFood ? 'INCONCLUSIVE' : uncertain ? 'OPEN TO DEBATE' : 'CASE CLOSED';
  const notice = notFood ? 'This input may not contain identifiable food. Treat this ruling as inconclusive and try a clearer description or photo.' : uncertain ? 'A contested ruling. The structure may be unclear. Add details about the crust, open ends, or layers and try again.' : '';

  const runnerUp = sorted.length >= 2 ? rules.find(item => item.id === sorted[1][0]) : null;
  const margin = runnerUp ? Math.round((sorted[0][1] - sorted[1][1]) * 100) : Infinity;
  const runnerUpMarkup = !notFood && runnerUp && margin <= 25 && sorted[1][1] >= 0.15
    ? `<p class="runner-up">Close call — narrowly beat <strong>${runnerUp.name}</strong> by ${margin} percentage points.</p>`
    : '';

  const thumb = sessionImages.get(result.date);
  const evidenceMarkup = thumb
    ? `<div class="verdict-evidence"><img class="verdict-thumb" src="${escapeHtml(thumb)}" alt="Submitted food"><p class="verdict-for">${escapeHtml(result.label)}</p></div>`
    : `<p class="verdict-for">${escapeHtml(result.label)}</p>`;

  const elapsedText = Number.isFinite(result.elapsedMs) ? `${(result.elapsedMs / 1000).toFixed(1)}S` : '—';
  const modelName = result.model || 'clef-flash';

  element('result').innerHTML = `<div class="panel-top"><span class="eyebrow">THE VERDICT</span><span class="small-tag verdict-badge">${statusTag}</span></div><div class="verdict-head"><div><p class="verdict-kicker">${notFood ? 'TENTATIVE CATEGORY' : 'ACCORDING TO THE CUBE'}</p><h3 class="verdict-name"><span class="verdict-number">${rule.number}</span>${rule.name}.</h3></div>${cubeSvg(rule)}</div>${evidenceMarkup}${notice ? `<div class="notice">${notice}</div>` : ''}<p class="rule-explanation">${rule.description}</p><p class="eyebrow">THE MODEL’S VOTE</p>${runnerUpMarkup}<div class="distribution">${sorted.map(([id, probability], index) => `<div class="probability-row${index === 0 ? ' is-winner' : ''}"><span>${rules.find(rule => rule.id === id).name}</span><div class="bar"><div class="bar-fill" data-width="${Math.min(100, Math.max(0, probability * 100))}"></div></div><span>${percent(probability)}</span></div>`).join('')}</div><p class="score-note">These are model preference scores, not guarantees of correctness. Explanation describes the selected rule; Clef does not generate a written rationale.</p><div class="result-actions"><button type="button" data-return-specimens>Browse specimens</button><button id="copy-result" type="button">Copy ruling</button><button id="share-card" type="button">Download card ↓</button><button id="export-result" type="button">Save case file ↓</button></div><div class="result-foot"><span>${escapeHtml(modelName)} · ${elapsedText}</span><span>PROCESSED LOCALLY</span></div>`;

  const bars = [...element('result').querySelectorAll('.bar-fill')];
  bars.forEach(bar => { bar.style.width = '0%'; });
  void element('result').offsetWidth;
  requestAnimationFrame(() => {
    bars.forEach(bar => { bar.style.width = `${bar.dataset.width}%`; });
  });

  document.querySelectorAll('#rule-grid [data-rule]').forEach(card => {
    card.classList.toggle('is-verdict', card.dataset.rule === rule.id);
  });

  if (result.runtime === 'cloudflare') element('result').querySelector('.result-foot > span:last-child').textContent = 'CLOUDFLARE WORKERS AI';
  const processingLocation = result.runtime === 'cloudflare' ? 'processed by Cloudflare' : 'processed locally';

  const copyButton = element('copy-result');
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${result.label} → ${rule.name}\n${rule.description}\nCube Rule · ${modelName} · ${processingLocation}`);
      copyButton.textContent = 'Copied ✓';
      clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => {
        if (copyButton.isConnected) copyButton.textContent = 'Copy ruling';
      }, 2000);
    } catch {
      showError('Clipboard is unavailable. Use Save case file to export the ruling.');
    }
  });

  element('share-card').addEventListener('click', () => downloadShareCard(result, rule, sorted, statusTag, elapsedText));

  element('export-result').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `cube-rule-${rule.id}-${result.date}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
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
  const loadingMessage = hosted ? 'Clef is examining your evidence on Cloudflare.' : 'The first ruling may take a moment<br>while Clef loads into memory.';
  element('result').innerHTML = `<div class="panel-top"><span class="eyebrow">EXAMINING THE EVIDENCE</span><span class="small-tag">CLEF IS THINKING</span></div><div class="empty-result loading">${cubeSvg(rules[3])}<h3>Locating the starch…</h3><p>${loadingMessage}</p><p class="loading-timer">0.0s</p></div>`;
  const startedAt = performance.now();
  const timerEl = element('result').querySelector('.loading-timer');
  const loadingTimer = setInterval(() => {
    if (timerEl) timerEl.textContent = `${((performance.now() - startedAt) / 1000).toFixed(1)}s`;
  }, 100);

  try {
    const payload = {
      text,
      ...(image ? { image } : {}),
      ...(!hosted && selectedModel ? { model: selectedModel } : {})
    };
    const response = await fetch('/api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The classifier is unavailable. Please try again shortly.');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The ruling could not be completed.');
    let timestamp = Date.now();
    while (sessionImages.has(timestamp) || history.some(item => item.date === timestamp)) timestamp++;
    const result = { ...data, label, date: timestamp, hasImage: Boolean(image) };
    if (imageDataUrl) sessionImages.set(result.date, imageDataUrl);
    renderResult(result);
    if (data.foodProbability >= .5) { history.unshift(result); history = history.slice(0, 30); saveHistory(); renderHistory(); }
  } catch (error) {
    if (previousResult) renderResult(previousResult); else element('result').innerHTML = previousMarkup;
    showError(error.name === 'AbortError' ? 'Classification canceled. Your evidence is ready when you are.' : error.message);
  } finally {
    clearInterval(loadingTimer);
    controller = undefined;
    element('submit').disabled = false; element('food').disabled = false; element('image').disabled = false; element('remove-image').disabled = false; element('cancel').hidden = true;
    element('result').setAttribute('aria-busy', 'false');
  }
});
