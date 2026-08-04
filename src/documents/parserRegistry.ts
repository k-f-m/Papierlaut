import { UnsupportedFormatError, fileExtension } from './types.ts';
import type { DocumentParser, ParsedDocument, SourceFile } from './types.ts';

/**
 * Dispatches a file to the parser that claims its extension. Parsers are
 * injected, so the registry never grows a switch statement and tests can run
 * against fakes without touching mammoth or the DOM.
 */
export class DocumentParserRegistry {
  readonly #byExtension = new Map<string, DocumentParser>();

  constructor(parsers: readonly DocumentParser[]) {
    for (const parser of parsers) {
      for (const extension of parser.extensions) {
        this.#byExtension.set(extension.toLowerCase(), parser);
      }
    }
  }

  get supportedExtensions(): string[] {
    return [...this.#byExtension.keys()].sort();
  }

  /** The `accept` attribute for a file input. */
  get acceptAttribute(): string {
    return this.supportedExtensions.join(',');
  }

  canParse(fileName: string): boolean {
    return this.#byExtension.has(fileExtension(fileName));
  }

  async parse(file: SourceFile): Promise<ParsedDocument> {
    const parser = this.#byExtension.get(fileExtension(file.name));
    if (!parser) {
      throw new UnsupportedFormatError(file.name, this.supportedExtensions);
    }
    return parser.parse(file);
  }
}
