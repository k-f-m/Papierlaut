/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { InterlinearView, TRANSLATION_CLASS } from '../../src/translation/interlinearView.ts';
import { NON_READABLE_CLASS, buildReadingModel } from '../../src/reading/buildReadingModel.ts';

function render(html: string): HTMLElement {
  const root = document.createElement('article');
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
}

const DOCUMENT = '<p>Erster Satz. Zweiter Satz.</p><p>Dritter Satz.</p>';

describe('InterlinearView', () => {
  let root: HTMLElement;
  let view: InterlinearView;

  beforeEach(() => {
    root = render(DOCUMENT);
    const model = buildReadingModel(root, 'de');
    view = new InterlinearView({ sentences: model.sentences, lang: 'en-US' });
  });

  const nodes = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(`.${TRANSLATION_CLASS}`)];

  it('places the translation immediately after its sentence', () => {
    view.set(0, 'First sentence.');

    const [node] = nodes();
    expect(node?.textContent).toBe('First sentence.');
    // The sentence it belongs to is the element right before it.
    expect(node?.previousElementSibling?.getAttribute('data-s')).toBe('0');
  });

  it('tags the translation with its language for hyphenation and screen readers', () => {
    view.set(0, 'First sentence.');

    expect(nodes()[0]?.getAttribute('lang')).toBe('en-US');
  });

  it('marks the translation as content the reader must ignore', () => {
    view.set(0, 'First sentence.');

    expect(nodes()[0]?.classList.contains(NON_READABLE_CLASS)).toBe(true);
  });

  it('is inline, so it cannot turn its paragraph into two blocks', () => {
    view.set(0, 'First sentence.');

    // A <div> or <p> here would make the paragraph a block container and split
    // the original text into an anonymous block on the next build.
    expect(nodes()[0]?.tagName).toBe('SPAN');
  });

  it('replaces a translation rather than appending a second one', () => {
    view.set(0, 'First sentence.');
    view.set(0, 'A better first sentence.');

    expect(nodes()).toHaveLength(1);
    expect(nodes()[0]?.textContent).toBe('A better first sentence.');
  });

  it('renders nothing for an empty translation', () => {
    view.set(1, '');

    expect(nodes()).toHaveLength(0);
  });

  it('drops an existing translation when it is replaced by an empty one', () => {
    view.set(1, 'Second sentence.');
    view.set(1, '');

    expect(nodes()).toHaveLength(0);
  });

  it('handles every sentence in the document independently', () => {
    view.set(0, 'First.');
    view.set(1, 'Second.');
    view.set(2, 'Third.');

    expect(nodes().map((node) => node.textContent)).toEqual(['First.', 'Second.', 'Third.']);
  });

  it('ignores a sentence index the document does not have', () => {
    expect(() => view.set(99, 'Nowhere.')).not.toThrow();
    expect(nodes()).toHaveLength(0);
  });

  it('removes one translation without touching the others', () => {
    view.set(0, 'First.');
    view.set(1, 'Second.');
    view.remove(0);

    expect(nodes().map((node) => node.textContent)).toEqual(['Second.']);
  });

  it('clears every translation and leaves the document markup behind', () => {
    view.set(0, 'First.');
    view.set(1, 'Second.');
    view.clear();

    expect(nodes()).toHaveLength(0);
    expect(root.textContent).toBe('Erster Satz. Zweiter Satz.Dritter Satz.');
  });
});

describe('buildReadingModel with translations present', () => {
  it('does not read translated text as part of the document', () => {
    const root = render(DOCUMENT);
    const before = buildReadingModel(root, 'de');
    const view = new InterlinearView({ sentences: before.sentences, lang: 'en-US' });

    view.set(0, 'First sentence.');
    view.set(1, 'Second sentence.');
    view.set(2, 'Third sentence.');
    const after = buildReadingModel(root, 'de');

    expect(after.text).toBe(before.text);
    expect(after.text).not.toContain('First sentence.');
    expect(after.words).toHaveLength(before.words.length);
    expect(after.sentences).toHaveLength(before.sentences.length);
  });

  it('does not turn a translation into a sentence of its own', () => {
    const root = render('<p>Ein Satz.</p><p></p>');
    const model = buildReadingModel(root, 'de');
    const view = new InterlinearView({ sentences: model.sentences, lang: 'en-US' });
    view.set(0, 'A sentence.');

    expect(buildReadingModel(root, 'de').sentences).toHaveLength(1);
  });
});
