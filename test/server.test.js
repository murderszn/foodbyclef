import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { rules } from '../public/rules.js';
import { parseDecision } from '../classification.js';

let app;
let received;
let mockError = false;
let mockOffline = false;
let mockTags = [{ name: 'clef-flash:latest' }];
let invalidDecision = false;
let omitResponseModel = false;
let decisionRequest;
let validateInput;
const originalFetch = globalThis.fetch;

const validProbabilities = () => Object.fromEntries(rules.map(rule => [rule.id, rule.id === 'taco' ? .9 : rule.id === 'sandwich' ? .1 : 0]));

async function localRequest(path, { method = 'GET', headers = {}, body = '' } = {}) {
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(request, { url: path, method, headers: { host: 'localhost:3000', ...headers } });
  const chunks = [];
  const response = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  const responseHeaders = {};
  response.setHeader = (name, value) => { responseHeaders[name.toLowerCase()] = value; };
  response.writeHead = (status, values = {}) => { response.status = status; Object.entries(values).forEach(([name, value]) => response.setHeader(name, value)); };
  const finished = new Promise(resolve => response.on('finish', resolve));
  app.emit('request', request, response);
  await finished;
  const data = Buffer.concat(chunks).toString();
  return { status: response.status, headers: { get: name => responseHeaders[name] }, text: async () => data, json: async () => JSON.parse(data) };
}

before(async () => {
  globalThis.fetch = async (url, options) => {
    if (mockOffline) throw new Error('fetch failed');
    if (url.endsWith('/api/tags')) return Response.json({ models: mockTags });
    if (url.endsWith('/api/version')) return Response.json({ version: '0.35.1' });
    assert.ok(url.endsWith('/v1/systemone'));
    received = JSON.parse(options.body);
    if (mockError) return Response.json({ error: 'model not found' }, { status: 404 });
    return Response.json({
      ...(omitResponseModel ? {} : { model: received.model }),
      answers: {
        category: { choice: invalidDecision ? 'unknown' : 'taco', probabilities: validProbabilities(), confidence: .8 },
        food_present: { noul: .99 },
        ambiguous: { noul: .1 }
      }
    });
  };
  const module = await import('../server.js');
  ({ decisionRequest, validateInput } = module);
  app = module.server;
});

after(() => { globalThis.fetch = originalFetch; });

test('all nine rules are unique and included in the decision schema', () => {
  assert.equal(rules.length, 9);
  assert.equal(new Set(rules.map(rule => rule.id)).size, 9);
  const request = decisionRequest({ text: 'hot dog' });
  assert.equal(request.model, 'clef-flash');
  assert.deepEqual(Object.keys(request.questions.category.criteria), rules.map(rule => rule.id));
  assert.equal(request.questions.food_present.type, 'noul');
  assert.equal(request.images, undefined);
});

test('validation handles names, images, empty, malformed and oversized input', () => {
  assert.equal(validateInput({ text: '  pizza  ' }).text, 'pizza');
  for (const invalid of [null, [], {}, { text: ' ' }, { text: 1 }, { text: 'x'.repeat(2001) }, { image: 'data:image/png;base64,abc' }, { image: 'dGV4dA==' }, { image: 123 }]) assert.throws(() => validateInput(invalid));
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
  assert.equal(validateInput({ image: png }).image, png);
  assert.deepEqual(decisionRequest({ image: png }).images, [png]);
});

test('serves local interface and reports model availability', async () => {
  const response = await localRequest('/');
  assert.match(await response.text(), /What are <br>you <em>eating\?<\/em>/);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const status = await localRequest('/api/status').then(response => response.json());
  assert.equal(status.online, true);
  assert.equal(status.installed, true);
  assert.deepEqual(status.availableModels, ['clef-flash']);
  assert.equal((await localRequest('/unknown')).status, 404);
});

