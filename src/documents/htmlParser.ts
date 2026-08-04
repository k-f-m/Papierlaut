import { baseName } from './types.ts';
import type { DocumentParser, ParsedDocument, SourceFile } from './types.ts';

/**
 * Reduces a full HTML page to its readable body.
 *
 * Parsing happens through `DOMParser`, which builds an inert document: scripts
 * are not executed and no subresource is fetched. The markup still runs through
 * `sanitizeDocumentHtml` afterwards like every other source.
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

    return {
      title: title && title.length > 0 ? title : baseName(file.name),
      html: root?.innerHTML ?? '',
      warnings: [],
    };
  }
}
