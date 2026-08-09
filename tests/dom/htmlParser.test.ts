/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { HtmlParser } from '../../src/documents/htmlParser.ts';
import type { SourceFile } from '../../src/documents/types.ts';

function file(name: string, content: string): SourceFile {
  return {
    name,
    size: content.length,
    type: '',
    async arrayBuffer() {
      return new TextEncoder().encode(content).buffer as ArrayBuffer;
    },
    async text() {
      return content;
    },
  };
}

const parser = new HtmlParser();

describe('HtmlParser with real markup', () => {
  it('keeps headings and paragraphs', async () => {
    const { html } = await parser.parse(
      file('page.html', '<html><body><main><h1>Titel</h1><p>Ein Satz.</p></main></body></html>'),
    );

    expect(html).toContain('<h1>Titel</h1>');
    expect(html).toContain('<p>Ein Satz.</p>');
  });

  it('reports no warning when the file really is HTML', async () => {
    const { warnings } = await parser.parse(file('page.html', '<body><p>Ein Satz.</p></body>'));

    expect(warnings).toEqual([]);
  });
});

describe('HtmlParser with a file that is not HTML', () => {
  // Saving a page as text and keeping the .htm extension is common enough that
  // the reader should cope rather than render one undifferentiated blob.
  const TEXT = [
    'Die Hitzewelle beherrscht die Nachrichten.',
    '',
    'Am Donnerstag hatte der Wetterdienst',
    'einen neuen Rekord gemessen.',
  ].join('\n');

  it('falls back to paragraphs split on blank lines', async () => {
    const { html } = await parser.parse(file('saved.htm', TEXT));

    expect(html).toContain('<p>Die Hitzewelle beherrscht die Nachrichten.</p>');
  });

  it('joins soft-wrapped lines inside a paragraph', async () => {
    const { html } = await parser.parse(file('saved.htm', TEXT));

    expect(html).toContain('<p>Am Donnerstag hatte der Wetterdienst einen neuen Rekord gemessen.</p>');
  });

  it('escapes text that looks like markup', async () => {
    const { html } = await parser.parse(file('saved.htm', 'Siehe <https://example.com/> dort.'));

    expect(html).toContain('&lt;https://example.com/&gt;');
  });

  it('says why it fell back', async () => {
    const { warnings } = await parser.parse(file('saved.htm', TEXT));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toBe('warning.notHtml');
  });

  it('still prefers the file name for the title', async () => {
    const { title } = await parser.parse(file('saved.htm', TEXT));

    expect(title).toBe('saved');
  });
});
