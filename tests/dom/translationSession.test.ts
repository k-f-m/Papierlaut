/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { TranslationSession } from '../../src/translation/translationSession.ts';
import { TRANSLATION_CLASS } from '../../src/translation/interlinearView.ts';
import { buildReadingModel } from '../../src/reading/buildReadingModel.ts';
import type { LanguagePair, TranslationEngine } from '../../src/translation/types.ts';
import type { SentenceToken } from '../../src/reading/types.ts';

const PAIR: LanguagePair = { from: 'de', to: 'en' };

class FakeEngine implements TranslationEngine {
  readonly id = 'builtin' as const;
  readonly batches: string[][] = [];
  loads = 0;
  failures = 0;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async load(): Promise<void> {
    this.loads += 1;
  }

  async translate(texts: readonly string[]): Promise<string[]> {
    this.batches.push([...texts]);
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('engine unavailable');
    }
    return texts.map((text) => `EN:${text}`);
  }
}

/** Four sentences across two paragraphs, so the window can be stepped. */
const DOCUMENT = '<p>Eins hier. Zwei hier.</p><p>Drei hier. Vier hier.</p>';

describe('TranslationSession', () => {
  let root: HTMLElement;
  let sentences: readonly SentenceToken[];
  let engine: FakeEngine;
  let session: TranslationSession;

  beforeEach(() => {
    root = document.createElement('article');
    root.innerHTML = DOCUMENT;
    document.body.replaceChildren(root);
    sentences = buildReadingModel(root, 'de').sentences;
    engine = new FakeEngine();
    session = new TranslationSession({ engine, pair: PAIR, sentences, lookahead: 1 });
  });

  const rendered = (): Array<string | null> =>
    [...root.querySelectorAll(`.${TRANSLATION_CLASS}`)].map((node) => node.textContent);

  it('starts disabled and shows nothing', () => {
    expect(session.enabled).toBe(false);
    expect(rendered()).toEqual([]);
  });

  it('loads the engine and renders the opening window when enabled', async () => {
    await session.enable(0);

    expect(session.enabled).toBe(true);
    expect(engine.loads).toBe(1);
    expect(rendered()).toEqual(['EN:Eins hier.', 'EN:Zwei hier.']);
  });

  it('loads the engine only once across repeated enables', async () => {
    await session.enable(0);
    session.disable();
    await session.enable(0);

    expect(engine.loads).toBe(1);
  });

  it('tags translations with the target locale', async () => {
    await session.enable(0);

    expect(root.querySelector(`.${TRANSLATION_CLASS}`)?.getAttribute('lang')).toBe('en-US');
  });

  it('translates further ahead as the reader moves', async () => {
    await session.enable(0);
    await session.moveTo(2);

    expect(rendered()).toEqual([
      'EN:Eins hier.',
      'EN:Zwei hier.',
      'EN:Drei hier.',
      'EN:Vier hier.',
    ]);
  });

  it('takes every translation off the page when disabled', async () => {
    await session.enable(0);
    session.disable();

    expect(session.enabled).toBe(false);
    expect(rendered()).toEqual([]);
  });

  it('restores what it already knows without asking the engine again', async () => {
    await session.enable(0);
    const batchesAfterFirstPass = engine.batches.length;
    session.disable();
    await session.enable(0);

    expect(rendered()).toEqual(['EN:Eins hier.', 'EN:Zwei hier.']);
    expect(engine.batches).toHaveLength(batchesAfterFirstPass);
  });

  it('ignores cursor movement while disabled', async () => {
    await session.moveTo(2);

    expect(engine.batches).toEqual([]);
    expect(rendered()).toEqual([]);
  });

  it('surfaces an engine failure instead of swallowing it', async () => {
    engine.failures = 1;

    await expect(session.enable(0)).rejects.toThrow('engine unavailable');
    expect(rendered()).toEqual([]);
  });

  it('stays usable after a failure', async () => {
    engine.failures = 1;
    await expect(session.enable(0)).rejects.toThrow('engine unavailable');

    await session.enable(0);

    expect(rendered()).toEqual(['EN:Eins hier.', 'EN:Zwei hier.']);
  });

  it('leaves the document clean when destroyed', async () => {
    await session.enable(0);
    session.destroy();

    expect(rendered()).toEqual([]);
    expect(root.textContent).toBe('Eins hier. Zwei hier.Drei hier. Vier hier.');
  });
});
