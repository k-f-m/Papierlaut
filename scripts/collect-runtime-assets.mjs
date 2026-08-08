#!/usr/bin/env node
/**
 * Copies the WebAssembly runtime pieces the neural voice needs out of
 * node_modules and into `public/tts/`, so they are served from our own origin
 * instead of cdnjs / jsDelivr.
 *
 *   public/tts/onnx/    ONNX Runtime Web binaries  (ort.env.wasm.wasmPaths)
 *   public/tts/piper/   espeak-ng phonemizer       (piper_phonemize.*)
 *   public/assets/      Bergamot translator runtime (see below)
 *
 * Runs inside the container on every build; it is cheap and idempotent.
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageDir } from './lib/packageDir.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = join(root, 'public', 'tts');

/**
 * ORT ships far more than we serve. The loader picks one `.wasm` at runtime
 * based on the browser's SIMD and threading support, so all the inference
 * variants have to be present — but the training runtime never is, and it is
 * 10.8 MB.
 */
const ONNX_INCLUDE = [/\.wasm$/, /\.worker\.js$/, /^ort-wasm.*\.mjs$/];
const ONNX_EXCLUDE = [/training/];

const PIPER_FILES = ['piper_phonemize.js', 'piper_phonemize.wasm', 'piper_phonemize.data'];

/**
 * Bergamot's worker is a *classic* worker: it calls
 * `importScripts('bergamot-translator-worker.js')` and fetches its `.wasm` as a
 * sibling of itself. Vite bundles the worker into `dist/assets/` with a hashed
 * name, so these two have to land in that same directory or both lookups break.
 * `public/` is copied to the dist root, which is why they go to public/assets/.
 *
 * The library's documented `workerUrl` option would have avoided this, but in
 * 0.4.9 it is never read — the worker path is hardcoded.
 */
const BERGAMOT_FILES = ['bergamot-translator-worker.js', 'bergamot-translator-worker.wasm'];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyOnnxRuntime() {
  const dist = join(packageDir('onnxruntime-web', root), 'dist');
  const target = join(outRoot, 'onnx');
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  const names = await readdir(dist);
  const wanted = names.filter(
    (name) => ONNX_INCLUDE.some((re) => re.test(name)) && !ONNX_EXCLUDE.some((re) => re.test(name)),
  );
  if (wanted.length === 0) {
    throw new Error(`No ONNX Runtime binaries found in ${dist}`);
  }
  for (const name of wanted) {
    await cp(join(dist, name), join(target, name));
  }
  return wanted.length;
}

async function copyPhonemizer() {
  const build = join(packageDir('@diffusionstudio/piper-wasm', root), 'build');
  const target = join(outRoot, 'piper');
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  for (const name of PIPER_FILES) {
    const from = join(build, name);
    if (!(await exists(from))) {
      throw new Error(`Missing phonemizer asset ${from}`);
    }
    await cp(from, join(target, name));
  }
  return PIPER_FILES.length;
}

async function copyBergamotRuntime() {
  const source = join(packageDir('@browsermt/bergamot-translator', root), 'worker');
  const target = join(root, 'public', 'assets');
  await mkdir(target, { recursive: true });

  for (const name of BERGAMOT_FILES) {
    const from = join(source, name);
    if (!(await exists(from))) throw new Error(`Missing Bergamot asset ${from}`);
    await cp(from, join(target, name));
  }
  return BERGAMOT_FILES.length;
}

const onnx = await copyOnnxRuntime();
const piper = await copyPhonemizer();
const bergamot = await copyBergamotRuntime();
console.log(`[assets] ONNX Runtime: ${onnx} file(s) -> public/tts/onnx/`);
console.log(`[assets] Phonemizer:   ${piper} file(s) -> public/tts/piper/`);
console.log(`[assets] Bergamot:     ${bergamot} file(s) -> public/assets/`);
