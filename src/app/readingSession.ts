import { isCancellation, supportsPrewarm } from '../speech/types.ts';
import type { SpeechEngine, Utterance, Voice } from '../speech/types.ts';
import type { Highlighter } from '../reading/highlighter.ts';
import type { ReadingModel, SentenceToken } from '../reading/types.ts';

export type PlaybackState = 'idle' | 'preparing' | 'playing' | 'paused' | 'finished';

export interface SessionSnapshot {
  readonly state: PlaybackState;
  readonly sentence: number;
  readonly sentenceCount: number;
  /** 0..1 across the document. */
  readonly progress: number;
}

export interface SessionListeners {
  onChange(snapshot: SessionSnapshot): void;
  onError(error: Error): void;
}

export interface SessionSettings {
  rate: number;
  volume: number;
}

/**
 * Reads a document aloud, one sentence at a time.
 *
 * A sentence is the unit of everything: it is what gets synthesised, what the
 * highlight re-anchors to, and what "back" and "forward" move by. Splitting
 * finer would wreck prosody; coarser would make the highlight drift and seeking
 * imprecise.
 *
 * The engine, model and highlighter are injected, so the session can be driven
 * in a test with a fake engine and no audio hardware.
 */
export class ReadingSession {
  #model: ReadingModel;
  #engine: SpeechEngine;
  #voice: Voice;
  #highlighter: Highlighter;
  #listeners: SessionListeners;
  #settings: SessionSettings;

  #state: PlaybackState = 'idle';
  #sentence = 0;
  #utterance: Utterance | undefined;
  /**
   * Incremented by anything that invalidates the sentence in flight. The
   * playback loop compares it after every await, which is what stops a stale
   * utterance from advancing the highlight after a stop or a voice change.
   */
  #generation = 0;

  constructor(
    model: ReadingModel,
    engine: SpeechEngine,
    voice: Voice,
    highlighter: Highlighter,
    settings: SessionSettings,
    listeners: SessionListeners,
  ) {
    this.#model = model;
    this.#engine = engine;
    this.#voice = voice;
    this.#highlighter = highlighter;
    this.#settings = { ...settings };
    this.#listeners = listeners;
  }

  get snapshot(): SessionSnapshot {
    const count = this.#model.sentences.length;
    // Progress counts sentences *completed*, so it reads 0 on the first
    // sentence and only reaches 1 once the document has actually been read to
    // the end — including a document consisting of a single sentence.
    const completed = this.#state === 'finished' ? count : this.#sentence;
    return {
      state: this.#state,
      sentence: this.#sentence,
      sentenceCount: count,
      progress: count === 0 ? 0 : Math.min(completed / count, 1),
    };
  }

  get state(): PlaybackState {
    return this.#state;
  }

  play(fromSentence = this.#sentence): void {
    if (this.#state === 'paused' && fromSentence === this.#sentence) {
      this.resume();
      return;
    }
    void this.#run(clamp(fromSentence, 0, this.#model.sentences.length - 1));
  }

  pause(): void {
    if (this.#state !== 'playing') return;
    this.#utterance?.pause();
    this.#setState('paused');
  }

  resume(): void {
    if (this.#state !== 'paused') return;
    this.#utterance?.resume();
    this.#setState('playing');
  }

  toggle(): void {
    if (this.#state === 'playing') this.pause();
    else this.play();
  }

  stop(): void {
    this.#generation += 1;
    this.#utterance?.cancel();
    this.#utterance = undefined;
    this.#highlighter.setWord(-1);
    this.#setState('idle');
  }

  /** Jumps by whole sentences, resuming playback if it was running. */
  skip(delta: number): void {
    const target = clamp(this.#sentence + delta, 0, this.#model.sentences.length - 1);
    this.jumpToSentence(target);
  }

  jumpToSentence(index: number): void {
    const target = clamp(index, 0, this.#model.sentences.length - 1);
    const wasPlaying = this.#state === 'playing' || this.#state === 'preparing';
    this.#sentence = target;
    this.#highlighter.setSentence(target);
    this.#highlighter.setWord(-1);

    if (wasPlaying) this.play(target);
    else {
      this.#generation += 1;
      this.#utterance?.cancel();
      this.#utterance = undefined;
      this.#setState(this.#state === 'finished' ? 'idle' : this.#state);
    }
  }

  jumpToWord(wordIndex: number): void {
    const word = this.#model.words[wordIndex];
    if (word) this.jumpToSentence(word.sentence);
  }

  setRate(rate: number): void {
    this.#settings.rate = rate;
    // Engines that cannot retune a running utterance restart the sentence, so
    // the change is audible immediately either way.
    if (this.#utterance?.setRate(rate) === false && this.#state === 'playing') {
      this.play(this.#sentence);
    }
  }

  setVolume(volume: number): void {
    this.#settings.volume = volume;
  }

  setVoice(engine: SpeechEngine, voice: Voice): void {
    this.#engine = engine;
    this.#voice = voice;
    if (this.#state === 'playing' || this.#state === 'paused') this.play(this.#sentence);
  }

  async #run(from: number): Promise<void> {
    const generation = ++this.#generation;
    this.#utterance?.cancel();
    this.#utterance = undefined;

    this.#sentence = from;
    this.#setState('preparing');

    try {
      await this.#engine.load(this.#voice);
      if (generation !== this.#generation) return;

      for (let index = from; index < this.#model.sentences.length; index += 1) {
        const sentence = this.#model.sentences[index] as SentenceToken;
        this.#sentence = index;
        this.#highlighter.setSentence(index);
        this.#setState('playing');

        const utterance = this.#engine.speak(
          {
            text: sentence.text,
            voice: this.#voice,
            words: sentence.words,
            rate: this.#settings.rate,
            volume: this.#settings.volume,
          },
          (wordIndex) => {
            const word = sentence.words[wordIndex];
            this.#highlighter.setWord(word ? word.index : -1);
          },
        );
        this.#utterance = utterance;
        this.#prewarm(index + 1);

        await utterance.done;
        if (generation !== this.#generation) return;
      }

      this.#utterance = undefined;
      this.#highlighter.setWord(-1);
      this.#setState('finished');
    } catch (error) {
      if (generation !== this.#generation || isCancellation(error)) return;
      this.#utterance = undefined;
      this.#setState('idle');
      this.#listeners.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Synthesising ahead is what keeps the neural voice from pausing between sentences. */
  #prewarm(index: number): void {
    const next = this.#model.sentences[index];
    if (!next || !supportsPrewarm(this.#engine)) return;
    this.#engine.prewarm({ text: next.text, voice: this.#voice, words: next.words });
  }

  #setState(state: PlaybackState): void {
    this.#state = state;
    this.#listeners.onChange(this.snapshot);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
