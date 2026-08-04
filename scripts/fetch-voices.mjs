#!/usr/bin/env node
/**
 * Mirrors the selected Piper voice models into `public/tts/voices/`, laid out
 * exactly like the upstream repository so the rewritten library URLs resolve.
 *
 * This is the only step that touches the network, it runs inside the container
 * at image-build time, and it downloads model weights — never document text.
 * Once the image is built the app needs no network at all.
 *
 * Selection comes from the PIPER_VOICES environment variable (comma separated
 * voice ids), defaulting to `defaultSelection` in voices.catalog.json. Set
 * PIPER_VOICES="" to skip entirely and rely on the Web Speech fallback.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = join(root, 'public', 'tts', 'voices');

const UPSTREAM = process.env.PIPER_VOICE_BASE_URL
  ?? 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main';

const catalog = JSON.parse(await readFile(join(root, 'voices.catalog.json'), 'utf8'));

function parseSelection() {
  const raw = process.env.PIPER_VOICES;
  if (raw === undefined) return catalog.defaultSelection;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function sizeOf(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return -1;
  }
}

/** Downloads to a temp name and renames, so an interrupted build never leaves a half file behind. */
async function download(url, target) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`GET ${url} -> ${response.status} ${response.statusText}`);
  }
  const expected = Number(response.headers.get('content-length') ?? 0);
  const temp = `${target}.part`;
  await mkdir(dirname(target), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temp));

  const written = await sizeOf(temp);
  if (expected > 0 && written !== expected) {
    await rm(temp, { force: true });
    throw new Error(`${url}: expected ${expected} bytes, wrote ${written}`);
  }
  await rename(temp, target);
  return written;
}

async function ensure(url, target) {
  const existing = await sizeOf(target);
  if (existing > 0) {
    console.log(`[voices] cached  ${target.slice(root.length + 1)} (${(existing / 1e6).toFixed(1)} MB)`);
    return existing;
  }
  const bytes = await download(url, target);
  console.log(`[voices] fetched ${target.slice(root.length + 1)} (${(bytes / 1e6).toFixed(1)} MB)`);
  return bytes;
}

const selection = parseSelection();
const byId = new Map(catalog.voices.map((v) => [v.id, v]));
const installed = [];

for (const id of selection) {
  const meta = byId.get(id);
  if (!meta) {
    throw new Error(`Voice "${id}" is not listed in voices.catalog.json`);
  }
  if (!meta.path) {
    throw new Error(`Voice "${id}" has no model path in voices.catalog.json`);
  }
  const model = join(outRoot, meta.path);
  const bytes = await ensure(`${UPSTREAM}/${meta.path}`, model);
  await ensure(`${UPSTREAM}/${meta.path}.json`, `${model}.json`);
  installed.push({ ...meta, bytes });
}

await mkdir(outRoot, { recursive: true });
await writeFile(
  join(outRoot, 'manifest.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), voices: installed }, null, 2)}\n`,
);

if (installed.length === 0) {
  console.warn('[voices] No neural voices installed — the app will fall back to local system voices.');
} else {
  const total = installed.reduce((sum, v) => sum + v.bytes, 0);
  console.log(`[voices] ${installed.length} voice(s) installed, ${(total / 1e6).toFixed(0)} MB total.`);
}
