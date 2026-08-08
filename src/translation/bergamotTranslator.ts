import type { LanguagePair, TranslationEngine } from './types.ts';

/** The slice of Bergamot's BatchTranslator this app uses. */
export interface BergamotBatchTranslator {
  translate(request: {
    from: string;
    to: string;
    text: string;
    html: boolean;
    qualityScores: boolean;
  }): Promise<{ target: { text: string } }>;
  delete?(): void;
}

export interface BergamotOptions {
  /** Written by scripts/fetch-translation-models.mjs at image-build time. */
  readonly registryUrl?: string;
  readonly createTranslator?: (
    registryUrl: string,
  ) => BergamotBatchTranslator | Promise<BergamotBatchTranslator>;
  readonly fetchJson?: (url: string) => Promise<unknown>;
}

const DEFAULT_REGISTRY_URL = '/mt/index.json';

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return response.json();
}

/**
 * Translates with Mozilla's Bergamot models, bundled into the image.
 *
 * This is the engine the privacy claim rests on. The models are fetched at build
 * time, served from this app's own origin, and therefore covered by the same
 * `connect-src 'self'` policy as everything else — unlike the browser's built-in
 * translator, whose model the page can neither see nor vouch for.
 *
 * The library is constructed lazily and pointed at our registry rather than its
 * default S3 bucket, which is what keeps every request local.
 */
export class BergamotTranslator implements TranslationEngine {
  readonly id = 'bergamot' as const;
  readonly #registryUrl: string;
  readonly #fetchJson: (url: string) => Promise<unknown>;
  readonly #createTranslator: (
    registryUrl: string,
  ) => BergamotBatchTranslator | Promise<BergamotBatchTranslator>;
  #registry: Promise<Record<string, unknown>> | undefined;
  #translator: Promise<BergamotBatchTranslator> | undefined;

  constructor(options: BergamotOptions = {}) {
    this.#registryUrl = options.registryUrl ?? DEFAULT_REGISTRY_URL;
    this.#fetchJson = options.fetchJson ?? fetchJson;
    this.#createTranslator =
      options.createTranslator ??
      ((registryUrl) => {
        throw new Error(`No Bergamot factory supplied for ${registryUrl}`);
      });
  }

  /**
   * True only for pairs actually present in this image. A build made with a
   * narrower TRANSLATION_PAIRS must not offer a model it does not carry.
   */
  async isAvailable(pair: LanguagePair): Promise<boolean> {
    try {
      const registry = await this.#loadRegistry();
      return `${pair.from}${pair.to}` in registry;
    } catch {
      return false;
    }
  }

  async load(_pair: LanguagePair): Promise<void> {
    await this.#instance();
  }

  async translate(texts: readonly string[], pair: LanguagePair): Promise<string[]> {
    if (texts.length === 0) return [];
    const translator = await this.#instance();

    return Promise.all(
      texts.map(async (text) => {
        const response = await translator.translate({
          from: pair.from,
          to: pair.to,
          text,
          // Sentences are handed over as plain text: the document's markup is
          // the reader's business, and round-tripping it through the model
          // would risk returning tags the sanitiser never saw.
          html: false,
          qualityScores: false,
        });
        return response.target.text;
      }),
    );
  }

  #loadRegistry(): Promise<Record<string, unknown>> {
    this.#registry ??= this.#fetchJson(this.#registryUrl)
      .then((value) => (value ?? {}) as Record<string, unknown>)
      .catch((error: unknown) => {
        // Not cached: a build that is still starting up can succeed later.
        this.#registry = undefined;
        throw error;
      });
    return this.#registry;
  }

  /**
   * Built once, asynchronously: the library is a dynamic import, so a browser
   * that never translates never downloads it. A failure is not cached, so a
   * retry can still succeed.
   */
  #instance(): Promise<BergamotBatchTranslator> {
    this.#translator ??= (async () => this.#createTranslator(this.#registryUrl))().catch(
      (error: unknown) => {
        this.#translator = undefined;
        throw error;
      },
    );
    return this.#translator;
  }
}
