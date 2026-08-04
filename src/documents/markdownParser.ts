import { Marked } from 'marked';
import { baseName } from './types.ts';
import type { DocumentParser, ParsedDocument, SourceFile } from './types.ts';

/**
 * A private Marked instance rather than the global one, so parser settings
 * cannot be mutated from elsewhere in the app.
 */
const marked = new Marked({
  gfm: true,
  breaks: false,
  async: false,
});

/** Prefers a leading `# Heading` over the file name as the document title. */
function firstHeading(markdown: string): string | undefined {
  const match = /^\s*#\s+(.+?)\s*$/m.exec(markdown);
  return match?.[1];
}

export class MarkdownParser implements DocumentParser {
  readonly id = 'markdown';
  readonly extensions = ['.md', '.markdown', '.mdown', '.mkd'] as const;

  async parse(file: SourceFile): Promise<ParsedDocument> {
    const source = await file.text();
    const html = marked.parse(source) as string;
    return {
      title: firstHeading(source) ?? baseName(file.name),
      html,
      warnings: [],
    };
  }
}
