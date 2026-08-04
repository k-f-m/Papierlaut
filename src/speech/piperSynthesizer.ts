import { encodeWave } from './wav.ts';
import type { LoadProgress } from './types.ts';

/**
 * Piper (VITS) speech synthesis, running in this tab.
 *
 * This talks to ONNX Runtime directly rather than through a wrapper, for one
 * reason: an inference session must be built **once per voice**, not once per
 * sentence. Building it means parsing a 63 MB graph, which takes seconds — do
 * that per utterance and no amount of synthesising ahead can hide the gaps.
 *
 * So the expensive things are cached for the lifetime of the page (the runtime,
 * the model, the session, the voice config) and only phonemisation and
 * inference happen per sentence.
 *
 * Everything is loaded from this origin: the model and its config from
 * `/tts/voices/`, the ONNX WebAssembly runtime from `/tts/onnx/`, and the
 * espeak-ng phonemiser from `/tts/piper/`. No text is transmitted anywhere.
 */

/** The fields of a Piper `.onnx.json` that inference needs. */
interface VoiceConfig {
  readonly espeak: { readonly voice: string };
  readonly audio: { readonly sample_rate: number };
  readonly inference: {
    readonly noise_scale: number;
    readonly length_scale: number;
    readonly noise_w: number;
  };
  readonly speaker_id_map: Readonly<Record<string, number>>;
}

interface PhonemizeModule {
  callMain(args: string[]): void;
}

type PhonemizeFactory = (options: {
  print(line: string): void;
  printErr(line: string): void;
  locateFile(path: string): string;
}) => Promise<PhonemizeModule>;

declare global {
  // eslint-disable-next-line no-var
  var createPiperPhonemize: PhonemizeFactory | undefined;
}

type Ort = typeof import('onnxruntime-web');

export interface SynthesisRequest {
  readonly voiceId: string;
  /** Path of the model under `/tts/voices/`, from voices.catalog.json. */
  readonly modelPath: string;
  readonly text: string;
}

export interface Synthesis {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

interface LoadedVoice {
  readonly config: VoiceConfig;
  readonly session: import('onnxruntime-web').InferenceSession;
}

const ASSET_BASE = '/tts';

export class PiperSynthesizer {
  readonly #base: string;
  #ort: Promise<Ort> | undefined;
  #phonemizer: Promise<PhonemizeFactory> | undefined;
  #voices = new Map<string, Promise<LoadedVoice>>();

  constructor(base: string = ASSET_BASE) {
    this.#base = base;
  }

  /**
   * Prepares a voice for use. Idempotent, and safe to call concurrently — the
   * in-flight promise is shared, so a second caller waits rather than starting
   * a second 63 MB download.
   */
  load(request: Omit<SynthesisRequest, 'text'>, onProgress?: (progress: LoadProgress) => void): Promise<void> {
    return this.#voice(request, onProgress).then(() => undefined);
  }

