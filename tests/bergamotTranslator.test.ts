import { describe, expect, it, vi } from 'vitest';
import { BergamotTranslator } from '../src/translation/bergamotTranslator.ts';
import type { BergamotBatchTranslator } from '../src/translation/bergamotTranslator.ts';
import type { LanguagePair } from '../src/translation/types.ts';

const DE_EN: LanguagePair = { from: 'de', to: 'en' };
const EN_DE: LanguagePair = { from: 'en', to: 'de' };

const REGISTRY = { deen: { model: {}, shortlist: {}, vocab: {} } };

function fakeBatch(): BergamotBatchTranslator & { calls: string[] } {
  return {
    calls: [] as string[],
    async translate(request: { text: string }) {
      this.calls.push(request.text);
      return { target: { text: `EN(${request.text})` } };
    },
  } as BergamotBatchTranslator & { calls: string[] };
}

interface Harness {
  readonly engine: BergamotTranslator;
  readonly batch: ReturnType<typeof fakeBatch>;
  readonly created: () => number;
  readonly fetches: () => number;
}

function harness(registry: unknown = REGISTRY, failCreate = false): Harness {
  const batch = fakeBatch();
  let created = 0;
  let fetches = 0;
  const engine = new BergamotTranslator({
    fetchJson: async () => {
      fetches += 1;
      if (registry instanceof Error) throw registry;
      return registry;
    },
    createTranslator: () => {
      created += 1;
      if (failCreate) throw new Error('worker failed to start');
      return batch;
    },
  });
  return { engine, batch, created: () => created, fetches: () => fetches };
}

describe('BergamotTranslator.isAvailable', () => {
  it('accepts a pair the bundled registry lists', async () => {
    expect(await harness().engine.isAvailable(DE_EN)).toBe(true);
  });

  it('rejects a pair that was not bundled into this image', async () => {
    expect(await harness().engine.isAvailable(EN_DE)).toBe(false);
  });

  it('rejects everything when no registry was built', async () => {
    expect(await harness(new Error('404')).engine.isAvailable(DE_EN)).toBe(false);
  });

  it('reads the registry once however often it is asked', async () => {
    const h = harness();

    await h.engine.isAvailable(DE_EN);
    await h.engine.isAvailable(DE_EN);
    await h.engine.isAvailable(EN_DE);

    expect(h.fetches()).toBe(1);
  });

  it('retries the registry after a failure rather than staying broken', async () => {
    let attempt = 0;
    const engine = new BergamotTranslator({
      fetchJson: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('offline');
        return REGISTRY;
      },
      createTranslator: () => fakeBatch(),
    });

    expect(await engine.isAvailable(DE_EN)).toBe(false);
    expect(await engine.isAvailable(DE_EN)).toBe(true);
  });
});

describe('BergamotTranslator.load', () => {
  it('builds the translator once', async () => {
    const h = harness();

    await h.engine.load(DE_EN);
    await h.engine.load(DE_EN);

    expect(h.created()).toBe(1);
  });

  it('does not cache a translator that failed to start', async () => {
    const h = harness(REGISTRY, true);

    await expect(h.engine.load(DE_EN)).rejects.toThrow('worker failed to start');
    await expect(h.engine.load(DE_EN)).rejects.toThrow('worker failed to start');
    expect(h.created()).toBe(2);
  });
});

describe('BergamotTranslator.translate', () => {
  it('returns one translation per sentence, in order', async () => {
    const h = harness();

    expect(await h.engine.translate(['Eins.', 'Zwei.'], DE_EN)).toEqual(['EN(Eins.)', 'EN(Zwei.)']);
  });

  it('passes each sentence as plain text, never as markup', async () => {
    const batchSpy = vi.fn(async () => ({ target: { text: 'x' } }));
    const engine = new BergamotTranslator({
      fetchJson: async () => REGISTRY,
      createTranslator: () => ({ translate: batchSpy }) as unknown as BergamotBatchTranslator,
    });

    await engine.translate(['Ein Satz.'], DE_EN);

    expect(batchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'de', to: 'en', text: 'Ein Satz.', html: false }),
    );
  });

  it('builds the translator on demand', async () => {
    const h = harness();

    await h.engine.translate(['Eins.'], DE_EN);

    expect(h.created()).toBe(1);
  });

  it('does nothing at all for an empty batch', async () => {
    const h = harness();

    expect(await h.engine.translate([], DE_EN)).toEqual([]);
    expect(h.created()).toBe(0);
  });
});
