import { wordIndexAt } from './wordTiming.ts';
import type { WordTiming } from './wordTiming.ts';
import type { WordCallback } from './types.ts';

/** Seconds of playback elapsed. */
export type PlaybackClock = () => number;

/**
 * Moves the highlight in step with a playback clock.
 *
 * Driven by `requestAnimationFrame` rather than one timer per word: the
 * highlight is then repainted in the same frame it is computed, and it
 * self-corrects after a pause, a seek or a throttled background tab instead of
 * drifting away from the audio.
 */
export class WordScheduler {
  readonly #timings: readonly WordTiming[];
  readonly #onWord: WordCallback;
  #frame = 0;
  #emitted = -2;

  constructor(timings: readonly WordTiming[], onWord: WordCallback) {
    this.#timings = timings;
    this.#onWord = onWord;
  }

  start(clock: PlaybackClock): void {
    this.stop();
    const tick = (): void => {
      const index = wordIndexAt(this.#timings, clock());
      if (index !== this.#emitted) {
        this.#emitted = index;
        this.#onWord(index);
      }
      this.#frame = requestAnimationFrame(tick);
    };
    this.#frame = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.#frame !== 0) {
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
    }
  }

  /** Emits the final word, so a clock that stops early does not leave it unhighlighted. */
  finish(): void {
    this.stop();
    const last = this.#timings.length - 1;
    if (last >= 0 && this.#emitted !== last) {
      this.#emitted = last;
      this.#onWord(last);
    }
  }
}
