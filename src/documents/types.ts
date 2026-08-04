/** A file the user dropped, reduced to what the reader needs. */
export interface SourceFile {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface ParsedDocument {
  readonly title: string;
  /** Untrusted HTML. Callers must sanitise before it reaches the DOM. */
  readonly html: string;
  /** Non-fatal problems worth surfacing, e.g. unsupported .docx styles. */
  readonly warnings: readonly string[];
}

/**
 * One document format. Adding a format means adding an implementation and
 * registering it — no existing parser or the registry has to change.
 */
export interface DocumentParser {
  readonly id: string;
  /** Extensions handled, lowercase, with leading dot. */
  readonly extensions: readonly string[];
  parse(file: SourceFile): Promise<ParsedDocument>;
}

export class UnsupportedFormatError extends Error {
  constructor(readonly fileName: string, readonly supported: readonly string[]) {
    super(`Unsupported file type: ${fileName}`);
    this.name = 'UnsupportedFormatError';
  }
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

export function baseName(name: string): string {
  const ext = fileExtension(name);
  return ext ? name.slice(0, -ext.length) : name;
}
