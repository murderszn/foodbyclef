import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { DailyBudget } from '../cloudflare/worker.js';
import { rules } from '../public/rules.js';

function bindings({ rateAllowed = true, budgetAllowed = true, modelError = false } = {}) {
  let calls = 0;
  let rateCalls = 0;
  let budgetCalls = 0;
  let request;
  return {
    get calls() { return calls; },
    get rateCalls() { return rateCalls; },
    get budgetCalls() { return budgetCalls; },
    get modelRequest() { return request; },
    RATE_LIMITER: { limit: async () => { rateCalls++; return { success: rateAllowed }; } },
    DAILY_BUDGET: { idFromName: name => name, get: () => ({ fetch: async () => { budgetCalls++; return new Response(null, { status: budgetAllowed ? 200 : 429 }); } }) },
    AI: { run: async (model, input) => {
      calls++; request = input;
      assert.equal(model, '@cf/cloudflare/clef-flash');
      if (modelError) throw new Error('upstream unavailable');
      return { model: 'clef-flash', answers: { category: { choice: 'taco', confidence: .8, probabilities: Object.fromEntries(rules.map(rule => [rule.id, rule.id === 'taco' ? .92 : .01])) }, food_present: { noul: .99 }, ambiguous: { noul: .1 } } };
    } }
  };
}

function post(body = { text: 'hot dog' }, extraHeaders = {}) {
  return new Request('https://foodbyclef.example/api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://foodbyclef.example', ...extraHeaders }, body: JSON.stringify(body) });
}

test('hosted inference uses the same criteria and preserves actual probabilities', async () => {
  const env = bindings();
  const response = await worker.fetch(post(), env);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.runtime, 'cloudflare');
  assert.equal(result.category, 'taco');
  assert.equal(result.probabilities.taco, .92);
  assert.equal(env.modelRequest.keep_alive, undefined);
  assert.equal(env.modelRequest.state.food, 'hot dog');
  assert.equal(Object.keys(env.modelRequest.questions.category.criteria).length, 9);
});

test('hosted photos reach the vision API as embedded data URIs', async () => {
  const env = bindings();
  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
  const response = await worker.fetch(post({ image }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(env.modelRequest.images, [`data:image/png;base64,${image}`]);
});

test('invalid, cross-origin, and rate-limited input never calls inference', async () => {
  for (const [request, env, status, expectedRateCalls = 0] of [
    [post({}), bindings(), 400, 0],
    [post({ image: 'dGV4dA==' }), bindings(), 400, 0],
    [post({ text: 'x'.repeat(2001) }), bindings(), 400, 0],
    [new Request('https://foodbyclef.example/api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://foodbyclef.example' }, body: '{' }), bindings(), 400, 0],
    [post({}, { Origin: 'https://other.example' }), bindings(), 403, 0],
    [post(), bindings({ rateAllowed: false }), 429, 1],
    [post(), bindings({ budgetAllowed: false }), 429, 1]
  ]) {
    assert.equal((await worker.fetch(request, env)).status, status);
    assert.equal(env.rateCalls, expectedRateCalls);
    assert.equal(env.calls, 0);
  }
});

test('oversized body (> 6 MiB) returns 413 without calling rate limiter or AI', async () => {
  const env = bindings();
  const oversized = new Request('https://foodbyclef.example/api/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://foodbyclef.example' },
    body: JSON.stringify({ text: 'a'.repeat(6 * 1024 * 1024 + 1) })
  });
  const response = await worker.fetch(oversized, env);
  assert.equal(response.status, 413);
  assert.equal(env.rateCalls, 0);
  assert.equal(env.budgetCalls, 0);
  assert.equal(env.calls, 0);
});

test('hosted status distinguishes Cloudflare from local Ollama', async () => {
  const result = await worker.fetch(new Request('https://foodbyclef.example/api/status'), bindings()).then(response => response.json());
  assert.equal(result.runtime, 'cloudflare');
  assert.equal(result.online, true);
});

test('daily allowance reserves exactly the configured number of concurrent attempts', async () => {
  let usage;
  let queue = Promise.resolve();
  const storage = {
    get: async () => usage,
    put: async (key, value) => { usage = value; },
    transaction: callback => { const result = queue.then(() => callback(storage)); queue = result.catch(() => {}); return result; }
  };
  const budget = new DailyBudget({ storage }, { DAILY_REQUEST_LIMIT: '2' });
  const responses = await Promise.all(Array.from({ length: 5 }, () => budget.fetch(new Request('https://budget/reserve', { method: 'POST' }))));
  assert.equal(responses.filter(response => response.ok).length, 2);
  assert.equal(usage.count, 2);
  usage = { day: '2000-01-01', count: 99 };
  assert.equal((await budget.fetch(new Request('https://budget/reserve', { method: 'POST' }))).status, 200);
  assert.equal(usage.count, 1);
});

test('invalid or zero daily limits disable inference slots', async () => {
  const storage = { get: async () => undefined, transaction: callback => callback(storage) };
  for (const limit of ['0', 'invalid']) {
    const budget = new DailyBudget({ storage }, { DAILY_REQUEST_LIMIT: limit });
    assert.equal((await budget.fetch(new Request('https://budget/reserve', { method: 'POST' }))).status, 429);
  }
});
