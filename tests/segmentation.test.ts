import { describe, expect, it } from 'vitest';
import { segmentSentences, segmentWords } from '../src/reading/segmentation.ts';

describe('segmentWords', () => {
  it('returns word-like segments with source offsets', () => {
    const text = 'Guten Morgen, Welt!';
    const words = segmentWords(text, 'de-DE');
    expect(words.map((word) => word.text)).toEqual(['Guten', 'Morgen', 'Welt']);
    for (const word of words) {
      expect(text.slice(word.start, word.end)).toBe(word.text);
    }
  });

  it('keeps a contraction as one word', () => {
    expect(segmentWords("It doesn't matter", 'en-US').map((w) => w.text)).toContain("doesn't");
  });

  it('reads the halves of a compound separately, as a speaker does', () => {
    // UAX #29 breaks at the hyphen, which suits the highlight: "Software" and
    // "Update" are spoken as two beats.
    expect(segmentWords('Ein Software-Update.', 'de-DE').map((w) => w.text)).toEqual([
      'Ein',
      'Software',
      'Update',
    ]);
  });

  it('handles text with no words', () => {
    expect(segmentWords('  ,,, --- ', 'en-US')).toEqual([]);
  });
});

describe('segmentSentences', () => {
  it('splits on sentence-ending punctuation and trims whitespace', () => {
    const text = 'Erster Satz. Zweiter Satz! Dritter?';
    const sentences = segmentSentences(text, 'de-DE');
    expect(sentences.map((s) => s.text)).toEqual(['Erster Satz.', 'Zweiter Satz!', 'Dritter?']);
    for (const sentence of sentences) {
      expect(text.slice(sentence.start, sentence.end)).toBe(sentence.text);
    }
  });

  it('does not split inside a decimal number', () => {
    const sentences = segmentSentences('Der Betrag ist 1.250,50 Euro. Fällig am Montag.', 'de-DE');
    expect(sentences).toHaveLength(2);
    expect(sentences[0]?.text).toContain('1.250,50');
  });

  it('breaks a very long run-on paragraph into readable pieces', () => {
    const clause = 'und dann passierte noch etwas anderes das ebenfalls wichtig war, ';
    const sentences = segmentSentences(clause.repeat(12), 'de-DE');
    expect(sentences.length).toBeGreaterThan(1);
    for (const sentence of sentences) {
      expect(sentence.text.length).toBeLessThanOrEqual(320);
    }
  });

  it('covers every word of an overlong paragraph exactly once', () => {
    const source = `${'Wort '.repeat(400)}Ende.`;
    const sentences = segmentSentences(source, 'de-DE');
    const covered = sentences.map((s) => s.text).join(' ').split(/\s+/).filter(Boolean);
    expect(covered).toHaveLength(401);
  });

  it('returns nothing for whitespace only', () => {
    expect(segmentSentences('   \n  ', 'en-US')).toEqual([]);
  });
});
