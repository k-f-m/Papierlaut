/** A half-open `[start, end)` slice of some source string. */
export interface TextSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

type Granularity = 'word' | 'sentence';

const segmenters = new Map<string, Intl.Segmenter>();

function segmenterFor(locale: string, granularity: Granularity): Intl.Segmenter | undefined {
  if (typeof Intl?.Segmenter !== 'function') return undefined;
  const key = `${locale}|${granularity}`;
  let segmenter = segmenters.get(key);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(locale, { granularity });
    segmenters.set(key, segmenter);
  }
  return segmenter;
}

/** Trims surrounding whitespace while keeping offsets anchored to the source. */
function trimSpan(text: string, start: number, end: number): TextSpan | undefined {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(text[from] as string)) from += 1;
  while (to > from && /\s/.test(text[to - 1] as string)) to -= 1;
  if (from >= to) return undefined;
  return { start: from, end: to, text: text.slice(from, to) };
}

/**
 * Word-like segments only: punctuation and whitespace are excluded, so the
 * spans line up with what a listener perceives as "the word being read".
 */
export function segmentWords(text: string, locale: string): TextSpan[] {
  const segmenter = segmenterFor(locale, 'word');
  if (!segmenter) return fallbackWords(text);

  const spans: TextSpan[] = [];
  for (const segment of segmenter.segment(text)) {
    if (!segment.isWordLike) continue;
    const span = trimSpan(text, segment.index, segment.index + segment.segment.length);
    if (span) spans.push(span);
  }
  return spans;
}

/**
 * Sentence segments, whitespace trimmed. Trailing punctuation stays attached —
 * the timing estimator uses it to decide how long a pause to allow for.
 */
export function segmentSentences(text: string, locale: string): TextSpan[] {
  const segmenter = segmenterFor(locale, 'sentence');
  const spans: TextSpan[] = [];

  if (segmenter) {
    for (const segment of segmenter.segment(text)) {
      const span = trimSpan(text, segment.index, segment.index + segment.segment.length);
      if (span) spans.push(span);
    }
  } else {
    for (const span of fallbackSentences(text)) spans.push(span);
  }

  // A whole paragraph as one segment is common in Markdown and in Word
  // documents without hard stops. Reading it as a single utterance costs the
  // listener their place, so long segments are split at clause boundaries.
  return spans.flatMap((span) => splitOverlongSpan(text, span));
}

/** Above this, a sentence is uncomfortable to re-listen to and slow to synthesise. */
const MAX_SENTENCE_CHARS = 320;
const CLAUSE_BREAK = /[,;:–—]\s|\s[-–—]\s/g;

function splitOverlongSpan(source: string, span: TextSpan): TextSpan[] {
  if (span.text.length <= MAX_SENTENCE_CHARS) return [span];

  const pieces: TextSpan[] = [];
  let cursor = span.start;

  while (span.end - cursor > MAX_SENTENCE_CHARS) {
    const window = source.slice(cursor, cursor + MAX_SENTENCE_CHARS);
    CLAUSE_BREAK.lastIndex = 0;
    let cut = -1;
    for (const match of window.matchAll(CLAUSE_BREAK)) {
      // Keep the break itself with the left-hand piece.
      if (match.index > MAX_SENTENCE_CHARS * 0.4) cut = match.index + match[0].length;
    }
    if (cut < 0) {
      const space = window.lastIndexOf(' ');
      cut = space > MAX_SENTENCE_CHARS * 0.4 ? space + 1 : MAX_SENTENCE_CHARS;
    }
    const piece = trimSpan(source, cursor, cursor + cut);
    if (piece) pieces.push(piece);
    cursor += cut;
  }

  const tail = trimSpan(source, cursor, span.end);
  if (tail) pieces.push(tail);
  return pieces.length > 0 ? pieces : [span];
}

// --- Fallbacks -------------------------------------------------------------
// Every browser this app targets ships Intl.Segmenter. These exist so the pure
// functions stay usable in any runtime, and so a missing Intl degrades to
// slightly worse segmentation rather than a blank page.

const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’\-‑][\p{L}\p{N}]+)*/gu;

function fallbackWords(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    spans.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
  }
  return spans;
}

function fallbackSentences(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const pattern = /[^.!?…\n]+(?:[.!?…]+["'”’)]*|\n+|$)/g;
  for (const match of text.matchAll(pattern)) {
    const span = trimSpan(text, match.index, match.index + match[0].length);
    if (span) spans.push(span);
  }
  return spans;
}
