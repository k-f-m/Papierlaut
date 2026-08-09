import './styles.css';

import { AppController } from './ui/appController.ts';
import { DocumentParserRegistry } from './documents/parserRegistry.ts';
import { DocxParser } from './documents/docxParser.ts';
import { HtmlParser } from './documents/htmlParser.ts';
import { LocalSettingsStore } from './ui/settings.ts';
import { MarkdownParser } from './documents/markdownParser.ts';
import { PiperEngine } from './speech/piperEngine.ts';
import { PdfParser } from './documents/pdfParser.ts';
import { PlainTextParser } from './documents/plainTextParser.ts';
import { SystemVoiceEngine } from './speech/systemVoiceEngine.ts';
import { BergamotTranslator } from './translation/bergamotTranslator.ts';
import { BuiltInTranslator } from './translation/builtInTranslator.ts';

/**
 * Composition root: the only place that knows every concrete implementation.
 * Engine order is preference order — the neural voices come first because they
 * are the reason this reader exists; the system voices are the fallback when no
 * model was built into the image.
 *
 * Translators are in preference order too. Bergamot comes first because its
 * models ship inside the image and are served from this origin, so the offline
 * claim is enforced by the same CSP as everything else; the browser's built-in
 * translator is the fallback for images built without models. If neither can
 * handle the document, the control never appears.
 */
const controller = new AppController({
  parsers: new DocumentParserRegistry([
    new DocxParser(),
    new PdfParser(),
    new MarkdownParser(),
    new HtmlParser(),
    new PlainTextParser(),
  ]),
  engines: [new PiperEngine(), new SystemVoiceEngine()],
  settings: new LocalSettingsStore(),
  translators: [
    new BergamotTranslator({
      // Imported only if a translation is actually asked for, so a reader that
      // never translates never downloads the library.
      createTranslator: async (registryUrl) => {
        const { BatchTranslator } = await import('@browsermt/bergamot-translator');
        return new BatchTranslator({ registryUrl });
      },
    }),
    new BuiltInTranslator(),
  ],
});

void controller.start();
