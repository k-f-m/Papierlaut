import { describe, expect, it } from 'vitest';
import { fragmentsToParagraphs } from '../src/documents/pdfLayout.ts';
import type { TextFragment } from '../src/documents/pdfLayout.ts';

/** PDF coordinates put the origin bottom-left, so y decreases down the page. */
function fragment(text: string, x: number, y: number, width = text.length * 5): TextFragment {
  return { text, x, y, width, height: 10 };
}

describe('fragmentsToParagraphs', () => {
  it('returns nothing for an empty page', () => {
    expect(fragmentsToParagraphs([])).toEqual([]);
  });

  it('joins fragments sharing a baseline into one line', () => {
    const paragraphs = fragmentsToParagraphs([
      fragment('Ein', 0, 700, 15),
      fragment('Satz.', 20, 700, 25),
    ]);

    expect(paragraphs).toEqual(['Ein Satz.']);
  });

  it('does not invent a space between fragments that abut', () => {
    // pdf.js often splits a single word across fragments at a style change.
    const paragraphs = fragmentsToParagraphs([
      fragment('Tempe', 0, 700, 25),
      fragment('ratur', 25, 700, 25),
    ]);

    expect(paragraphs).toEqual(['Temperatur']);
  });

  it('reads lines down the page, not up it', () => {
    const paragraphs = fragmentsToParagraphs([
      fragment('Zweite Zeile.', 0, 688),
      fragment('Erste Zeile.', 0, 700),
    ]);

    expect(paragraphs).toEqual(['Erste Zeile. Zweite Zeile.']);
  });

  it('keeps consecutive lines in the same paragraph', () => {
    const paragraphs = fragmentsToParagraphs([
      fragment('Ein Satz der über', 0, 700),
      fragment('zwei Zeilen läuft.', 0, 688),
    ]);

    expect(paragraphs).toEqual(['Ein Satz der über zwei Zeilen läuft.']);
  });

  it('starts a new paragraph where the page leaves a gap', () => {
    const paragraphs = fragmentsToParagraphs([
      fragment('Erster Absatz.', 0, 700),
      fragment('Zweiter Absatz.', 0, 650),
    ]);

    expect(paragraphs).toEqual(['Erster Absatz.', 'Zweiter Absatz.']);
  });

  it('rejoins a word hyphenated across a line break', () => {
    // Ubiquitous in German typesetting, and it makes the voice unintelligible.
    const paragraphs = fragmentsToParagraphs([
      fragment('Das ist eine Tempera-', 0, 700),
      fragment('turmessung.', 0, 688),
    ]);

    expect(paragraphs).toEqual(['Das ist eine Temperaturmessung.']);
  });

  it('keeps the hyphen when the continuation is a capitalised compound', () => {
    const paragraphs = fragmentsToParagraphs([
      fragment('Die Donau-', 0, 700),
      fragment('Kommission tagt.', 0, 688),
    ]);

    expect(paragraphs).toEqual(['Die Donau-Kommission tagt.']);
  });

  it('ignores blank fragments', () => {
    const paragraphs = fragmentsToParagraphs([
      fragment('Ein', 0, 700, 15),
      fragment('   ', 18, 700, 4),
      fragment('Satz.', 24, 700, 25),
    ]);

    expect(paragraphs).toEqual(['Ein Satz.']);
  });

  it('collapses runs of whitespace inside a line', () => {
    const paragraphs = fragmentsToParagraphs([fragment('Ein    Satz.', 0, 700)]);

    expect(paragraphs).toEqual(['Ein Satz.']);
  });

  it('drops a page that produced no readable text', () => {
    expect(fragmentsToParagraphs([fragment('   ', 0, 700, 4)])).toEqual([]);
  });
});
