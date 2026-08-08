import { localeFor } from './detectLanguage.ts';
import { segmentSentences, segmentWords } from './segmentation.ts';
import type { SupportedLanguage } from './detectLanguage.ts';
import type { TextSpan } from './segmentation.ts';
import type { ReadingModel, SentenceToken, UtteranceWord, WordToken } from './types.ts';

export const WORD_CLASS = 'vl-w';
export const SENTENCE_CLASS = 'vl-s';
/**
 * Marks a subtree the reader must not treat as document text. Applied to
 * anything the app renders into the document itself — interlinear translations
 * today — so it is never segmented, spoken, or clicked to start reading.
 */
export const NON_READABLE_CLASS = 'vl-skip';

/**
 * Elements that start a new line of text. The reader treats the innermost of
 * these as a paragraph: the unit that text is extracted from and that sentence
 * segmentation runs over.
 */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'caption', 'dd', 'div', 'dl', 'dt', 'figcaption',
  'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav',
  'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

const ANONYMOUS_BLOCK_CLASS = 'vl-anon-block';

function isBlockLevel(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as Element).tagName.toLowerCase());
}

function isNonReadable(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest(`.${NON_READABLE_CLASS}`) != null;
}

/**
 * A node's text as the reader sees it, skipping non-readable subtrees. Stands in
 * for `textContent` everywhere offsets are measured, so the string the segmenter
 * works on and the text nodes that get wrapped stay in step.
 */
function readableText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return isNonReadable(node) ? '' : (node as Text).data;
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const element = node as Element;
  if (isNonReadable(element)) return '';

  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let text = '';
  for (let child = walker.nextNode(); child !== null; child = walker.nextNode()) {
    if (!isNonReadable(child)) text += (child as Text).data;
  }
  return text;
}

/**
 * `<div>lead-in<p>body</p></div>` puts text and a block side by side. Without a
 * wrapper the lead-in belongs to no paragraph and would be skipped, so it gets
 * an anonymous one — the same thing a layout engine does.
 */
function wrapStrayInlineContent(element: Element): void {
  const children = [...element.childNodes];
  if (!children.some(isBlockLevel)) return;

  const document = element.ownerDocument;
  let run: ChildNode[] = [];

  const flush = (): void => {
    const first = run[0];
    if (first && run.some((node) => readableText(node).trim().length > 0)) {
      const wrapper = document.createElement('div');
      wrapper.className = ANONYMOUS_BLOCK_CLASS;
      first.before(wrapper);
      wrapper.append(...run);
    }
    run = [];
  };

  for (const child of children) {
    if (isBlockLevel(child)) flush();
    else run.push(child);
  }
  flush();
}

/** Innermost block elements, in reading order. */
function collectBlocks(root: HTMLElement): HTMLElement[] {
  const blocks: HTMLElement[] = [];

  const visit = (element: Element): void => {
    wrapStrayInlineContent(element);
    const blockChildren = [...element.children].filter(isBlockLevel);
    if (blockChildren.length === 0) {
      if (readableText(element).trim().length > 0) blocks.push(element as HTMLElement);
      return;
    }
    for (const child of blockChildren) visit(child);
  };

  visit(root);
  return blocks;
}

interface LocalSpan {
  readonly start: number;
  readonly end: number;
  /** Index of the token in the document-wide list. */
  readonly index: number;
}

/**
 * Rebuilds a block's text nodes as `sentence > word` spans.
 *
 * Both levels are wrapped in the same pass so a sentence highlight covers the
 * spaces and punctuation between its words, instead of appearing as a row of
 * disconnected boxes. Nodes are replaced only after their replacement is fully
 * built, so no offset is ever invalidated mid-walk.
 */
