/**
 * Rebuilds readable paragraphs from the positioned fragments a PDF gives up.
 *
 * A PDF has no paragraphs, no sentences and often no spaces — only glyphs with
 * coordinates. Everything a reader needs has to be inferred from geometry:
 * which fragments share a line, which lines belong together, and where a word
 * was hyphenated to fit.
 *
 * Kept free of pdf.js types so the inference can be tested without a browser;
 * the parser maps the library's items onto `TextFragment`.
 */

export interface TextFragment {
  readonly text: string;
  /** PDF user space: origin bottom-left, so y decreases down the page. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Line {
  readonly text: string;
  readonly y: number;
  readonly height: number;
}

/** Fragments within this fraction of a line height count as the same baseline. */
const BASELINE_TOLERANCE = 0.5;
/** A gap wider than this fraction of the line height is a word space. */
const WORD_GAP = 0.2;
/** Lines further apart than this multiple of the line height start a paragraph. */
const PARAGRAPH_GAP = 1.8;

function groupIntoLines(fragments: readonly TextFragment[]): Line[] {
  const usable = fragments.filter((fragment) => fragment.text.trim().length > 0);
  if (usable.length === 0) return [];

  // Down the page first, then left to right within a line.
  const sorted = [...usable].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines: Line[] = [];
  let current: TextFragment[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    const height = Math.max(...current.map((fragment) => fragment.height)) || 1;
    let text = '';
    let previous: TextFragment | undefined;

    for (const fragment of current) {
      // pdf.js splits a single word wherever the styling changes, so a space is
      // only real when the glyphs are actually apart on the page.
      if (previous) {
        const gap = fragment.x - (previous.x + previous.width);
        if (gap > height * WORD_GAP) text += ' ';
      }
      text += fragment.text;
      previous = fragment;
    }

    const collapsed = text.replaceAll(/\s+/g, ' ').trim();
    if (collapsed.length > 0) {
      lines.push({ text: collapsed, y: current[0]?.y ?? 0, height });
    }
    current = [];
  };

  for (const fragment of sorted) {
    const first = current[0];
    if (first && Math.abs(first.y - fragment.y) > fragment.height * BASELINE_TOLERANCE) flush();
    current.push(fragment);
  }
  flush();

  return lines;
}

/**
 * Joins a line to the next across a hyphen. A lowercase continuation was a word
 * broken to fit and the hyphen goes; a capitalised one is a real compound —
 * "Donau-Kommission" — and it stays.
 */
function joinAcrossLineBreak(left: string, right: string): string {
  if (/[-‐­]$/.test(left)) {
    const continuation = right.trimStart();
    const isCompound = /^[\p{Lu}]/u.test(continuation);
    return isCompound ? `${left}${continuation}` : `${left.slice(0, -1)}${continuation}`;
  }
  return `${left} ${right}`;
}

/** Paragraphs, in reading order, for one page's fragments. */
export function fragmentsToParagraphs(fragments: readonly TextFragment[]): string[] {
  const lines = groupIntoLines(fragments);
  if (lines.length === 0) return [];

  const paragraphs: string[] = [];
  let current = lines[0]?.text ?? '';

  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1] as Line;
    const line = lines[index] as Line;
    const distance = previous.y - line.y;

    if (distance > Math.max(previous.height, line.height) * PARAGRAPH_GAP) {
      paragraphs.push(current);
      current = line.text;
    } else {
      current = joinAcrossLineBreak(current, line.text);
    }
  }
  paragraphs.push(current);

  return paragraphs.filter((paragraph) => paragraph.trim().length > 0);
}
