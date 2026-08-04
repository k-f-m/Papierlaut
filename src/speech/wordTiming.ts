/**
 * Word-level timing for engines that return audio without timestamps.
 *
 * Piper synthesises a whole sentence into a single waveform and reports nothing
 * about where each word sits. Rather than guess at the sentence level and let
 * the highlight lag, the known total duration is distributed across the words by
 * how long each is likely to take: syllable count for the word itself, plus the
 * pause its trailing punctuation buys.
 *
 * The estimate only has to hold within one sentence — playback re-anchors to
 * real audio time at every sentence boundary, so error never accumulates.
 */

export interface TimingWord {
  readonly text: string;
  /** Characters between this word and the next; punctuation here becomes pause time. */
  readonly gap: string;
}

export interface WordTiming {
  /** Seconds from the start of the audio. */
  readonly start: number;
  readonly end: number;
}

/** Fixed cost per word: onset, articulation ramp-up, the space before it. */
const WORD_BASE_WEIGHT = 0.9;
const SYLLABLE_WEIGHT = 1.0;

/** Extra weight for the silence a mark introduces, in syllable equivalents. */
const PAUSE_WEIGHTS: ReadonlyArray<readonly [pattern: RegExp, weight: number]> = [
  [/[.!?…]/, 2.2],
  [/[:;]/, 1.4],
  [/[,]/, 1.1],
  [/[–—]|(?:^|\s)-(?:\s|$)/, 0.9],
  [/[)\]}"»”]/, 0.3],
];

const VOWEL_GROUP = /[aeiouyäöüàáâãåéèêëíìîïóòôõúùûÿæœ]+/gi;

/**
 * Vowel groups approximate syllables well enough for both languages, and it
 * degrades gracefully on names and loanwords where a dictionary would not help.
 */
export function countSyllables(word: string): number {
  const letters = word.toLowerCase().replace(/[^\p{L}]/gu, '');
  if (letters.length === 0) return 1;

  const groups = letters.match(VOWEL_GROUP)?.length ?? 0;
  if (groups === 0) {
    // Acronyms and consonant clusters ("GmbH", "SPD") are spelled out.
    return Math.max(1, Math.round(letters.length / 1.5));
  }
  return groups;
}

function pauseWeight(gap: string): number {
  let weight = 0;
  for (const [pattern, value] of PAUSE_WEIGHTS) {
    if (pattern.test(gap)) weight += value;
  }
  // A hard line break reads like a full stop even without punctuation.
  if (gap.includes('\n')) weight += 0.8;
  return weight;
}

export function wordWeight(word: TimingWord): number {
  return WORD_BASE_WEIGHT + countSyllables(word.text) * SYLLABLE_WEIGHT + pauseWeight(word.gap);
}

/**
 * Spreads `duration` seconds of speech (starting at `offset`) over `words`.
 *
 * Returned timings are contiguous and non-decreasing, and the last word ends
 * exactly at `offset + duration`, so a caller can drive a highlight straight
 * from `audio.currentTime` without a separate end-of-audio special case.
 */
export function estimateWordTimings(
  words: readonly TimingWord[],
  duration: number,
  offset = 0,
): WordTiming[] {
  if (words.length === 0) return [];

  const safeDuration = Math.max(duration, 0);
  const weights = words.map(wordWeight);
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  // Degenerate input (zero-length audio, weightless words): fall back to an
  // even split rather than dividing by zero.
  if (total <= 0) {
    const step = safeDuration / words.length;
    return words.map((_, i) => ({ start: offset + i * step, end: offset + (i + 1) * step }));
  }

  const timings: WordTiming[] = [];
  let elapsed = 0;
  for (const [i, weight] of weights.entries()) {
    const start = offset + (elapsed / total) * safeDuration;
    elapsed += weight;
    const isLast = i === weights.length - 1;
    const end = isLast ? offset + safeDuration : offset + (elapsed / total) * safeDuration;
    timings.push({ start, end });
  }
  return timings;
}

/**
 * Finds the word playing at `time` via binary search over the timings.
 * Returns the last word once playback has run past the end, and -1 before the
 * first word starts.
 */
export function wordIndexAt(timings: readonly WordTiming[], time: number): number {
  if (timings.length === 0) return -1;
  if (time < (timings[0] as WordTiming).start) return -1;

  let low = 0;
  let high = timings.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((timings[mid] as WordTiming).start <= time) low = mid;
    else high = mid - 1;
  }
  return low;
}
