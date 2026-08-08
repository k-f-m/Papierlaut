import { localeFor } from '../reading/detectLanguage.ts';
import { InterlinearView } from './interlinearView.ts';
import { SentenceTranslator } from './sentenceTranslator.ts';
import type { SentenceToken } from '../reading/types.ts';
import type { LanguagePair, TranslationEngine } from './types.ts';

export interface TranslationSessionOptions {
  readonly engine: TranslationEngine;
  readonly pair: LanguagePair;
  readonly sentences: readonly SentenceToken[];
  readonly lookahead?: number;
}

/**
 * Ties a translation engine to the page: loads the model on demand, keeps the
 * window around the reader translated, and renders each result under its
 * sentence.
 *
 * Deliberately separate from `ReadingSession` — translation has to survive being
 * switched off and on without losing what it already knows, which is a different
 * lifecycle from playback. The controller owns both and tells this one where the
 * reader is; neither session knows about the other.
 */
export class TranslationSession {
  readonly #engine: TranslationEngine;
  readonly #pair: LanguagePair;
  readonly #translator: SentenceTranslator;
  readonly #view: InterlinearView;
  /** Every translation received so far, so switching back on costs nothing. */
  readonly #known = new Map<number, string>();
  #enabled = false;
  #loaded: Promise<void> | undefined;
  #cursor = 0;

  constructor(options: TranslationSessionOptions) {
    this.#engine = options.engine;
    this.#pair = options.pair;
    this.#translator = new SentenceTranslator({
      engine: options.engine,
      pair: options.pair,
      sentences: options.sentences.map((sentence) => sentence.text),
      lookahead: options.lookahead,
    });
    this.#view = new InterlinearView({
      sentences: options.sentences,
      lang: localeFor(options.pair.to),
    });
    this.#translator.onTranslated((index, text) => {
      this.#known.set(index, text);
      if (this.#enabled) this.#view.set(index, text);
    });
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /**
   * Shows translations from `cursor` onwards. Rejects if the engine cannot load
   * or translate, leaving the session off rather than half on.
   */
  async enable(cursor = this.#cursor): Promise<void> {
    this.#cursor = cursor;
    this.#enabled = true;
    for (const [index, text] of this.#known) this.#view.set(index, text);

    try {
      await this.#load();
      await this.#translator.ensureFrom(cursor);
    } catch (error) {
      this.#enabled = false;
      this.#view.clear();
      throw error;
    }
  }

  disable(): void {
    this.#enabled = false;
    this.#view.clear();
  }

  /** Tells the session where the reader is now. A no-op while switched off. */
  async moveTo(cursor: number): Promise<void> {
    this.#cursor = cursor;
    if (!this.#enabled) return;
    await this.#load();
    await this.#translator.ensureFrom(cursor);
  }

  destroy(): void {
    this.disable();
  }

  /** Loads once. A failed load is not remembered, so a retry can still work. */
  #load(): Promise<void> {
    this.#loaded ??= this.#engine.load(this.#pair).catch((error: unknown) => {
      this.#loaded = undefined;
      throw error;
    });
    return this.#loaded;
  }
}