function wrapBlock(
  block: HTMLElement,
  sentences: readonly LocalSpan[],
  words: readonly LocalSpan[],
  onSentenceElement: (index: number, element: HTMLElement) => void,
  onWordElement: (index: number, element: HTMLElement) => void,
): void {
  const document = block.ownerDocument;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);

  const textNodes: Array<{ node: Text; start: number; end: number }> = [];
  let offset = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    // Skipped before the offset advances, so non-readable text occupies no
    // space in the string the spans are measured against.
    if (isNonReadable(text)) continue;
    const end = offset + text.data.length;
    if (text.data.length > 0) textNodes.push({ node: text, start: offset, end });
    offset = end;
  }

  for (const { node, start: nodeStart, end: nodeEnd } of textNodes) {
    const nodeSentences = sentences.filter((s) => s.end > nodeStart && s.start < nodeEnd);
    if (nodeSentences.length === 0) continue;

    const nodeWords = words.filter((w) => w.end > nodeStart && w.start < nodeEnd);
    const data = node.data;
    const slice = (from: number, to: number): string => data.slice(from - nodeStart, to - nodeStart);

    const fragment = document.createDocumentFragment();
    let cursor = nodeStart;

    for (const sentence of nodeSentences) {
      const sentenceStart = Math.max(sentence.start, nodeStart);
      const sentenceEnd = Math.min(sentence.end, nodeEnd);
      if (sentenceStart > cursor) fragment.append(document.createTextNode(slice(cursor, sentenceStart)));

      const sentenceElement = document.createElement('span');
      sentenceElement.className = SENTENCE_CLASS;
      sentenceElement.dataset.s = String(sentence.index);

      let inner = sentenceStart;
      for (const word of nodeWords) {
        if (word.end <= sentenceStart || word.start >= sentenceEnd) continue;
        const wordStart = Math.max(word.start, sentenceStart);
        const wordEnd = Math.min(word.end, sentenceEnd);
        if (wordStart > inner) sentenceElement.append(document.createTextNode(slice(inner, wordStart)));

        const wordElement = document.createElement('span');
        wordElement.className = WORD_CLASS;
        wordElement.dataset.w = String(word.index);
        wordElement.textContent = slice(wordStart, wordEnd);
        sentenceElement.append(wordElement);
        onWordElement(word.index, wordElement);
        inner = wordEnd;
      }
      if (inner < sentenceEnd) sentenceElement.append(document.createTextNode(slice(inner, sentenceEnd)));

      fragment.append(sentenceElement);
      onSentenceElement(sentence.index, sentenceElement);
      cursor = sentenceEnd;
    }

    if (cursor < nodeEnd) fragment.append(document.createTextNode(slice(cursor, nodeEnd)));
    node.replaceWith(fragment);
  }
}

/** Assigns each word to the sentence its first character falls in. */
function groupWordsBySentence(sentences: readonly TextSpan[], words: readonly TextSpan[]): TextSpan[][] {
  const grouped: TextSpan[][] = sentences.map(() => []);
  let sentenceIndex = 0;
  for (const word of words) {
    while (sentenceIndex < sentences.length - 1 && word.start >= (sentences[sentenceIndex] as TextSpan).end) {
      sentenceIndex += 1;
    }
    const sentence = sentences[sentenceIndex];
    if (sentence && word.start >= sentence.start && word.start < sentence.end) {
      (grouped[sentenceIndex] as TextSpan[]).push(word);
    }
  }
  return grouped;
}

/**
 * Turns sanitised, already-rendered document markup into the structure the
 * player drives: a flat list of sentences and words, each pointing at the spans
 * that display it.
 *
 * The DOM under `root` is rewritten in place. `root` must contain the document
 * and nothing else, since every element inside it is treated as content.
 */
export function buildReadingModel(root: HTMLElement, language: SupportedLanguage): ReadingModel {
  const locale = localeFor(language);
  const blocks = collectBlocks(root);

  const words: WordToken[] = [];
  const sentences: SentenceToken[] = [];
  const parts: string[] = [];
  let base = 0;

  blocks.forEach((block, blockIndex) => {
    const blockText = readableText(block);
    const sentenceSpans = segmentSentences(blockText, locale);
    const wordSpans = segmentWords(blockText, locale);
    const wordsBySentence = groupWordsBySentence(sentenceSpans, wordSpans);

    const localSentences: LocalSpan[] = [];
    const localWords: LocalSpan[] = [];

    sentenceSpans.forEach((sentenceSpan, i) => {
      const sentenceWords = wordsBySentence[i] ?? [];
      if (sentenceWords.length === 0) return;

      const sentenceIndex = sentences.length;
      const utteranceWords: UtteranceWord[] = sentenceWords.map((wordSpan, j) => {
        const wordIndex = words.length + j;
        const next = sentenceWords[j + 1];
        return {
          index: wordIndex,
          text: wordSpan.text,
          start: wordSpan.start - sentenceSpan.start,
          end: wordSpan.end - sentenceSpan.start,
          gap: blockText.slice(wordSpan.end, next ? next.start : sentenceSpan.end),
        };
      });

      for (const wordSpan of sentenceWords) {
        const wordIndex = words.length;
        words.push({
          index: wordIndex,
          text: wordSpan.text,
          start: base + wordSpan.start,
          end: base + wordSpan.end,
          sentence: sentenceIndex,
          elements: [],
        });
        localWords.push({ start: wordSpan.start, end: wordSpan.end, index: wordIndex });
      }

      sentences.push({
        index: sentenceIndex,
        text: sentenceSpan.text,
        start: base + sentenceSpan.start,
        end: base + sentenceSpan.end,
        block: blockIndex,
        words: utteranceWords,
        elements: [],
      });
      localSentences.push({ start: sentenceSpan.start, end: sentenceSpan.end, index: sentenceIndex });
    });

    wrapBlock(
      block,
      localSentences,
      localWords,
      (index, element) => (sentences[index] as SentenceToken).elements.push(element),
      (index, element) => (words[index] as WordToken).elements.push(element),
    );

    block.dataset.block = String(blockIndex);
    parts.push(blockText);
    base += blockText.length + 2; // the "\n\n" the blocks are joined with
  });

  return {
    text: parts.join('\n\n'),
    language,
    locale,
    words,
    sentences,
    blocks,
  };
}
