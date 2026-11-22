const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const formatNoul = text => escapeHtml(text).replace(/\(noul\)/g, '(<code>noul</code>)');

const grid = document.getElementById('library-grid');
const filters = document.getElementById('library-filters');
const countEl = document.getElementById('library-count');

let items = [];
let activeDiscipline = 'all';

function render() {
  if (!grid || !items.length) return;

  const disciplines = [...new Set(items.map(item => item.discipline))];
  if (activeDiscipline !== 'all' && !disciplines.includes(activeDiscipline)) {
    activeDiscipline = 'all';
  }

  if (filters) {
    const buttons = [
      `<button type="button" class="filter-pill${activeDiscipline === 'all' ? ' active' : ''}" data-discipline="all">All (${items.length})</button>`,
      ...disciplines.map(name => {
        const count = items.filter(item => item.discipline === name).length;
        return `<button type="button" class="filter-pill${activeDiscipline === name ? ' active' : ''}" data-discipline="${escapeHtml(name)}">${escapeHtml(name)}${count > 1 ? ` (${count})` : ''}</button>`;
      })
    ];
    filters.innerHTML = buttons.join('');
  }

  const visible = activeDiscipline === 'all'
    ? items
    : items.filter(item => item.discipline === activeDiscipline);

  if (countEl) {
    countEl.textContent = `${visible.length} of ${items.length} curated workflows`;
  }

  grid.innerHTML = visible.map((item, idx) => {
    const num = String(idx + 1).padStart(2, '0');
    const orch = item.orchestrator ? `<span class="domain-orch">${escapeHtml(item.orchestrator)}</span>` : '';
    const contrib = item.contributor ? `<span class="domain-contrib">Submitted by ${escapeHtml(item.contributor)}</span>` : '';
    return `<article class="domain-card">
      <div class="domain-head">
        <span class="domain-idx">${num}</span>
        <h3>${escapeHtml(item.discipline)}</h3>
        ${orch}
      </div>
      <p class="domain-plinko"><strong>Plinko cascade:</strong> ${formatNoul(item.plinko)}</p>
      <p class="domain-agent"><strong>Reasoning handoff:</strong> ${formatNoul(item.handoff)}</p>
      ${contrib ? `<div class="domain-foot">${contrib}</div>` : ''}
    </article>`;
  }).join('');
}

filters?.addEventListener('click', event => {
  const button = event.target.closest('[data-discipline]');
  if (!button) return;
  activeDiscipline = button.dataset.discipline;
  render();
});

async function loadSubmissions() {
  try {
    const response = await fetch('/submissions.json');
    if (!response.ok) return;
    const data = await response.json();
    if (Array.isArray(data) && data.length) {
      items = data;
      render();
    }
  } catch {}
}

loadSubmissions();
