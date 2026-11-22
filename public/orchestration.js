'use strict';

// The category and guardrail values below were recorded from /api/classify.
const recordings = [
  {
    "text": "An open-ended falafel wrap with a tortilla around the sides and both ends open.",
    "probabilities": {
      "salad": 0.0193,
      "toast": 0.0201,
      "sandwich": 0.0439,
      "taco": 0.0427,
      "sushi": 0.7295,
      "quiche": 0.0571,
      "calzone": 0.0228,
      "cake": 0.0389,
      "nachos": 0.0257
    },
    "foodProbability": 0.9306,
    "ambiguity": 0.1116
  },
  {
    "text": "A burrito entirely sealed in a tortilla, with both ends tucked shut.",
    "probabilities": {
      "salad": 0.0167,
      "toast": 0.0161,
      "sandwich": 0.0206,
      "taco": 0.0367,
      "sushi": 0.181,
      "quiche": 0.0254,
      "calzone": 0.6407,
      "cake": 0.0394,
      "nachos": 0.0234
    },
    "foodProbability": 0.9005,
    "ambiguity": 0.0896
  },
  {
    "text": "A wrap, still in its wrapper. I can't see how the ends are folded.",
    "probabilities": {
      "salad": 0.0324,
      "toast": 0.0281,
      "sandwich": 0.0653,
      "taco": 0.0777,
      "sushi": 0.3167,
      "quiche": 0.0561,
      "calzone": 0.3402,
      "cake": 0.051,
      "nachos": 0.0325
    },
    "foodProbability": 0.5805,
    "ambiguity": 0.8713
  }
];
const byId = id => document.getElementById(id);
let selected = 0;
const percent = score => (score * 100).toFixed(1) + '%';
const titleCase = word => word[0].toUpperCase() + word.slice(1);

function drawLesson() {
  const sample = recordings[selected];
  const cutoff = Number(byId('cutoff').value);
  const ranking = Object.entries(sample.probabilities).sort((a,b) => b[1] - a[1]);
  const [leader, score] = ranking[0];
  byId('case-buttons').querySelectorAll('button').forEach(button => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.case) === selected));
  });
  byId('quote').textContent = '“' + sample.text + '”';
  byId('cutoff-value').textContent = cutoff + '%';
  byId('winner').textContent = titleCase(leader);
  byId('winning-score').textContent = percent(score);
  byId('food-score').textContent = percent(sample.foodProbability);
  byId('ambiguity-score').textContent = percent(sample.ambiguity);
  byId('bars').replaceChildren(...ranking.slice(0,3).map(([name,probability]) => {
    const row = document.createElement('div');
    row.className = 'score-row';
    const label = document.createElement('span');
    label.textContent = titleCase(name);
    const meter = document.createElement('meter');
    meter.min = 0;
    meter.max = 1;
    meter.value = probability;
    meter.setAttribute('aria-label', titleCase(name));
    const value = document.createElement('span');
    value.textContent = percent(probability);
    row.append(label, meter, value);
    return row;
  }));
  let route = 'Accept ruling';
  let reason = 'The leading score clears the cutoff and both checks pass.';
  if (sample.foodProbability < 0.5) {
    route = 'Request new evidence';
    reason = 'Food presence is below 50%.';
  } else if (sample.ambiguity > 0.5) {
    route = 'Send to review';
    reason = 'Ambiguity is above 50%. Ask how the ends are folded.';
  } else if (score < cutoff / 100) {
    route = 'Send to review';
    reason = 'The top score is below your ' + cutoff + '% cutoff.';
  }
  byId('route').textContent = route;
  byId('reason').textContent = reason;
  byId('route').closest('.route-line').classList.toggle('review', route !== 'Accept ruling');
  byId('announcement').textContent = titleCase(leader) + ', ' + percent(score) + '. ' + route + '. ' + reason;
}
byId('case-buttons').addEventListener('click', event => {
  const button = event.target.closest('button[data-case]');
  if (!button) return;
  selected = Number(button.dataset.case);
  drawLesson();
});
byId('cutoff').addEventListener('input', drawLesson);
drawLesson();

function makeWorkflow(item, index) {
  const node = document.createElement('details');
  node.className = 'workflow';
  node.dataset.discipline = item.discipline;
  node.open = index === 0;
  const summary = document.createElement('summary');
  for (const [className, text] of [['workflow-title',item.discipline],['tool',item.orchestrator || ''],['expand','+']]) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    if (className === 'expand') span.setAttribute('aria-hidden','true');
    summary.append(span);
  }
  node.append(summary);
  const body = document.createElement('div');
  body.className = 'workflow-body';
  for (const [heading,content] of [['Classification step',item.plinko],['Reasoning handoff',item.handoff]]) {
    const block = document.createElement('div');
    const label = document.createElement('h3');
    label.textContent = heading;
    const description = document.createElement('p');
    description.textContent = content;
    block.append(label,description);
    body.append(block);
  }
  if (item.contributor) {
    const credit = document.createElement('small');
    credit.textContent = 'Submitted by ' + item.contributor;
    body.append(credit);
  }
  node.append(body);
  return node;
}
function filterLibrary() {
  const nodes = [...byId('library-grid').querySelectorAll('.workflow')];
  const selectedDiscipline = byId('discipline').value;
  let visible = 0;
  for (const node of nodes) {
    node.hidden = Boolean(selectedDiscipline && node.dataset.discipline !== selectedDiscipline);
    if (!node.hidden) {
      visible++;
      if (selectedDiscipline) node.open = true;
    }
  }
  byId('library-count').textContent = visible + ' of ' + nodes.length + ' workflows';
}
function syncFilter() {
  const select = byId('discipline');
  const previous = select.value;
  const names = new Set([...byId('library-grid').children].map(node => node.dataset.discipline));
  select.replaceChildren(new Option('All disciplines',''), ...Array.from(names, name=>new Option(name,name)));
  if (names.has(previous)) select.value = previous;
  filterLibrary();
}
byId('discipline').addEventListener('change',filterLibrary);
syncFilter();
// The embedded collection stays readable while the current submissions load.
async function loadLibrary() {
  try {
    const response = await fetch('/submissions.json');
    if (!response.ok) return;
    const data = await response.json();
    if (!Array.isArray(data) || !data.length || !data.every(item => item && ['discipline','plinko','handoff'].every(key=>typeof item[key] === 'string'))) return;
    byId('library-grid').replaceChildren(...data.map(makeWorkflow));
    syncFilter();
  } catch { /* The embedded collection remains available offline. */ }
}
loadLibrary();
