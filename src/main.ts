import './styles.css';

import { AppController } from './ui/appController.ts';
import { DocumentParserRegistry } from './documents/parserRegistry.ts';
import { DocxParser } from './documents/docxParser.ts';
import { HtmlParser } from './documents/htmlParser.ts';
import { LocalSettingsStore } from './ui/settings.ts';
import { MarkdownParser } from './documents/markdownParser.ts';
import { PiperEngine } from './speech/piperEngine.ts';
import { PlainTextParser } from './documents/plainTextParser.ts';
import { SystemVoiceEngine } from './speech/systemVoiceEngine.ts';

/**
 * Composition root: the only place that knows every concrete implementation.
 * Engine order is preference order — the neural voices come first because they
 * are the reason this reader exists; the system voices are the fallback when no
 * model was built into the image.
 */
const controller = new AppController({
  parsers: new DocumentParserRegistry([
    new DocxParser(),
    new MarkdownParser(),
    new HtmlParser(),
    new PlainTextParser(),
  ]),
  engines: [new PiperEngine(), new SystemVoiceEngine()],
  settings: new LocalSettingsStore(),
});

void controller.start();
