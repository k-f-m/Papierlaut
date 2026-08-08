import type { LoadProgress } from '../types/progress.ts';
import type { LanguagePair, TranslationEngine } from './types.ts';

/**
 * The browser's own on-device translator, as exposed by Chrome's Translator API.
 *
 * Typed structurally and injected rather than reached for on `globalThis`: the
 * shape is still moving, and this keeps the adapter testable without a browser.
 */
export interface BuiltInTranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (monitor: DownloadMonitor) => void;
  }): Promise<BuiltInTranslatorInstance>;
}

export interface DownloadMonitor {
  addEventListener(event: string, handler: (event: unknown) => void): void;
}

export interface BuiltInTranslatorInstance {
  translate(text: string): Promise<string>;
}

declare global {
  /** Present only in browsers that ship the Translator API; absent elsewhere. */
  // eslint-disable-next-line no-var
  var Translator: BuiltInTranslatorApi | undefined;
}

/** Availability values that mean the pair can work, now or after a download. */
const USABLE = new Set(['available', 'downloadable', 'downloading']);

function keyOf(pair: LanguagePair): string {
  return `${pair.from}->${pair.to}`;
}

/**
 * Translates through the browser's built-in on-device model.
 *
 * Note for the privacy story: this runs locally, but the download and the model
 * belong to the browser, not to this page. It therefore sits outside the app's
 * Content-Security-Policy the same way the Web Speech API does — CSP cannot
 * police it either way.
 */
export class BuiltInTranslator implements TranslationEngine {
  readonly id = 'builtin' as const;
  readonly #api: BuiltInTranslatorApi | undefined;
  readonly #instances = new Map<string, Promise<BuiltInTranslatorInstance>>();

  constructor(api: BuiltInTranslatorApi | undefined = globalThis.Translator) {
    this.#api = api;
  }

  async isAvailable(pair: LanguagePair): Promise<boolean> {
    if (!this.#api) return false;
    try {
      const availability = await this.#api.availability({
        sourceLanguage: pair.from,
        targetLanguage: pair.to,
      });
      return USABLE.has(availability);
    } catch {
      // A browser that refuses the query is one that cannot translate.
      return false;
    }
  }

  async load(pair: LanguagePair, onProgress?: (progress: LoadProgress) => void): Promise<void> {
    await this.#instanceFor(pair, onProgress);
  }

  async translate(texts: readonly string[], pair: LanguagePair): Promise<string[]> {
    if (texts.length === 0) return [];
    const instance = await this.#instanceFor(pair);
    return Promise.all(texts.map((text) => instance.translate(text)));
  }

  #instanceFor(
    pair: LanguagePair,
    onProgress?: (progress: LoadProgress) => void,
  ): Promise<BuiltInTranslatorInstance> {
    const key = keyOf(pair);
    const existing = this.#instances.get(key);
    if (existing) return existing;

    const api = this.#api;
    if (!api) return Promise.reject(new Error('The built-in translator is not available'));

    const pending = api
      .create({
        sourceLanguage: pair.from,
        targetLanguage: pair.to,
        monitor: (monitor) => {
          if (!onProgress) return;
          monitor.addEventListener('downloadprogress', (event) => {
            const { loaded, total } = event as { loaded?: number; total?: number };
            // Current Chrome reports `loaded` as a 0..1 fraction with no total;
            // earlier builds reported bytes. Both are passed on unsurprised.
            onProgress({ loaded: loaded ?? 0, total: total ?? 1 });
          });
        },
      })
      .catch((error: unknown) => {
        // Not cached, so a later attempt can still succeed.
        this.#instances.delete(key);
        throw error;
      });

    this.#instances.set(key, pending);
    return pending;
  }
}
