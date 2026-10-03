# Cube Rule — Local Edition

A manifesto-inspired local web app that classifies food names, descriptions, and photos using Clef Flash through Ollama. All nine Cube Rule categories, probability breakdowns, ambiguity detection, copy/export, and browser-local case history. No cloud services, API keys, build step, or npm dependencies.

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
- `public/index.html`, `public/style.css`: responsive interface.
- `public/app.js`: uploads, inference, results, and local history.
- `public/rules.js`: shared category criteria and original cube illustrations.
- `test/server.test.js`: API and validation tests.

## Sources

Inspired by [The Cube Rule](https://cuberule.com/) by @Phosphatide and @indirect. Model integration follows [Ollama's decision API](https://docs.ollama.com/capabilities/decision) and [Clef Flash documentation](https://ollama.com/library/clef-flash). This is an independent local application.
