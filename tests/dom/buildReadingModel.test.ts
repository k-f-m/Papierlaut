/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildReadingModel } from '../../src/reading/buildReadingModel.ts';

function render(html: string): HTMLElement {
  const root = document.createElement('article');
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('buildReadingModel', () => {
  it('wraps every word in a span linked back to its token', () => {
    const root = render('<p>Guten Morgen, Welt.</p>');
    const model = buildReadingModel(root, 'de');

    expect(model.words.map((word) => word.text)).toEqual(['Guten', 'Morgen', 'Welt']);
    for (const word of model.words) {
      expect(word.elements.length).toBeGreaterThan(0);
      expect(word.elements.map((element) => element.textContent).join('')).toBe(word.text);
    }
  });

  it('preserves the rendered text exactly', () => {
    const source = '<p>Ein <strong>fetter</strong> Text — mit Zeichen &amp; Umlauten: Grüße.</p>';
    const root = render(source);
    const before = root.textContent;
    buildReadingModel(root, 'de');
    expect(root.textContent).toBe(before);
  });

  it('keeps a sentence contiguous across inline elements', () => {
    const root = render('<p>Das ist <em>wirklich</em> wichtig. Und das hier auch.</p>');
    const model = buildReadingModel(root, 'de');

    expect(model.sentences).toHaveLength(2);
    expect(model.sentences[0]?.text).toBe('Das ist wirklich wichtig.');
    // The first sentence spans three text nodes, so it needs three wrappers to
    // stay visually continuous when highlighted.
    expect(model.sentences[0]?.elements.length).toBeGreaterThan(1);
  });

  it('splits a word that straddles an inline boundary into multiple spans', () => {
    const root = render('<p>Papier<b>laut</b> liest.</p>');
    const model = buildReadingModel(root, 'de');

    const first = model.words[0];
    expect(first?.text).toBe('Papierlaut');
    expect(first?.elements).toHaveLength(2);
    expect(first?.elements.map((element) => element.textContent).join('')).toBe('Papierlaut');
  });

  it('treats the innermost element as the paragraph', () => {
    const root = render('<div><ul><li>Erstens.</li><li>Zweitens.</li></ul></div>');
    const model = buildReadingModel(root, 'de');

    expect(model.blocks.map((block) => block.tagName)).toEqual(['LI', 'LI']);
    expect(model.sentences.map((sentence) => sentence.text)).toEqual(['Erstens.', 'Zweitens.']);
  });

  it('gives stray text beside a block its own paragraph', () => {
    const root = render('<div>Einleitung.<p>Absatz.</p></div>');
    const model = buildReadingModel(root, 'de');

    expect(model.sentences.map((sentence) => sentence.text)).toEqual(['Einleitung.', 'Absatz.']);
  });

  it('maps every word to the sentence that contains it', () => {
    const root = render('<p>Erster Satz. Zweiter Satz.</p>');
    const model = buildReadingModel(root, 'de');

    for (const sentence of model.sentences) {
      for (const word of sentence.words) {
        expect(model.words[word.index]?.sentence).toBe(sentence.index);
        expect(sentence.text.slice(word.start, word.end)).toBe(word.text);
      }
    }
  });

  it('records the gap after each word so pauses can be budgeted', () => {
    const root = render('<p>Ja, natürlich.</p>');
    const model = buildReadingModel(root, 'de');
    const [first, second] = model.sentences[0]?.words ?? [];

    expect(first?.gap).toBe(', ');
    expect(second?.gap).toBe('.');
  });

  it('keeps document-wide offsets pointing into the plain text', () => {
    const root = render('<h1>Titel</h1><p>Ein Satz.</p>');
    const model = buildReadingModel(root, 'de');

    for (const word of model.words) {
      expect(model.text.slice(word.start, word.end)).toBe(word.text);
    }
    for (const sentence of model.sentences) {
      expect(model.text.slice(sentence.start, sentence.end)).toBe(sentence.text);
    }
  });

  it('produces an empty model for markup with no text', () => {
    const model = buildReadingModel(render('<p></p><hr>'), 'en');
    expect(model.words).toEqual([]);
    expect(model.sentences).toEqual([]);
  });

  it('reads table cells as separate paragraphs', () => {
    const root = render('<table><tr><td>Links.</td><td>Rechts.</td></tr></table>');
    const model = buildReadingModel(root, 'de');
    expect(model.sentences.map((sentence) => sentence.text)).toEqual(['Links.', 'Rechts.']);
  });
});
