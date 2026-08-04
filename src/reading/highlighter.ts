import type { ReadingModel } from './types.ts';

export interface HighlighterOptions {
  /** Scroll the active line into view while reading. */
  follow: boolean;
  /**
   * Where the active line should sit, as a fraction of the viewport height.
   * Slightly above centre reads best: the eye keeps a little of what comes next.
   */
  anchor: number;
}

const ACTIVE_WORD_CLASS = 'is-word';
const ACTIVE_SENTENCE_CLASS = 'is-sentence';
const ACTIVE_BLOCK_CLASS = 'is-block';

/**
 * Owns the visual "where are we" state.
 *
 * It only ever toggles classes on spans the reading model already created — no
 * markup is produced here and no layout is read on the hot path, so moving the
 * highlight forward stays cheap even in a long document.
 */
export class Highlighter {
  #model: ReadingModel | undefined;
  #word = -1;
  #sentence = -1;
  #options: HighlighterOptions;
  #scroller: HTMLElement;

  constructor(scroller: HTMLElement, options: HighlighterOptions) {
    this.#scroller = scroller;
    this.#options = options;
  }

  attach(model: ReadingModel): void {
    this.clear();
    this.#model = model;
  }

  setOptions(options: Partial<HighlighterOptions>): void {
    this.#options = { ...this.#options, ...options };
  }

  get sentence(): number {
    return this.#sentence;
  }

  setWord(index: number): void {
    if (index === this.#word) return;
    this.#toggleWord(this.#word, false);
    this.#word = index;
    this.#toggleWord(index, true);
  }

  setSentence(index: number, options: { scroll?: boolean } = {}): void {
    if (index === this.#sentence) return;
    this.#toggleSentence(this.#sentence, false);
    this.#sentence = index;
    this.#toggleSentence(index, true);
    if (options.scroll !== false && this.#options.follow) this.#revealSentence(index);
  }

  clear(): void {
    this.#toggleWord(this.#word, false);
    this.#toggleSentence(this.#sentence, false);
    this.#word = -1;
    this.#sentence = -1;
  }

  #toggleWord(index: number, active: boolean): void {
    for (const element of this.#model?.words[index]?.elements ?? []) {
      element.classList.toggle(ACTIVE_WORD_CLASS, active);
    }
  }

  #toggleSentence(index: number, active: boolean): void {
    const sentence = this.#model?.sentences[index];
    if (!sentence) return;
    for (const element of sentence.elements) {
      element.classList.toggle(ACTIVE_SENTENCE_CLASS, active);
    }
    this.#model?.blocks[sentence.block]?.classList.toggle(ACTIVE_BLOCK_CLASS, active);
  }

  /**
   * Scrolls only when the line has actually left its comfortable band. Nudging
   * on every sentence would make the page twitch continuously; letting it drift
   * until it is nearly off-screen loses the reader.
   */
  #revealSentence(index: number): void {
    const element = this.#model?.sentences[index]?.elements[0];
    if (!element) return;

    const viewport = this.#scroller.clientHeight;
    const scrollerTop = this.#scroller.getBoundingClientRect().top;
    const top = element.getBoundingClientRect().top - scrollerTop;
    const target = viewport * this.#options.anchor;
    const tolerance = viewport * 0.22;

    if (Math.abs(top - target) <= tolerance) return;

    this.#scroller.scrollTo({
      top: this.#scroller.scrollTop + (top - target),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }
}

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
