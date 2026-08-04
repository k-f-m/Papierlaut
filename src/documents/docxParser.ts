import { baseName } from './types.ts';
import type { DocumentParser, ParsedDocument, SourceFile } from './types.ts';

/**
 * Word documents via mammoth's prebuilt browser bundle. It is ~900 kB, so it is
 * loaded on first use rather than on page load — most sessions never open a
 * .docx, and the reader should start instantly.
 */
export class DocxParser implements DocumentParser {
  readonly id = 'docx';
  readonly extensions = ['.docx'] as const;

  async parse(file: SourceFile): Promise<ParsedDocument> {
    // The bundle is UMD; depending on how the bundler interops it, the API sits
    // either on the namespace or on `default`.
    const module = await import('mammoth/mammoth.browser.js');
    const mammoth = module.default ?? module;
    const arrayBuffer = await file.arrayBuffer();

    const result = await mammoth.convertToHtml(
      { arrayBuffer },
      {
        // Word's own heading styles do not always map cleanly; naming them
        // explicitly keeps the document outline intact for the reader.
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh",
          "p[style-name='Quote'] => blockquote:fresh",
          "p[style-name='Intense Quote'] => blockquote:fresh",
        ],
      },
    );

    return {
      title: baseName(file.name),
      html: result.value,
      warnings: result.messages
        .filter((message) => message.type === 'warning' || message.type === 'error')
        .map((message) => message.message),
    };
  }
}
