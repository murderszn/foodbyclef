# Cube Rule — Local Edition

A manifesto-inspired local web app that classifies food names, descriptions, and photos using Clef Flash through Ollama. All nine Cube Rule categories, probability breakdowns, ambiguity detection, copy/export, and browser-local case history. Local use requires no cloud services, API keys, build step, or runtime npm dependencies.

## Hosted edition

The public demo is **https://foodbyclef.pages.dev**. It runs on Cloudflare Workers with Cloudflare's hosted Clef Flash model. A small Pages service binding forwards requests to the `foodbyclef` Worker, providing a short public URL without an account-name suffix. The Worker is also reachable at https://foodbyclef.jjohnso75.workers.dev. Both addresses share the same daily allowance.

The local edition continues to use Ollama with `npm start`; it does not call Cloudflare.

```sh
npm install
npm run deploy:cloudflare
```

Wrangler must be logged in to the Cloudflare account in `wrangler.jsonc`. The Worker serves the assets, adapts the page to clearly disclose Cloudflare processing, and calls `@cf/cloudflare/clef-flash` through its AI binding. No API credentials are exposed in the browser. Text and resized photographs are sent to Cloudflare; the application does not persist uploads or log inputs. History still stays in localStorage. Cloudflare's own service policies apply.

The hosted demo limits inference to five requests per minute per IP (Cloudflare location-local rate limiter) and 1,000 inference attempts per UTC day globally. A Durable Object atomically reserves daily slots before inference, so concurrent requests cannot exceed the daily allowance. Failed inference attempts also count. Change `DAILY_REQUEST_LIMIT` in `wrangler.jsonc` and redeploy to adjust the limit; set it to `0` to disable inference. This is a request cap, not an exact dollar budget. Inputs are limited to 2,000 text characters and 4 MiB per resized image. AI and Durable Object usage follows your Cloudflare plan.

`npm run dev:cloudflare` previews the hosted edition. Cloudflare AI bindings can use remote inference during development; use `npm start` for local-only inference.

## Run

Requires Node.js 22+ and Ollama 0.35.1+.

```sh
ollama pull clef-flash
```

Open the Ollama Mac app (or run `ollama serve` in another terminal), then:

```sh
npm start
```

Open **http://localhost:3000**. The server binds to loopback, keeping it local to this Mac. `npm run dev` enables server restart on file changes.

## Use

Enter a food name, add preparation details, upload/drop/paste a PNG, JPEG, or WebP photo (up to 8 MB), or combine text and an image. Images are resized locally to a maximum dimension of 1,280 pixels before inference. The model may need time to load on its first request; requests have a three-minute timeout and can be canceled.

The backend calls Ollama's **`/v1/systemone`**, not a chat completion endpoint. Clef scores nine explicit category criteria plus food-presence and ambiguity questions. Scores are model preferences, not calibrated accuracy estimates. The displayed explanation is the selected category's definition, not a generated rationale. Unclear and non-food inputs receive a notice; non-food results aren't added to history.

History stores up to 30 results in this browser's localStorage. Photos and image bytes are never saved in history or by the web server. Copy a ruling or download its JSON case file; clear history in the app. The app uses system fonts and original SVG diagrams, so no external assets are requested during normal use.

## Configuration

```sh
PORT=3001 OLLAMA_URL=http://127.0.0.1:11434 OLLAMA_MODEL=clef-flash npm start
```

Point `OLLAMA_URL` only at a trusted local Ollama server if you want photos to stay on this Mac. A larger Clef decision model can be selected with `OLLAMA_MODEL=clef` after installing it. The connection indicator checks Ollama and whether the configured model is installed.

## Verify

```sh
npm test
```

Tests cover category definitions, decision request construction, input validation, and HTTP request handling with mocked Ollama responses, without opening test sockets. Real model accuracy depends on the visible starch structure and preparation; ambiguous foods benefit from explicit descriptions.

## Files

- `server.js`: dependency-free local HTTP server and Ollama gateway.
- `classification.js`: shared input validation and decision schema.
- `cloudflare/worker.js`, `wrangler.jsonc`: hosted API, page adaptation, and usage limits.
- `cloudflare/pages/`: public URL gateway, connected through a Cloudflare service binding.
- `public/index.html`, `public/style.css`: responsive interface.
- `public/app.js`: uploads, inference, results, and local history.
- `public/rules.js`: shared category criteria and original cube illustrations.
- `test/server.test.js`: API and validation tests.
- `test/cloudflare.test.js`: hosted API and daily allowance tests.

## Sources

Inspired by [The Cube Rule](https://cuberule.com/) by @Phosphatide and @indirect. Model integration follows [Ollama's decision API](https://docs.ollama.com/capabilities/decision) and [Clef Flash documentation](https://ollama.com/library/clef-flash). This is an independent local application.
