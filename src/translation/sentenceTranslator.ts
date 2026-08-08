import type { LanguagePair, TranslationEngine } from './types.ts';

/** Fires once per sentence, as soon as its translation is known. */
export type TranslationCallback = (index: number, text: string) => void;

export interface SentenceTranslatorOptions {
  readonly engine: TranslationEngine;
  readonly pair: LanguagePair;
  readonly sentences: readonly string[];
  /** How many sentences beyond the cursor to translate. */
  readonly lookahead?: number;
}

const DEFAULT_LOOKAHEAD = 8;

/**
 * The sentences to translate for a cursor: the cursor itself and what follows.
 * Forward-only, because the reader moves forward and translating behind the
 * cursor spends the model on text the eye has already passed.
 */
export function windowFrom(cursor: number, total: number, lookahead: number): number[] {
  if (total <= 0) return [];
  const start = Math.min(Math.max(cursor, 0), total - 1);
  const end = Math.min(start + lookahead, total - 1);
  const indices: number[] = [];
  for (let index = start; index <= end; index += 1) indices.push(index);
  return indices;
}

/**
 * Translates a document a window at a time and remembers what it has.
 *
 * Holds no DOM and no engine specifics: it is handed sentences and an engine,
 * and reports results by index, which is what lets the rendering layer and the
 * playback session stay unaware of each other.
 */
export class SentenceTranslator {
  readonly pair: LanguagePair;
  readonly #engine: TranslationEngine;
  readonly #sentences: readonly string[];
  readonly #lookahead: number;
  readonly #translations = new Map<number, string>();
  readonly #inFlight = new Set<number>();
  readonly #listeners: TranslationCallback[] = [];

  constructor(options: SentenceTranslatorOptions) {
    this.#engine = options.engine;
    this.pair = options.pair;
    this.#sentences = options.sentences;
    this.#lookahead = options.lookahead ?? DEFAULT_LOOKAHEAD;
  }

  /** The translation held for a sentence, or undefined if there is none yet. */
  translationAt(index: number): string | undefined {
    return this.#translations.get(index);
  }

  onTranslated(listener: TranslationCallback): void {
    this.#listeners.push(listener);
  }

  /**
   * Translates the window starting at `cursor`, skipping whatever is already
   * held or already being fetched. Rejects if the engine does, leaving the
   * affected sentences empty so a later pass can try again.
   */
  async ensureFrom(cursor: number): Promise<void> {
    const pending = windowFrom(cursor, this.#sentences.length, this.#lookahead).filter(
      (index) => !this.#translations.has(index) && !this.#inFlight.has(index),
    );
    if (pending.length === 0) return;

    const wanted: number[] = [];
    for (const index of pending) {
      // A sentence with nothing to say needs neither the engine nor a round trip.
      if ((this.#sentences[index] ?? '').trim() === '') this.#publish(index, '');
      else wanted.push(index);
    }
    if (wanted.length === 0) return;

    for (const index of wanted) this.#inFlight.add(index);
    try {
      const texts = wanted.map((index) => this.#sentences[index] ?? '');
      const translated = await this.#engine.translate(texts, this.pair);
      wanted.forEach((index, position) => this.#publish(index, translated[position] ?? ''));
    } finally {
      // Cleared even on failure, so the sentence is retryable rather than stuck.
      for (const index of wanted) this.#inFlight.delete(index);
    }
  }

  #publish(index: number, text: string): void {
    this.#translations.set(index, text);
    for (const listener of this.#listeners) listener(index, text);
  }
}
