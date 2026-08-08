import { describe, expect, it, vi } from 'vitest';
import { BuiltInTranslator } from '../src/translation/builtInTranslator.ts';
import type { BuiltInTranslatorApi, DownloadMonitor } from '../src/translation/builtInTranslator.ts';
import type { LanguagePair } from '../src/translation/types.ts';

const PAIR: LanguagePair = { from: 'de', to: 'en' };

interface FakeOptions {
  readonly availability?: string;
  readonly onAvailability?: () => never;
  /** Progress events the fake emits while a translator is being created. */
  readonly progress?: Array<{ loaded: number; total?: number }>;
}

function fakeApi(options: FakeOptions = {}): BuiltInTranslatorApi & { creates: number } {
  const api = {
    creates: 0,
    async availability() {
      options.onAvailability?.();
      return options.availability ?? 'available';
    },
    async create(created: { monitor?: (monitor: DownloadMonitor) => void }) {
      api.creates += 1;
      created.monitor?.({
        addEventListener: (_event: string, handler: (event: unknown) => void) => {
          for (const entry of options.progress ?? []) handler(entry);
        },
      });
      return {
        async translate(text: string) {
          return `EN(${text})`;
        },
      };
    },
  };
  return api;
}

describe('BuiltInTranslator.isAvailable', () => {
  it('accepts a pair the browser already has a model for', async () => {
    const engine = new BuiltInTranslator(fakeApi({ availability: 'available' }));

    expect(await engine.isAvailable(PAIR)).toBe(true);
  });

  it('accepts a pair the browser can still fetch a model for', async () => {
    // 'downloadable' is offered too: the control should appear, and loading it
    // is what triggers the download.
    const engine = new BuiltInTranslator(fakeApi({ availability: 'downloadable' }));

    expect(await engine.isAvailable(PAIR)).toBe(true);
  });

  it('rejects a pair the browser cannot handle', async () => {
    const engine = new BuiltInTranslator(fakeApi({ availability: 'unavailable' }));

    expect(await engine.isAvailable(PAIR)).toBe(false);
  });

  it('reports unavailable rather than throwing when the API is missing', async () => {
    const engine = new BuiltInTranslator(undefined);

    expect(await engine.isAvailable(PAIR)).toBe(false);
  });

  it('reports unavailable when the browser refuses the query', async () => {
    const engine = new BuiltInTranslator(
      fakeApi({
        onAvailability: () => {
          throw new Error('not allowed');
        },
      }),
    );

    expect(await engine.isAvailable(PAIR)).toBe(false);
  });
});

describe('BuiltInTranslator.load', () => {
  it('builds one translator per pair and reuses it', async () => {
    const api = fakeApi();
    const engine = new BuiltInTranslator(api);

    await engine.load(PAIR);
    await engine.load(PAIR);

    expect(api.creates).toBe(1);
  });

  it('builds a separate translator for the opposite direction', async () => {
    const api = fakeApi();
    const engine = new BuiltInTranslator(api);

    await engine.load(PAIR);
    await engine.load({ from: 'en', to: 'de' });

    expect(api.creates).toBe(2);
  });

  it('passes byte progress through untouched', async () => {
    const api = fakeApi({ progress: [{ loaded: 40, total: 100 }] });
    const engine = new BuiltInTranslator(api);
    const seen = vi.fn();

    await engine.load(PAIR, seen);

    expect(seen).toHaveBeenCalledWith({ loaded: 40, total: 100 });
  });

  it('treats a bare fraction as progress out of one', async () => {
    // Chrome reports `loaded` as 0..1 with no `total` in current builds.
    const api = fakeApi({ progress: [{ loaded: 0.25 }] });
    const engine = new BuiltInTranslator(api);
    const seen = vi.fn();

    await engine.load(PAIR, seen);

    expect(seen).toHaveBeenCalledWith({ loaded: 0.25, total: 1 });
  });

  it('fails loudly when there is no API to build on', async () => {
    const engine = new BuiltInTranslator(undefined);

    await expect(engine.load(PAIR)).rejects.toThrow(/not available/i);
  });
});

describe('BuiltInTranslator.translate', () => {
  it('returns one translation per input, in order', async () => {
    const engine = new BuiltInTranslator(fakeApi());

    expect(await engine.translate(['Eins.', 'Zwei.'], PAIR)).toEqual(['EN(Eins.)', 'EN(Zwei.)']);
  });

  it('loads on demand when called before load', async () => {
    const api = fakeApi();
    const engine = new BuiltInTranslator(api);

    await engine.translate(['Eins.'], PAIR);

    expect(api.creates).toBe(1);
  });

  it('makes no call at all for an empty batch', async () => {
    const api = fakeApi();
    const engine = new BuiltInTranslator(api);

    expect(await engine.translate([], PAIR)).toEqual([]);
    expect(api.creates).toBe(0);
  });
});
