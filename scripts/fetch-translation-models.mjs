#!/usr/bin/env node
/**
 * Mirrors the selected translation models into `public/mt/<pair id>/`.
 *
 * Like scripts/fetch-voices.mjs this is a build-time step: it runs inside the
 * container while the image is built, it downloads model weights and never
 * document text, and once the image exists the app needs no network at all.
 * That is the whole point — it is what lets translation be covered by the same
 * `connect-src 'self'` policy as everything else, rather than relying on a
 * browser component the page cannot see.
 *
 * Models come from the Remote Settings CDN that Firefox itself uses. Each record
 * carries a sha256, which is verified after download; a mismatch fails the build
 * rather than baking a corrupt model into the image.
 *
 * Selection comes from TRANSLATION_PAIRS (comma separated pair ids), defaulting
 * to `defaultSelection` in translation.catalog.json. Set TRANSLATION_PAIRS="" to
 * skip entirely and fall back to whatever the browser itself offers.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = join(root, 'public', 'mt');

const catalog = JSON.parse(await readFile(join(root, 'translation.catalog.json'), 'utf8'));
const recordsUrl = process.env.TRANSLATION_RECORDS_URL ?? catalog.source.records;
const attachmentsBase = process.env.TRANSLATION_ATTACHMENTS_URL ?? catalog.source.attachments;

/**
 * The three files a Bergamot model needs. Remote Settings calls the shortlist
 * "lex"; the Bergamot registry calls it "shortlist", so the names are mapped
 * on the way out.
 */
const FILE_TYPES = ['model', 'lex', 'vocab'];
const REGISTRY_PART = { model: 'model', lex: 'shortlist', vocab: 'vocab' };

function parseSelection() {
  const raw = process.env.TRANSLATION_PAIRS;
  if (raw === undefined) return catalog.defaultSelection;
  return raw.split(',').map((value) => value.trim()).filter(Boolean);
}

function pairById(id) {
  const pair = catalog.pairs.find((candidate) => candidate.id === id);
  if (!pair) throw new Error(`Unknown pair "${id}" — not in translation.catalog.json`);
  return pair;
}

/** The records for one pinned pair, one per file type. */
function recordsFor(records, pair) {
  const matching = records.filter(
    (record) =>
      record.fromLang === pair.from &&
      record.toLang === pair.to &&
      record.version === pair.version,
  );

  return FILE_TYPES.map((fileType) => {
    const record = matching.find((candidate) => candidate.fileType === fileType);
    if (!record) {
      throw new Error(`No ${fileType} published for ${pair.id} at version ${pair.version}`);
    }
    return { fileType, record };
  });
}

/** Downloads to a temp name and renames, so an interrupted build leaves no half file. */
async function download(url, target, expected) {
  // Already present and intact: a rebuild should not re-pull 30 MB.
  try {
    const existing = await readFile(target);
    if (existing.length === expected.size
      && createHash('sha256').update(existing).digest('hex') === expected.hash) {
      return -1;
    }
  } catch {
    // Not there, or unreadable — fall through and fetch it.
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status} ${response.statusText}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== expected.hash) {
    throw new Error(`${url}: sha256 ${digest} does not match the published ${expected.hash}`);
  }
  if (bytes.length !== expected.size) {
    throw new Error(`${url}: expected ${expected.size} bytes, got ${bytes.length}`);
  }

  const temp = `${target}.part`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temp, bytes);
  await rename(temp, target);
  return bytes.length;
}

const selection = parseSelection();
if (selection.length === 0) {
  // An empty registry rather than no directory at all: the image build copies
  // this path unconditionally, and the app reads the registry to decide what it
  // can offer — no entries means it offers nothing and falls back.
  await mkdir(outRoot, { recursive: true });
  await writeFile(join(outRoot, 'index.json'), '{}\n');
  console.log('TRANSLATION_PAIRS is empty — no translation models will be bundled.');
  process.exit(0);
}

console.log(`Fetching translation models: ${selection.join(', ')}`);

const response = await fetch(recordsUrl);
if (!response.ok) {
  throw new Error(`GET ${recordsUrl} -> ${response.status} ${response.statusText}`);
}
const { data: records } = await response.json();

let total = 0;
const manifest = [];

for (const id of selection) {
  const pair = pairById(id);
  const wanted = recordsFor(records, pair);
  const files = {};

  for (const { fileType, record } of wanted) {
    const { attachment } = record;
    const target = join(outRoot, pair.id, attachment.filename);
    const url = new URL(attachment.location, attachmentsBase).href;

    process.stdout.write(`  ${pair.id}/${attachment.filename} … `);
    const written = await download(url, target, attachment);
    total += Math.max(written, 0);
    files[REGISTRY_PART[fileType]] = {
      // Served from our own origin, so the model load is covered by the same
      // `connect-src 'self'` policy as everything else the app fetches.
      name: `/mt/${pair.id}/${attachment.filename}`,
      size: attachment.size,
      expectedSha256Hash: attachment.hash,
    };
    console.log(written < 0 ? 'cached' : `${(written / 1048576).toFixed(1)} MB ok`);
  }

  manifest.push({ id: pair.id, from: pair.from, to: pair.to, label: pair.label, version: pair.version, files });
}

// Bergamot's own registry format, keyed "deen" style, so the library can be
// pointed at our origin instead of its default S3 bucket with no patching. It
// lists only what was actually downloaded, so a build with a narrower selection
// cannot advertise a model that is not in the image.
const registry = Object.fromEntries(
  manifest.map((entry) => [`${entry.from}${entry.to}`, entry.files]),
);
await writeFile(join(outRoot, 'index.json'), `${JSON.stringify(registry, null, 2)}\n`);

console.log(`Done — ${(total / 1048576).toFixed(1)} MB in ${selection.length} pair(s).`);
