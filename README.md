# Papierlaut

Drop a `.docx`, `.md`, `.html` or `.txt` file into the browser and it is read
aloud in a natural German or English voice, with the current line and the current
word highlighted as the voice moves through the text.

**No part of the document leaves the machine.** There is no upload, no API call
and no telemetry. Speech is synthesised in the tab, by a neural model that ships
with the container.

---

## Run it

Requires Docker. Nothing is installed on the host — the toolchain, the
dependencies and the voice models all live inside the image.

```bash
docker compose up --build app
# → http://localhost:8080
```

The first build downloads two voice models (~130 MB) and takes a few minutes.
Afterwards the image is self-contained: it works with the network disconnected.

| Command                                    | What it does                                  |
| ------------------------------------------ | --------------------------------------------- |
| `docker compose up --build app`             | Production build behind nginx, port 8080      |
| `docker compose --profile dev up dev`       | Vite dev server with hot reload, port 5173    |
| `docker compose run --rm test`              | Unit tests                                    |
| `docker compose run --rm typecheck`         | TypeScript check                              |

### Choosing voices

Voices are declared in [`voices.catalog.json`](voices.catalog.json) and selected
at build time:

```bash
PIPER_VOICES=de_DE-thorsten-medium,en_US-lessac-medium,en_GB-cori-high \
  docker compose up --build app
```

Available: `de_DE-thorsten-medium`, `de_DE-kerstin-low`, `de_DE-eva_k-x_low`,
`en_US-lessac-medium`, `en_US-ryan-medium`, `en_GB-alan-medium`,
`en_GB-cori-high`. Each is roughly 63 MB. `PIPER_VOICES=""` builds without
neural voices and falls back to whatever offline voices the operating system
provides.

---

## Using it

Drop a file anywhere on the window, or click **Choose file**.

| Input                | Action                                     |
| -------------------- | ------------------------------------------ |
| `Space`              | Play / pause                               |
| `←` / `→`            | Previous / next sentence                   |
| `−` / `+`            | Slower / faster                            |
| `Esc`                | Stop                                       |
| Click any word       | Start reading from there                   |

The language is detected from the document and the matching voice is selected
automatically; both can be overridden in the toolbar. The interface itself is
available in German and English.

---

## How the privacy guarantee actually works

Three independent mechanisms, so that no single mistake can break it:

**1. The synthesiser is local.** Piper (a VITS neural model) runs through ONNX
Runtime on WebAssembly, inside the tab. Model weights, the espeak-ng phonemiser
and the runtime binaries are baked into the image and served from the app's own
origin — the app talks to ONNX Runtime directly, so every URL it requests is one
it constructs itself under `/tts/`.

**2. The browser is told to block outbound connections.** nginx serves a
`Content-Security-Policy` with `connect-src 'self'` and `default-src 'self'`
([`docker/security-headers.conf`](docker/security-headers.conf)). A `fetch`,
`XHR` or WebSocket to any other origin is refused by the browser before it is
sent — including one smuggled in through a dropped file.

**3. Dropped markup is sanitised.** Every document goes through DOMPurify, and
any attribute that could trigger a remote request (`src`, `srcset`,
`background`, `poster`) is stripped unless it is a `data:` URI
([`src/documents/sanitize.ts`](src/documents/sanitize.ts)). Word documents carry
their images inline, so nothing readable is lost.

### The one thing to know about system voices

The Web Speech API is offered as a fallback, but it has a trap: the
best-sounding voices in Chrome and Edge — anything named *"… Online"*, and
Google's voices — **synthesise on a vendor server**, which means the sentence is
sent to them. CSP cannot block this, because speech synthesis does not go
through the page's network stack.

So the app filters the list to voices reporting `localService === true`
([`src/speech/systemVoiceEngine.ts`](src/speech/systemVoiceEngine.ts)). Network
voices are never offered, whatever they sound like. The neural voices are the
answer to wanting both quality and privacy.

### One console message that is expected

