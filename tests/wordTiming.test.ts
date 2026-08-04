import { describe, expect, it } from 'vitest';
import { countSyllables, estimateWordTimings, wordIndexAt, wordWeight } from '../src/speech/wordTiming.ts';
import type { TimingWord } from '../src/speech/wordTiming.ts';

const words = (...specs: Array<[text: string, gap?: string]>): TimingWord[] =>
  specs.map(([text, gap = ' ']) => ({ text, gap }));

describe('countSyllables', () => {
  it('counts vowel groups', () => {
    expect(countSyllables('Haus')).toBe(1);
    expect(countSyllables('Dokument')).toBe(3);
    expect(countSyllables('reading')).toBe(2);
  });

  it('never returns less than one', () => {
    expect(countSyllables('')).toBe(1);
    expect(countSyllables('!')).toBe(1);
  });

  it('treats consonant-only tokens as spelled out', () => {
    expect(countSyllables('GmbH')).toBeGreaterThan(1);
  });

  it('handles umlauts as vowels', () => {
    expect(countSyllables('für')).toBe(1);
    expect(countSyllables('Bücher')).toBe(2);
  });
});

describe('wordWeight', () => {
  it('gives longer words more time', () => {
    expect(wordWeight({ text: 'Vertragsverhandlung', gap: ' ' })).toBeGreaterThan(
      wordWeight({ text: 'ja', gap: ' ' }),
    );
  });

  it('budgets pause time for sentence-final punctuation', () => {
    const plain = wordWeight({ text: 'Wort', gap: ' ' });
    const comma = wordWeight({ text: 'Wort', gap: ', ' });
    const full = wordWeight({ text: 'Wort', gap: '. ' });
    expect(comma).toBeGreaterThan(plain);
    expect(full).toBeGreaterThan(comma);
  });
});

describe('estimateWordTimings', () => {
  it('returns nothing for no words', () => {
    expect(estimateWordTimings([], 5)).toEqual([]);
  });

  it('covers exactly the given duration', () => {
    const timings = estimateWordTimings(words(['Der'], ['Hund'], ['bellt', '.']), 3);
    expect(timings[0]?.start).toBe(0);
    expect(timings.at(-1)?.end).toBeCloseTo(3, 10);
  });

  it('starts at the offset when the clip has leading silence', () => {
    const timings = estimateWordTimings(words(['eins'], ['zwei']), 2, 0.25);
    expect(timings[0]?.start).toBeCloseTo(0.25, 10);
    expect(timings.at(-1)?.end).toBeCloseTo(2.25, 10);
  });

  it('produces a contiguous, non-decreasing timeline', () => {
    const timings = estimateWordTimings(
      words(['Guten'], ['Morgen', ','], ['wie'], ['geht'], ['es'], ['Ihnen', '?']),
      4.2,
      0.1,
    );
    for (const [i, timing] of timings.entries()) {
      expect(timing.end).toBeGreaterThanOrEqual(timing.start);
      if (i > 0) expect(timing.start).toBeCloseTo(timings[i - 1]!.end, 10);
    }
  });

  it('gives a word before a full stop a longer slot than the same word mid-clause', () => {
    const timings = estimateWordTimings(words(['Wort', '. '], ['Wort', ' '], ['Wort', ' ']), 3);
    const first = timings[0]!.end - timings[0]!.start;
    const second = timings[1]!.end - timings[1]!.start;
    expect(first).toBeGreaterThan(second);
  });

  it('falls back to an even split for zero-length audio', () => {
    const timings = estimateWordTimings(words(['a'], ['b']), 0);
    expect(timings).toHaveLength(2);
    expect(timings.at(-1)?.end).toBe(0);
  });
});

describe('wordIndexAt', () => {
  const timings = estimateWordTimings(words(['eins'], ['zwei'], ['drei']), 3);

  it('reports nothing before the first word', () => {
    expect(wordIndexAt(timings, -1)).toBe(-1);
  });

  it('finds the word playing at a moment', () => {
    expect(wordIndexAt(timings, timings[1]!.start + 0.01)).toBe(1);
  });

  it('holds the last word once playback runs past the end', () => {
    expect(wordIndexAt(timings, 99)).toBe(2);
  });

  it('handles an empty timeline', () => {
    expect(wordIndexAt([], 1)).toBe(-1);
  });
});
