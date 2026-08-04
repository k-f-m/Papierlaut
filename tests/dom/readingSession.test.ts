/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Highlighter } from '../../src/reading/highlighter.ts';
import { ReadingSession } from '../../src/app/readingSession.ts';
import { SpeechCancelledError } from '../../src/speech/types.ts';
import { buildReadingModel } from '../../src/reading/buildReadingModel.ts';
import type {
  SpeakRequest,
  SpeechEngine,
  Utterance,
  Voice,
  WordCallback,
} from '../../src/speech/types.ts';
import type { SessionSnapshot } from '../../src/app/readingSession.ts';

const VOICE: Voice = {
  id: 'fake',
  engine: 'piper',
  label: 'Fake',
  lang: 'de-DE',
  language: 'de',
  requiresLoading: false,
};

/**
 * Stands in for a real synthesiser so playback can be stepped deterministically:
 * an utterance only finishes when the test says so.
 */
class FakeEngine implements SpeechEngine {
  readonly id = 'piper' as const;
  readonly spoken: string[] = [];
  readonly prewarmed: string[] = [];
  #current: { finish: () => void; fail: (error: Error) => void; onWord: WordCallback } | undefined;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async listVoices(): Promise<Voice[]> {
    return [VOICE];
  }

  async load(): Promise<void> {}

  prewarm(request: Omit<SpeakRequest, 'rate' | 'volume'>): void {
    this.prewarmed.push(request.text);
  }

  speak(request: SpeakRequest, onWord: WordCallback): Utterance {
    this.spoken.push(request.text);
    let settle: (error?: Error) => void = () => {};
    const done = new Promise<void>((resolve, reject) => {
      settle = (error) => (error ? reject(error) : resolve());
    });
    this.#current = {
      finish: () => settle(),
      fail: (error) => settle(error),
      onWord,
    };
    return {
      done,
      pause: () => {},
      resume: () => {},
      cancel: () => settle(new SpeechCancelledError()),
      setRate: () => true,
    };
  }

  /** Completes the utterance currently in flight. */
  async finish(): Promise<void> {
    this.#current?.finish();
    await Promise.resolve();
    await Promise.resolve();
  }

  async fail(message: string): Promise<void> {
    this.#current?.fail(new Error(message));
    await Promise.resolve();
    await Promise.resolve();
  }

  emitWord(index: number): void {
    this.#current?.onWord(index);
  }
}

function setup(html = '<p>Erster Satz. Zweiter Satz. Dritter Satz.</p>') {
  const root = document.createElement('article');
  root.innerHTML = html;
  document.body.replaceChildren(root);

  const model = buildReadingModel(root, 'de');
  const highlighter = new Highlighter(root, { follow: false, anchor: 0.4 });
  highlighter.attach(model);

  const engine = new FakeEngine();
  const snapshots: SessionSnapshot[] = [];
  const errors: Error[] = [];
  const session = new ReadingSession(
    model,
    engine,
    VOICE,
    highlighter,
    { rate: 1, volume: 1 },
    { onChange: (snapshot) => snapshots.push(snapshot), onError: (error) => errors.push(error) },
  );

  return { root, model, engine, session, snapshots, errors, highlighter };
}

/** Lets the session's async loop run up to its next await. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

beforeEach(() => {
  document.body.replaceChildren();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

describe('ReadingSession', () => {
  it('reads sentence by sentence in order', async () => {
    const { engine, session } = setup();
    session.play();
    await settle();
    expect(engine.spoken).toEqual(['Erster Satz.']);

    await engine.finish();
    await settle();
    expect(engine.spoken).toEqual(['Erster Satz.', 'Zweiter Satz.']);
  });

  it('synthesises the next sentence while the current one plays', async () => {
    const { engine, session } = setup();
    session.play();
    await settle();
    expect(engine.prewarmed).toEqual(['Zweiter Satz.']);
  });

  it('reports finished after the last sentence', async () => {
    const { engine, session } = setup('<p>Nur ein Satz.</p>');
    session.play();
    await settle();
    await engine.finish();
    await settle();
    expect(session.state).toBe('finished');
    expect(session.snapshot.progress).toBe(1);
  });

  it('translates engine word events into document word highlights', async () => {
    const { engine, session, root } = setup();
    session.play();
    await settle();

    engine.emitWord(1);
    expect(root.querySelector('.is-word')?.textContent).toBe('Satz');
  });

  it('marks the sentence being read', async () => {
    const { session, root } = setup();
    session.play();
    await settle();
    expect(root.querySelector('.is-sentence')?.textContent).toBe('Erster Satz.');
  });

  it('stops without advancing to the next sentence', async () => {
    const { engine, session } = setup();
    session.play();
    await settle();
    session.stop();
    await settle();

    expect(session.state).toBe('idle');
    expect(engine.spoken).toEqual(['Erster Satz.']);
  });

  it('does not let a cancelled utterance resume the loop', async () => {
    const { engine, session } = setup();
    session.play();
    await settle();
    session.stop();
    await engine.finish(); // the cancelled utterance settling late
    await settle();

    expect(engine.spoken).toEqual(['Erster Satz.']);
    expect(session.state).toBe('idle');
  });

  it('restarts from the requested sentence when seeking during playback', async () => {
    const { engine, session } = setup();
    session.play();
    await settle();
    session.jumpToSentence(2);
    await settle();

    expect(engine.spoken.at(-1)).toBe('Dritter Satz.');
    expect(session.snapshot.sentence).toBe(2);
  });

  it('moves the position without speaking when seeking while idle', async () => {
    const { engine, session } = setup();
    session.jumpToSentence(1);
    await settle();

    expect(engine.spoken).toEqual([]);
    expect(session.snapshot.sentence).toBe(1);
  });

  it('clamps seeking to the document', async () => {
    const { session } = setup();
    session.jumpToSentence(99);
    expect(session.snapshot.sentence).toBe(2);
    session.skip(-99);
    expect(session.snapshot.sentence).toBe(0);
  });

  it('starts at the sentence a clicked word belongs to', async () => {
    const { engine, model, session } = setup();
    const word = model.words.find((candidate) => candidate.sentence === 1);
    session.jumpToWord(word!.index);
    session.play();
    await settle();

    expect(engine.spoken).toEqual(['Zweiter Satz.']);
  });

  it('pauses and resumes without losing its place', async () => {
    const { session } = setup();
    session.play();
    await settle();

    session.pause();
    expect(session.state).toBe('paused');
    session.resume();
    expect(session.state).toBe('playing');
    expect(session.snapshot.sentence).toBe(0);
  });

  it('surfaces a synthesis failure and returns to idle', async () => {
    const { engine, session, errors } = setup();
    session.play();
    await settle();
    await engine.fail('model missing');
    await settle();

    expect(errors.map((error) => error.message)).toEqual(['model missing']);
    expect(session.state).toBe('idle');
  });
});
