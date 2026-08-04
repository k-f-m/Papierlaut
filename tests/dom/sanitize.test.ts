/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { escapeHtml, sanitizeDocumentHtml } from '../../src/documents/sanitize.ts';

/**
 * These assertions are the app's privacy promise expressed as tests: a dropped
 * document must not be able to run code or cause the browser to contact anyone.
 */
describe('sanitizeDocumentHtml', () => {
  it('keeps structural markup and text intact', () => {
    const html = sanitizeDocumentHtml('<h1>Titel</h1><p>Ein <strong>Satz</strong>.</p>');
    expect(html).toContain('<h1>Titel</h1>');
    expect(html).toContain('<strong>Satz</strong>');
  });

  it('removes scripts and event handlers', () => {
    const html = sanitizeDocumentHtml('<p onclick="steal()">Hi</p><script>steal()</script>');
    expect(html).not.toContain('script');
    expect(html).not.toContain('onclick');
    expect(html).toContain('Hi');
  });

  it('strips remote image sources so no request leaves the machine', () => {
    const html = sanitizeDocumentHtml('<img src="https://tracker.example/pixel.gif" alt="x">');
    expect(html).not.toContain('tracker.example');
  });

  it('keeps inline images, which is how Word documents carry them', () => {
    const data = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    expect(sanitizeDocumentHtml(`<img src="${data}" alt="x">`)).toContain(data);
  });

  it('drops srcset, background and poster attributes', () => {
    const html = sanitizeDocumentHtml(
      '<img srcset="https://a.example/1.png 1x" alt=""><td background="https://b.example/x.png">c</td>',
    );
    expect(html).not.toContain('a.example');
    expect(html).not.toContain('b.example');
  });

  it('removes stylesheet links and inline styles', () => {
    const html = sanitizeDocumentHtml('<link rel="stylesheet" href="https://c.example/x.css"><p style="color:red">t</p>');
    expect(html).not.toContain('c.example');
    expect(html).not.toContain('style=');
  });

  it('neutralises javascript: links', () => {
    expect(sanitizeDocumentHtml('<a href="javascript:steal()">x</a>')).not.toContain('javascript:');
  });

  it('makes surviving links inert', () => {
    const html = sanitizeDocumentHtml('<a href="https://example.com">Quelle</a>');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('Quelle');
  });

  it('refuses iframes and objects', () => {
    const html = sanitizeDocumentHtml('<iframe src="https://d.example"></iframe><object data="x"></object>');
    expect(html).not.toContain('iframe');
    expect(html).not.toContain('object');
  });
});

describe('escapeHtml', () => {
  it('escapes every character that could open a tag or attribute', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});