test('status extracts deduplicated Clef models and returns empty list when offline', async () => {
  try {
    mockTags = [
      { name: 'clef-flash:latest' },
      { name: 'clef-flash' },
      { name: 'clef:latest' },
      { name: 'clef-pro:q4_0' },
      { name: 'llama3.2:latest' },
      { name: 'my-clef:latest' }
    ];
    const onlineStatus = await localRequest('/api/status').then(response => response.json());
    assert.equal(onlineStatus.online, true);
    assert.equal(onlineStatus.installed, true);
    assert.deepEqual(onlineStatus.availableModels, ['clef-flash', 'clef', 'clef-pro:q4_0']);

    mockOffline = true;
    const offlineStatus = await localRequest('/api/status').then(response => response.json());
    assert.equal(offlineStatus.online, false);
    assert.equal(offlineStatus.installed, false);
    assert.deepEqual(offlineStatus.availableModels, []);
  } finally {
    mockOffline = false;
    mockTags = [{ name: 'clef-flash:latest' }];
  }
});

test('forwards evidence to System One and preserves actual model scores', async () => {
  const response = await localRequest('/api/classify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hot dog' }) });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(received.state.food, 'hot dog');
  assert.equal(result.category, 'taco');
  assert.equal(result.probabilities.taco, .9);
  assert.equal(result.foodProbability, .99);
  assert.ok(result.elapsedMs >= 0);
});

test('supports optional model override in classify and rejects invalid model names', async () => {
  try {
    omitResponseModel = true;
    const response = await localRequest('/api/classify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hot dog', model: 'clef' }) });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(received.model, 'clef');
    assert.equal(result.model, 'clef');

    for (const invalidModel of ['', 123, 'bad model', 'x'.repeat(65)]) {
      const invalid = await localRequest('/api/classify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hot dog', model: invalidModel }) });
      assert.equal(invalid.status, 400);
    }
  } finally {
    omitResponseModel = false;
  }
});

test('rejects invalid input and cross-origin inference requests', async () => {
  const post = (body, headers = {}) => localRequest('/api/classify', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  assert.equal((await post('{}')).status, 400);
  assert.equal((await post('{')).status, 400);
  assert.equal((await post('{"text":"pizza"}', { origin: 'https://example.com' })).status, 403);
});

test('reports upstream errors and invalid model decisions', async () => {
  const post = () => localRequest('/api/classify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'pizza' }) });
  mockError = true;
  const error = await post();
  assert.equal(error.status, 502);
  assert.equal((await error.json()).error, 'model not found');
  mockError = false;
  invalidDecision = true;
  const malformed = await post();
  assert.equal(malformed.status, 502);
  assert.match((await malformed.json()).error, /unexpected decision/);
  invalidDecision = false;
});

test('parseDecision rejects missing food_present.noul, ambiguous.noul, or incomplete rule probabilities', () => {
  const base = {
    answers: {
      category: { choice: 'taco', probabilities: validProbabilities(), confidence: .8 },
      food_present: { noul: .99 },
      ambiguous: { noul: .1 }
    }
  };
  assert.equal(parseDecision(base, 12.4).model, 'clef-flash');
  assert.equal(parseDecision(base, 12.4, 'clef').model, 'clef');

  assert.throws(() => parseDecision({ answers: { ...base.answers, food_present: {} } }, 10), /unexpected decision/);
  assert.throws(() => parseDecision({ answers: { ...base.answers, food_present: undefined } }, 10), /unexpected decision/);
  assert.throws(() => parseDecision({ answers: { ...base.answers, ambiguous: {} } }, 10), /unexpected decision/);
  assert.throws(() => parseDecision({ answers: { ...base.answers, ambiguous: undefined } }, 10), /unexpected decision/);
  assert.throws(() => parseDecision({ answers: { ...base.answers, category: { choice: 'taco', probabilities: { taco: .9, sandwich: .1 }, confidence: .8 } } }, 10), /unexpected decision/);
});