  async synthesize(request: SynthesisRequest): Promise<Synthesis> {
    const { config, session } = await this.#voice(request);
    const ort = await this.#runtime();

    // espeak may return more than one phoneme line for a single input — it
    // applies its own sentence rules. Each line is inferred separately and the
    // audio concatenated, so no text is silently dropped.
    const lines = await this.#phonemize(config, request.text);
    const chunks: Float32Array[] = [];
    for (const ids of lines) {
      if (ids.length === 0) continue;
      chunks.push(await this.#infer(ort, session, config, ids));
    }

    return { samples: concat(chunks), sampleRate: config.audio.sample_rate };
  }

  /** Convenience for callers that want something an `<audio>` element can play. */
  async synthesizeToWave(request: SynthesisRequest): Promise<{ blob: Blob; synthesis: Synthesis }> {
    const synthesis = await this.synthesize(request);
    const buffer = encodeWave(synthesis.samples, synthesis.sampleRate);
    return { blob: new Blob([buffer], { type: 'audio/wav' }), synthesis };
  }

  // --- Cached, expensive pieces --------------------------------------------

  #runtime(): Promise<Ort> {
    this.#ort ??= (async () => {
      const ort = await import('onnxruntime-web');
      ort.env.wasm.wasmPaths = `${this.#base}/onnx/`;
      // Threads need cross-origin isolation; without it ORT falls back to one.
      ort.env.wasm.numThreads = globalThis.crossOriginIsolated
        ? Math.min(navigator.hardwareConcurrency || 1, 4)
        : 1;
      return ort;
    })();
    return this.#ort;
  }

  /**
   * The phonemiser ships as an Emscripten UMD bundle that assigns a global, so
   * it is loaded with a script element rather than an import. It is fetched
   * once; a module instance is still created per call, because `callMain` runs
   * the program to completion and the runtime is not reusable afterwards.
   */
  #phonemizerFactory(): Promise<PhonemizeFactory> {
    this.#phonemizer ??= new Promise<PhonemizeFactory>((resolve, reject) => {
      if (globalThis.createPiperPhonemize) {
        resolve(globalThis.createPiperPhonemize);
        return;
      }
      const script = document.createElement('script');
      script.src = `${this.#base}/piper/piper_phonemize.js`;
      script.addEventListener('load', () => {
        const factory = globalThis.createPiperPhonemize;
        if (factory) resolve(factory);
        else reject(new Error('piper_phonemize.js did not define createPiperPhonemize'));
      });
      script.addEventListener('error', () => reject(new Error('Could not load the phonemiser')));
      document.head.append(script);
    }).catch((error: unknown) => {
      this.#phonemizer = undefined;
      throw error;
    });
    return this.#phonemizer;
  }

  #voice(
    request: Omit<SynthesisRequest, 'text'>,
    onProgress?: (progress: LoadProgress) => void,
  ): Promise<LoadedVoice> {
    const existing = this.#voices.get(request.voiceId);
    if (existing) return existing;

    const pending = this.#loadVoice(request, onProgress).catch((error: unknown) => {
      // Never remember a failure, or a retry would resolve instantly with it.
      this.#voices.delete(request.voiceId);
      throw error;
    });
    this.#voices.set(request.voiceId, pending);
    return pending;
  }

  async #loadVoice(
    request: Omit<SynthesisRequest, 'text'>,
    onProgress?: (progress: LoadProgress) => void,
  ): Promise<LoadedVoice> {
    const ort = await this.#runtime();
    const modelUrl = `${this.#base}/voices/${request.modelPath}`;

    const configResponse = await fetch(`${modelUrl}.json`);
    if (!configResponse.ok) {
      throw new Error(`Voice config unavailable (${configResponse.status})`);
    }
    const config = (await configResponse.json()) as VoiceConfig;

    const model = await fetchWithProgress(modelUrl, onProgress);
    const session = await ort.InferenceSession.create(model, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    return { config, session };
  }

  // --- Per sentence ---------------------------------------------------------

  async #phonemize(config: VoiceConfig, text: string): Promise<number[][]> {
    const factory = await this.#phonemizerFactory();
    const lines: number[][] = [];
    let failure: Error | undefined;

    const module = await factory({
      print: (line) => {
        try {
          const parsed = JSON.parse(line) as { phoneme_ids?: number[] };
          if (parsed.phoneme_ids) lines.push(parsed.phoneme_ids);
        } catch {
          failure ??= new Error(`Unexpected phonemiser output: ${line.slice(0, 120)}`);
        }
      },
      printErr: (line) => {
        failure ??= new Error(line);
      },
      locateFile: (path) => {
        if (path.endsWith('.wasm')) return `${this.#base}/piper/piper_phonemize.wasm`;
        if (path.endsWith('.data')) return `${this.#base}/piper/piper_phonemize.data`;
        return path;
      },
    });

    module.callMain([
      '-l',
      config.espeak.voice,
      '--input',
      JSON.stringify([{ text: text.trim() }]),
      '--espeak_data',
      '/espeak-ng-data',
    ]);

    if (failure) throw failure;
    return lines;
  }

  async #infer(
    ort: Ort,
    session: import('onnxruntime-web').InferenceSession,
    config: VoiceConfig,
    phonemeIds: readonly number[],
  ): Promise<Float32Array> {
    const ids = BigInt64Array.from(phonemeIds, (id) => BigInt(id));
    const { noise_scale: noise, length_scale: length, noise_w: noiseW } = config.inference;

    const feeds: Record<string, import('onnxruntime-web').Tensor> = {
      input: new ort.Tensor('int64', ids, [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([noise, length, noiseW]), [3]),
    };
    // Multi-speaker models require a speaker id; single-speaker ones reject it.
    if (Object.keys(config.speaker_id_map).length > 0) {
      feeds['sid'] = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
    }

    const results = await session.run(feeds);
    const output = results['output'] ?? results[session.outputNames[0] ?? 'output'];
    if (!output) throw new Error('Model produced no output');
    return output.data as Float32Array;
  }
}

async function fetchWithProgress(
  url: string,
  onProgress?: (progress: LoadProgress) => void,
): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Voice model unavailable (${response.status})`);

  const total = Number(response.headers.get('content-length') ?? 0);
  if (!response.body || total === 0 || !onProgress) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress({ loaded, total });
  }

  const model = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    model.set(chunk, offset);
    offset += chunk.length;
  }
  return model;
}

function concat(chunks: readonly Float32Array[]): Float32Array {
  if (chunks.length === 1) return chunks[0] as Float32Array;
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}
