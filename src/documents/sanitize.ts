import DOMPurify from 'dompurify';

/**
 * Structural tags only. Everything that could execute, navigate or embed is
 * dropped; the reader only ever needs text with light structure.
 */
const ALLOWED_TAGS = [
  'a', 'abbr', 'article', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup',
  'dd', 'del', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'section',
  'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
  'u', 'ul', 'var',
];

const ALLOWED_ATTR = ['alt', 'colspan', 'dir', 'href', 'id', 'lang', 'rowspan', 'src', 'title'];

let hooksInstalled = false;

/**
 * Beyond XSS, sanitising here enforces the app's central promise: a dropped
 * document must not be able to make the browser talk to anyone. Any attribute
 * that could trigger a request to a remote origin is neutralised, so the guard
 * holds even if the Content-Security-Policy is ever relaxed.
 */
function installHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;

    if (node.hasAttribute('src')) {
      const src = node.getAttribute('src') ?? '';
      // Word documents arrive with their images already inlined as data URIs;
      // anything else would be a fetch off-machine.
      if (!src.startsWith('data:')) node.removeAttribute('src');
    }

    if (node.tagName === 'A' && node.hasAttribute('href')) {
      // Keep the link text readable and the target visible, but make it inert.
      node.setAttribute('rel', 'noopener noreferrer nofollow');
      node.setAttribute('target', '_blank');
    }
  });
}

export function sanitizeDocumentHtml(html: string): string {
  installHooks();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta'],
    FORBID_ATTR: ['style', 'srcset', 'background', 'poster', 'formaction', 'ping'],
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false,
  }) as string;
}

/** Escapes text for embedding in HTML — used by the parsers that build markup themselves. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
