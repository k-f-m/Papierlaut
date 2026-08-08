import { describe, expect, it } from 'vitest';
import { SentenceTranslator, windowFrom } from '../src/translation/sentenceTranslator.ts';
import type { LanguagePair, TranslationEngine } from '../src/translation/types.ts';

const PAIR: LanguagePair = { from: 'de', to: 'en' };

/**
 * Records every batch it is handed so the tests can assert on what was asked
 * for, not merely on what came back. `translate` resolves immediately unless a
 * test switches it into deferred mode.
 */
class FakeEngine implements TranslationEngine {
  readonly id = 'builtin' as const;
  readonly batches: string[][] = [];
  failures = 0;
  #deferred: Array<{ texts: readonly string[]; settle: () => void }> = [];
  #defer = false;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async load(): Promise<void> {}

  async translate(texts: readonly string[]): Promise<string[]> {
    this.batches.push([...texts]);
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('engine unavailable');
    }
    if (this.#defer) {
      await new Promise<void>((resolve) => this.#deferred.push({ texts, settle: resolve }));
    }
    return texts.map((text) => `<${text}>`);
  }

  /** Holds every subsequent call open until `releaseAll` is called. */
  deferResponses(): void {
    this.#defer = true;
  }

  releaseAll(): void {
    const pending = this.#deferred;
    this.#deferred = [];
    for (const entry of pending) entry.settle();
  }
}

const SENTENCES = [
  'Erster Satz.',
  'Zweiter Satz.',
  'Dritter Satz.',
  'Vierter Satz.',
  'Fünfter Satz.',
];

function translator(engine: TranslationEngine, lookahead = 2, sentences = SENTENCES) {
  return new SentenceTranslator({ engine, pair: PAIR, sentences, lookahead });
}

describe('windowFrom', () => {
  it('spans the cursor and the lookahead that follows it', () => {
    expect(windowFrom(1, 10, 2)).toEqual([1, 2, 3]);
  });

  it('stops at the last sentence rather than running past it', () => {
    expect(windowFrom(8, 10, 4)).toEqual([8, 9]);
  });

  it('clamps a cursor outside the document', () => {
    expect(windowFrom(-3, 4, 1)).toEqual([0, 1]);
    expect(windowFrom(99, 4, 1)).toEqual([3]);
  });

  it('is empty for a document with no sentences', () => {
    expect(windowFrom(0, 0, 3)).toEqual([]);
  });
});

describe('SentenceTranslator', () => {
  it('has no translation before one is requested', () => {
    const subject = translator(new FakeEngine());

    expect(subject.translationAt(0)).toBeUndefined();
  });

  it('translates the cursor and its lookahead in a single batch', async () => {
    const engine = new FakeEngine();
    const subject = translator(engine);

    await subject.ensureFrom(0);

    expect(engine.batches).toEqual([['Erster Satz.', 'Zweiter Satz.', 'Dritter Satz.']]);
    expect(subject.translationAt(0)).toBe('<Erster Satz.>');
    expect(subject.translationAt(2)).toBe('<Dritter Satz.>');
  });

  it('leaves sentences outside the window untouched', async () => {
    const engine = new FakeEngine();
    const subject = translator(engine);

    await subject.ensureFrom(0);

    expect(subject.translationAt(3)).toBeUndefined();
  });

  it('asks only for sentences it does not already hold', async () => {
    const engine = new FakeEngine();
    const subject = translator(engine);

    await subject.ensureFrom(0);
    await subject.ensureFrom(2);

    // 0..2 were already cached, so the second pass covers only 3 and 4.
    expect(engine.batches[1]).toEqual(['Vierter Satz.', 'Fünfter Satz.']);
  });

  it('makes no call at all when the window is fully cached', async () => {
    const engine = new FakeEngine();
    const subject = translator(engine);

    await subject.ensureFrom(0);
    await subject.ensureFrom(0);

    expect(engine.batches).toHaveLength(1);
  });

  it('does not request a sentence that is already in flight', async () => {
    const engine = new FakeEngine();
    const subject = translator(engine);
    engine.deferResponses();

    const first = subject.ensureFrom(0);
    const second = subject.ensureFrom(1);
    engine.releaseAll();
    await Promise.all([first, second]);

    // The second call overlaps 1 and 2, so only sentence 3 is genuinely new.
    expect(engine.batches).toEqual([
      ['Erster Satz.', 'Zweiter Satz.', 'Dritter Satz.'],
      ['Vierter Satz.'],
    ]);
  });

  it('skips sentences that carry no words', async () => {
    const engine = new FakeEngine();
    const subject = translator(engine, 2, ['Echter Satz.', '   ', 'Noch einer.']);

    await subject.ensureFrom(0);

    expect(engine.batches).toEqual([['Echter Satz.', 'Noch einer.']]);
    expect(subject.translationAt(1)).toBe('');
  });

  it('retries after a failure instead of caching the gap', async () => {
    const engine = new FakeEngine();
    const subject = translator(engine, 0);
    engine.failures = 1;

    await expect(subject.ensureFrom(0)).rejects.toThrow('engine unavailable');
    expect(subject.translationAt(0)).toBeUndefined();

    await subject.ensureFrom(0);
    expect(subject.translationAt(0)).toBe('<Erster Satz.>');
  });

  it('announces each sentence as it arrives so the DOM can be patched', async () => {
    const engine = new FakeEngine();
    const subject = translator(engine, 1);
    const seen: Array<[number, string]> = [];
    subject.onTranslated((index, text) => seen.push([index, text]));

    await subject.ensureFrom(0);

    expect(seen).toEqual([
      [0, '<Erster Satz.>'],
      [1, '<Zweiter Satz.>'],
    ]);
  });

  it('reports the pair it was built for', () => {
    const subject = translator(new FakeEngine());

    expect(subject.pair).toEqual({ from: 'de', to: 'en' });
  });
});
