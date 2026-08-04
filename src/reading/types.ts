import type { SupportedLanguage } from './detectLanguage.ts';

/**
 * One spoken word inside an utterance. Offsets are relative to the utterance
 * text, which is what both speech engines work with: the Web Speech API reports
 * character indices, and the neural engine needs the gap characters to budget
 * pause time.
 */
export interface UtteranceWord {
  /** Index into `ReadingModel.words`. */
  readonly index: number;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** Characters between this word and the next one — usually a space, sometimes punctuation. */
  readonly gap: string;
}

export interface WordToken {
  readonly index: number;
  readonly text: string;
  /** Offsets into `ReadingModel.text`. */
  readonly start: number;
  readonly end: number;
  readonly sentence: number;
  /**
   * The rendered spans. A word crossing an inline element boundary
   * (`<b>Vor</b>leser`) is rendered as more than one.
   */
  readonly elements: HTMLElement[];
}

export interface SentenceToken {
  readonly index: number;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly block: number;
  readonly words: readonly UtteranceWord[];
  readonly elements: HTMLElement[];
}

export interface ReadingModel {
  /** The document as plain text; every token offset points into this. */
  readonly text: string;
  readonly language: SupportedLanguage;
  readonly locale: string;
  readonly words: readonly WordToken[];
  readonly sentences: readonly SentenceToken[];
  readonly blocks: readonly HTMLElement[];
}
