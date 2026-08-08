import { NON_READABLE_CLASS } from '../reading/buildReadingModel.ts';
import type { SentenceToken } from '../reading/types.ts';

export const TRANSLATION_CLASS = 'vl-t';

export interface InterlinearOptions {
  readonly sentences: readonly SentenceToken[];
  /** BCP-47 tag of the language being translated into. */
  readonly lang: string;
}

/**
 * Puts each translation directly beneath the sentence it belongs to.
 *
 * Two decisions are load-bearing. The node is a `span` laid out as a block by
 * CSS, because a `p` or `div` would give the paragraph a block child and change
 * how the document divides into blocks on the next build. And it carries
 * `NON_READABLE_CLASS`, so the reading model never segments the translation into
 * words, speaks it, or offers it as a click-to-read target.
 *
 * Holds no engine and no session state: it is told what to display and by which
 * sentence, which is what keeps translation and playback independent.
 */
export class InterlinearView {
  readonly #sentences: readonly SentenceToken[];
  readonly #lang: string;
  readonly #nodes = new Map<number, HTMLElement>();

  constructor(options: InterlinearOptions) {
    this.#sentences = options.sentences;
    this.#lang = options.lang;
  }

  /** Shows `text` under sentence `index`, replacing whatever was there. */
  set(index: number, text: string): void {
    if (text.trim() === '') {
      this.remove(index);
      return;
    }

    const existing = this.#nodes.get(index);
    if (existing) {
      existing.textContent = text;
      return;
    }

    const anchor = this.#anchorFor(index);
    if (!anchor) return;

    const node = anchor.ownerDocument.createElement('span');
    node.className = `${TRANSLATION_CLASS} ${NON_READABLE_CLASS}`;
    node.lang = this.#lang;
    node.dataset.t = String(index);
    node.textContent = text;
    anchor.after(node);
    this.#nodes.set(index, node);
  }

  remove(index: number): void {
    this.#nodes.get(index)?.remove();
    this.#nodes.delete(index);
  }

  /** Takes every translation back out, leaving the document as it was. */
  clear(): void {
    for (const node of this.#nodes.values()) node.remove();
    this.#nodes.clear();
  }

  /** The last span of a sentence — the translation goes immediately after it. */
  #anchorFor(index: number): HTMLElement | undefined {
    const elements = this.#sentences[index]?.elements;
    return elements?.[elements.length - 1];
  }
}
