import { escapeHtml } from './sanitize.ts';
import { baseName } from './types.ts';
import type { DocumentParser, ParsedDocument, SourceFile } from './types.ts';

/** Blank lines separate paragraphs; single newlines are soft wraps. */
export class PlainTextParser implements DocumentParser {
  readonly id = 'text';
  readonly extensions = ['.txt', '.text', '.log'] as const;

  async parse(file: SourceFile): Promise<ParsedDocument> {
    const source = await file.text();
    const paragraphs = source
      .replaceAll('\r\n', '\n')
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter((block) => block.length > 0);

    const html = paragraphs
      .map((block) => `<p>${escapeHtml(block).replaceAll('\n', ' ')}</p>`)
      .join('\n');

    return { title: baseName(file.name), html, warnings: [] };
  }
}
