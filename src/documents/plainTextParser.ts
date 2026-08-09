import { baseName } from './types.ts';
import { paragraphsToHtml } from './textToHtml.ts';
import type { DocumentParser, ParsedDocument, SourceFile } from './types.ts';

/** Blank lines separate paragraphs; single newlines are soft wraps. */
export class PlainTextParser implements DocumentParser {
  readonly id = 'text';
  readonly extensions = ['.txt', '.text', '.log'] as const;

  async parse(file: SourceFile): Promise<ParsedDocument> {
    return {
      title: baseName(file.name),
      html: paragraphsToHtml(await file.text()),
      warnings: [],
    };
  }
}
