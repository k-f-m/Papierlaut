import { baseName } from './types.ts';
import { escapeHtml } from './sanitize.ts';
import { fragmentsToParagraphs } from './pdfLayout.ts';
import { NoTextLayerError } from './types.ts';
import type { DocumentParser, ParsedDocument, SourceFile } from './types.ts';
import type { TextFragment } from './pdfLayout.ts';

/**
 * Served from our own origin by scripts/collect-runtime-assets.mjs. pdf.js would
 * otherwise reach for a CDN, which `connect-src 'self'` refuses — correctly, but
 * the document would then extract as empty rather than as an obvious failure.
 */
const WORKER_URL = '/pdf/pdf.worker.min.mjs';
const CMAP_URL = '/pdf/cmaps/';
const STANDARD_FONT_URL = '/pdf/standard_fonts/';

interface PdfTextItem {
  readonly str: string;
  readonly transform: readonly number[];
  readonly width: number;
  readonly height: number;
}

function isTextItem(item: unknown): item is PdfTextItem {
  return typeof (item as PdfTextItem).str === 'string';
}

function toFragment(item: PdfTextItem): TextFragment {
  const [, , , scaleY = 0, x = 0, y = 0] = item.transform;
  return {
    text: item.str,
    x,
    y,
    width: item.width,
    // Some producers report a zero height; the vertical scale is the fallback.
    height: item.height > 0 ? item.height : Math.abs(scaleY) || 10,
  };
}

/**
 * Reads PDFs through pdf.js, entirely in the tab.
 *
 * Only the text layer is used — nothing is rendered — so a scanned page yields
 * nothing at all. That is reported as its own failure rather than as an empty
 * document, because the file plainly has content and the user needs to know it
 * needs OCR.
 */
export class PdfParser implements DocumentParser {
  readonly id = 'pdf';
  readonly extensions = ['.pdf'] as const;

  async parse(file: SourceFile): Promise<ParsedDocument> {
    // ~1 MB of library that most sessions never need.
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL;

    const task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      // pdf.js 6 dropped its use of eval entirely, so nothing here needs the
      // 'unsafe-eval' this app deliberately withholds.
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: STANDARD_FONT_URL,
      // Text extraction only; no glyph ever reaches a canvas.
      disableFontFace: true,
    });

    const document = await task.promise;
    try {
      const paragraphs: string[] = [];
      for (let number = 1; number <= document.numPages; number += 1) {
        const page = await document.getPage(number);
        const content = await page.getTextContent();
        const items = content.items as unknown[];
        const fragments = items.filter(isTextItem).map(toFragment);
        paragraphs.push(...fragmentsToParagraphs(fragments));
        page.cleanup();
      }

      if (paragraphs.length === 0) throw new NoTextLayerError(file.name);

      const metadata = await document.getMetadata().catch(() => undefined);
      const title = (metadata?.info as { Title?: string } | undefined)?.Title?.trim();

      return {
        title: title && title.length > 0 ? title : baseName(file.name),
        html: paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join('\n'),
        warnings: [],
      };
    } finally {
      // The loading task owns the worker; destroying it releases both.
      await task.destroy();
    }
  }
}
