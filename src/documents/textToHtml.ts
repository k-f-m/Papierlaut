import { escapeHtml } from './sanitize.ts';

/**
 * Plain text as paragraphs: blank lines separate them, single newlines are soft
 * wraps and become spaces.
 *
 * Shared by the plain-text parser and by the HTML parser's fallback, so a file
 * whose extension lies about its contents is read the same way either route.
 */
export function paragraphsToHtml(source: string): string {
  return source
    .replaceAll('\r\n', '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => `<p>${escapeHtml(block).replaceAll('\n', ' ')}</p>`)
    .join('\n');
}
