import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { decisionRequest as createDecisionRequest, parseDecision, validateInput } from './classification.js';
export { validateInput } from './classification.js';

const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const model = process.env.OLLAMA_MODEL || 'clef-flash';
const port = Number(process.env.PORT || 3000);
const maxBody = 12 * 1024 * 1024;
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/orchestration': ['orchestration.html', 'text/html; charset=utf-8'],
  '/orchestration.html': ['orchestration.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/orchestration.css': ['orchestration.css', 'text/css; charset=utf-8'],
  '/orchestration.js': ['orchestration.js', 'text/javascript; charset=utf-8'],
  '/submissions.json': ['submissions.json', 'application/json; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/rules.js': ['rules.js', 'text/javascript; charset=utf-8'],
  '/specimens.js': ['specimens.js', 'text/javascript; charset=utf-8'],
  '/cube.svg': ['cube.svg', 'image/svg+xml'],
  '/plinko-diagram.jpg': ['plinko-diagram.jpg', 'image/jpeg'],
  '/hybrid-orchestration.jpg': ['hybrid-orchestration.jpg', 'image/jpeg'],
  '/burger.webp': ['burger.webp', 'image/webp'],
  '/pizza.webp': ['pizza.webp', 'image/webp'],
  '/hot-dog.webp': ['hot-dog.webp', 'image/webp'],
  '/wrap.webp': ['wrap.webp', 'image/webp'],
  '/bread-bowl.webp': ['bread-bowl.webp', 'image/webp'],
  '/calzone.webp': ['calzone.webp', 'image/webp'],
  '/lasagna.webp': ['lasagna.webp', 'image/webp'],
  '/cereal.webp': ['cereal.webp', 'image/webp'],
  '/steak.webp': ['steak.webp', 'image/webp']
};

export function decisionRequest({ text, image }, requestedModel = model) {
  return { ...createDecisionRequest({ text, image }, requestedModel), keep_alive: '10m' };
}

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function ollama(path, options = {}) {
  const response = await fetch(`${ollamaUrl}${path}`, { ...options, signal: options.signal || AbortSignal.timeout(5000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Ollama returned ${response.status}.`);
  return data;
}

export const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
  const path = new URL(request.url, 'http://localhost').pathname;
  if (request.method === 'GET' && path === '/api/status') {
    try {
      const [tags, version] = await Promise.all([ollama('/api/tags'), ollama('/api/version')]);
      const models = Array.isArray(tags?.models) ? tags.models : [];
      const installed = models.some(item => item?.name === model || item?.name === `${model}:latest`);
      const availableModels = [...new Set(
        models
          .map(item => item?.name)
          .filter(name => typeof name === 'string' && name.split(':')[0].startsWith('clef'))
          .map(name => name.replace(/:latest$/, ''))
      )];
      return json(response, 200, { online: true, installed: Boolean(installed), model, availableModels, version: version.version });
    } catch {
      return json(response, 200, { online: false, installed: false, model, availableModels: [] });
    }
  }
  if (request.method === 'POST' && path === '/api/classify') {
    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}`) return json(response, 403, { error: 'Requests must come from the local app.' });
    if (!request.headers['content-type']?.includes('application/json')) return json(response, 415, { error: 'Send JSON input.' });
    let input;
    let requestedModel = model;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBody) { json(response, 413, { error: 'Image is too large. Use a file under 8 MB.' }); return; }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      input = validateInput(body);
      if (body.model !== undefined) {
        if (typeof body.model !== 'string' || body.model.length > 64 || !/^[a-zA-Z0-9._:/-]+$/.test(body.model)) {
          throw new Error('Invalid model name.');
        }
        requestedModel = body.model;
      }
    } catch (error) { return json(response, 400, { error: error instanceof SyntaxError ? 'Invalid JSON input.' : error.message }); }
    const start = performance.now();
    const controller = new AbortController();
    const cancel = () => { if (!response.writableEnded) controller.abort(); };
    response.on('close', cancel);
    const timeout = setTimeout(() => controller.abort(), 180000);
    try {
      const data = await ollama('/v1/systemone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(decisionRequest(input, requestedModel)), signal: controller.signal });
      json(response, 200, parseDecision(data, performance.now() - start, requestedModel));
    } catch (error) {
      if (!response.destroyed) json(response, 502, { error: error.name === 'AbortError' ? 'The model took too long. Try again; the first request may need to load the model.' : error.message === 'fetch failed' ? 'Cannot reach Ollama. Open the Ollama app or run ollama serve, then retry.' : error.message });
    } finally { clearTimeout(timeout); response.off('close', cancel); }
    return;
  }
  if (request.method === 'GET' && assets[path]) {
    const [filename, type] = assets[path];
    try {
      const content = await readFile(new URL(`./public/${filename}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': type });
      response.end(content);
    } catch {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Asset unavailable');
    }
    return;
  }
  json(response, 404, { error: 'Not found' });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(port, '127.0.0.1', () => console.log(`Cube Rule → http://localhost:${port}\nModel → ${model} at ${ollamaUrl}`));