**`CSP blocked a JavaScript eval … (Missing 'unsafe-eval')` from `ort.min.js`.**
Harmless. It is protobufjs's `inquire()`, which probes for CommonJS via `eval`
inside a `try`/`catch` and is *meant* to fail in a browser. Firefox reports the
violation even though the exception is caught, so the message appears while
nothing is actually broken. `'unsafe-eval'` is deliberately not granted.

Two CSP details are load-bearing and should not be tightened without testing:
`'wasm-unsafe-eval'`, which lets WebAssembly be instantiated at all, and `blob:`
in **`script-src`** — ONNX Runtime spawns its inference workers from Blob URLs,
and Firefox checks those against `script-src-elem`, which falls back to
`script-src`. Listing `blob:` only under `worker-src` satisfies Chrome and
breaks Firefox.

### Verifying it yourself

Open DevTools → Network, tick *Disable cache*, read a document. After the
initial page and model load there is no further request. Or simply disconnect
the network: everything keeps working.

---

## How the highlighting stays in sync

The two engines have opposite problems, so they are solved differently behind
one interface ([`src/speech/types.ts`](src/speech/types.ts)).

The Web Speech API reports word boundaries as it speaks, so those events are
used directly — the highlight is exact.

Piper does not: it returns a finished waveform with no timing information at
all. Reconstructing the timing is the interesting part:

1. Each **sentence** is synthesised separately — the unit that keeps prosody
   natural while bounding how far the highlight can drift.
2. The raw samples are measured ([`src/speech/wav.ts`](src/speech/wav.ts)) for
   duration and, importantly, for the silence the model padded the clip with.
   Without subtracting that lead-in, every sentence would start its highlight a
   beat early.
3. The speech in between is distributed across the words by a weight per word:
   syllable count, plus the pause its trailing punctuation earns
   ([`src/speech/wordTiming.ts`](src/speech/wordTiming.ts)).
4. A `requestAnimationFrame` loop reads `audio.currentTime` and moves the
   highlight, so it repaints in the same frame it is computed and self-corrects
   after a pause or a seek.

Because step 1 re-anchors at every sentence, estimation error never accumulates
across a document.

---

## Layout

```
src/
  documents/   parsing (.docx, .md, .html, .txt) and sanitisation
  reading/     segmentation, language detection, the word/sentence DOM model
  speech/      the engine interface, Piper, Web Speech, timing
  app/         the reading session — the playback state machine
  ui/          controller, i18n, settings
scripts/       build-time asset collection and voice download
docker/        nginx config and security headers
```

**Inference sessions are built once per voice, never per sentence.**
`PiperSynthesizer` holds the ONNX Runtime module, the model and the session for
the lifetime of the page; only phonemisation and `session.run` happen per
sentence. This is the whole reason the app drives ONNX Runtime directly instead
of using a wrapper: building a session parses a 63 MB graph and takes seconds,
and doing that per utterance leaves gaps no amount of synthesising ahead can
hide.

Three further notes on the design:

- **The document is the source of truth.** Words and sentences are wrapped in
  spans once, at load, and highlighting only toggles classes on them. No layout
  is read on the hot path, so a long document stays smooth.

- **A word may be more than one span.** `Papier<b>laut</b>` is a single word split
  across elements; the model keeps them together, which is why the highlight
  never breaks mid-word.

- **Sentences are wrapped too, not just words.** A sentence highlight built from
  word spans alone would leave the spaces between them unpainted and look like a
  row of disconnected boxes.

---

## Development

If you prefer to work outside Docker you will need Node 22.12+ or 24, then
`npm install && npm run assets && npm run dev`. The Docker path exists so that
is never necessary.

Tests cover the pure logic — timing estimation, WAV analysis, segmentation,
language detection, voice selection — plus the DOM model, the sanitiser and the
playback state machine against a fake engine.

## Licence

MIT. The Piper voice models carry their own licences, listed in each model's
`MODEL_CARD` upstream.
