import { decisionRequest, validateInput, parseDecision } from '../classification.js';

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"
};

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, { status, headers: { ...securityHeaders, 'Cache-Control': 'no-store', ...extraHeaders } });
}

async function readInput(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Send a food description or photograph.');
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 6 * 1024 * 1024) {
      await reader.cancel();
      const error = new Error('This photograph is too large. Try a smaller image.');
      error.status = 413;
      throw error;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return validateInput(JSON.parse(new TextDecoder().decode(bytes)), 4 * 1024 * 1024);
}

function hostedHtml(response) {
  const rewrite = content => ({ element(element) { element.setInnerContent(content, { html: true }); } });
  return new HTMLRewriter()
    .on('body', { element(element) { element.setAttribute('data-runtime', 'cloudflare'); } })
    .on('.privacy', rewrite('Text and photos are sent to Cloudflare for classification.'))
    .transform(response);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/status' && request.method === 'GET') return json({ online: true, installed: true, model: 'clef-flash', runtime: 'cloudflare' });
    if (url.pathname === '/api/classify' && request.method === 'POST') {
      if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return json({ error: 'Requests must come from this app.' }, 403);
      if (!request.headers.get('Content-Type')?.includes('application/json')) return json({ error: 'Send JSON input.' }, 415);
      let input;
      try { input = await readInput(request); }
      catch (error) { return json({ error: error instanceof SyntaxError ? 'Invalid JSON input.' : error.message }, error.status || 400); }
      const { success } = await env.RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
      if (!success) return json({ error: 'A few too many rulings at once. Please wait a minute and try again.' }, 429, { 'Retry-After': '60' });
      const budget = env.DAILY_BUDGET.get(env.DAILY_BUDGET.idFromName('public-demo'));
      const allowance = await budget.fetch('https://budget.internal/reserve', { method: 'POST' });
      if (!allowance.ok) return json({ error: 'Today’s public demo allowance has been used. Please return tomorrow.' }, 429, { 'Retry-After': String(Math.ceil((Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) + 86400000 - Date.now()) / 1000)) });
      const started = performance.now();
      try {
        const modelRequest = decisionRequest(input);
        if (input.image) {
          const mimeType = input.image.startsWith('/9j/') ? 'image/jpeg' : input.image.startsWith('iVBOR') ? 'image/png' : 'image/webp';
          modelRequest.images = [`data:${mimeType};base64,${input.image}`];
        }
        const data = await env.AI.run('@cf/cloudflare/clef-flash', modelRequest);
        return json({ ...parseDecision(data, performance.now() - started), runtime: 'cloudflare' });
      } catch (error) {
        console.error('Hosted inference failed:', error.message);
        return json({ error: 'Clef is temporarily unavailable. Please try again shortly.' }, 502);
      }
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
    if (response.headers.get('Content-Type')?.includes('text/html')) {
      response.headers.set('Cache-Control', 'no-cache');
      return hostedHtml(response);
    }
    return response;
  }
};

export class DailyBudget {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const day = new Date().toISOString().slice(0, 10);
    const configuredLimit = Number(this.env.DAILY_REQUEST_LIMIT ?? 1000);
    const limit = Number.isFinite(configuredLimit) ? Math.max(0, configuredLimit) : 0;
    const allowed = await this.state.storage.transaction(async storage => {
      const usage = await storage.get('usage');
      const count = usage?.day === day ? usage.count : 0;
      if (count >= limit) return false;
      await storage.put('usage', { day, count: count + 1 });
      return true;
    });
    return json({ allowed }, allowed ? 200 : 429);
  }
}
