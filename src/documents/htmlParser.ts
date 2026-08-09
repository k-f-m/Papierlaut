import { baseName } from './types.ts';
import { paragraphsToHtml } from './textToHtml.ts';
import type { DocumentParser, ParsedDocument, SourceFile } from './types.ts';

/**
 * Raised when a file claiming to be HTML turns out to be plain text. A code
 * rather than a sentence: the interface is bilingual, and the parser has no
 * business choosing the language it is reported in.
 */
export const NOT_HTML_WARNING = 'warning.notHtml';

/** Structural markup that means the file really is HTML rather than text in disguise. */
const BLOCK_MARKUP =
  'p, div, h1, h2, h3, h4, h5, h6, ul, ol, li, table, blockquote, pre, section, article, figure, dl';

/**
 * Reduces a full HTML page to its readable body.
 *
 * Parsing happens through `DOMParser`, which builds an inert document: scripts
 * are not executed and no subresource is fetched. The markup still runs through
 * `sanitizeDocumentHtml` afterwards like every other source.
 *
 * A `.htm` file is not always HTML — "save as text" and mail exports keep the
 * extension while dropping every tag. Such a file has no block markup at all,
 * and rendering it as one undifferentiated blob loses the paragraph structure
 * its blank lines still carry, so it is read as text instead.
 */
export class HtmlParser implements DocumentParser {
  readonly id = 'html';
  readonly extensions = ['.html', '.htm', '.xhtml'] as const;

  async parse(file: SourceFile): Promise<ParsedDocument> {
    const source = await file.text();
    const parsed = new DOMParser().parseFromString(source, 'text/html');

    for (const selector of ['script', 'style', 'noscript', 'template', 'nav', 'header', 'footer', 'aside']) {
      for (const element of parsed.querySelectorAll(selector)) element.remove();
    }

    // Prefer the semantic content root when the page offers one.
    const root =
      parsed.querySelector('main') ??
      parsed.querySelector('article') ??
      parsed.body ??
      parsed.documentElement;

    const title = parsed.querySelector('title')?.textContent?.trim();
    const name = title && title.length > 0 ? title : baseName(file.name);

    if (root && !root.querySelector(BLOCK_MARKUP)) {
      return {
        title: name,
        html: paragraphsToHtml(source),
        warnings: [NOT_HTML_WARNING],
      };
    }

    return { title: name, html: root?.innerHTML ?? '', warnings: [] };
  }
}
