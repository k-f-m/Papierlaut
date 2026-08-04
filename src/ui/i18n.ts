export type UiLocale = 'de' | 'en';

/**
 * English is the reference dictionary; its keys define the contract, so a
 * missing German string is a type error rather than a blank label at runtime.
 */
const en = {
  'app.name': 'Papierlaut',
  'app.tagline': 'Reads your documents aloud — entirely on this machine',

  'drop.headline': 'Drop a document here',
  'drop.hint': 'or choose a file — nothing is uploaded',
  'drop.button': 'Choose file',
  'drop.formats': 'Word (.docx), Markdown (.md), HTML (.html), plain text (.txt)',
  'drop.release': 'Release to open',

  'toolbar.play': 'Play',
  'toolbar.pause': 'Pause',
  'toolbar.stop': 'Stop',
  'toolbar.previous': 'Previous sentence',
  'toolbar.next': 'Next sentence',
  'toolbar.voice': 'Voice',
  'toolbar.speed': 'Speed',
  'toolbar.volume': 'Volume',
  'toolbar.follow': 'Follow along',
  'toolbar.close': 'Close document',
  'toolbar.uiLanguage': 'Interface language',

  'voices.neural': 'Natural voices (local)',
  'voices.system': 'System voices (local)',
  'voices.none': 'No offline voice available',

  'status.idle': 'Ready',
  'status.preparing': 'Preparing…',
  'status.playing': 'Reading',
  'status.paused': 'Paused',
  'status.finished': 'Finished',
  'status.loadingVoice': 'Loading voice… {percent}%',
  'status.parsing': 'Opening {name}…',
  'status.sentence': 'Sentence {current} of {total}',
  'status.words': '{count} words',

  'privacy.badge': 'Offline',
  'privacy.detail':
    'Text is never sent anywhere. Speech is synthesised in this tab, and the page is served with a policy that blocks outbound connections.',

  'error.unsupported': 'Cannot read {name} — supported formats are {formats}.',
  'error.parse': 'Could not open {name}. The file may be damaged.',
  'error.empty': '{name} contains no readable text.',
  'error.speech': 'Playback failed: {message}',
  'error.noVoices':
    'No local voice is available. Build the image with a neural voice, or install a system voice in your operating system.',
  'error.dismiss': 'Dismiss',

  'shortcuts.title': 'Keyboard',
  'shortcuts.playPause': 'Space — play or pause',
  'shortcuts.skip': '← → — previous or next sentence',
  'shortcuts.speed': '− + — slower or faster',
  'shortcuts.click': 'Click any word to start reading there',
} as const;

export type MessageKey = keyof typeof en;

/**
 * German typography per Duden: the Gedankenstrich is a spaced en dash, never an
 * em dash.
 */
const de: Record<MessageKey, string> = {
  'app.name': 'Papierlaut',
  'app.tagline': 'Liest Ihre Dokumente vor – vollständig auf diesem Gerät',

  'drop.headline': 'Dokument hierher ziehen',
  'drop.hint': 'oder Datei auswählen – es wird nichts hochgeladen',
  'drop.button': 'Datei auswählen',
  'drop.formats': 'Word (.docx), Markdown (.md), HTML (.html), Text (.txt)',
  'drop.release': 'Loslassen zum Öffnen',

  'toolbar.play': 'Vorlesen',
  'toolbar.pause': 'Pause',
  'toolbar.stop': 'Stopp',
  'toolbar.previous': 'Vorheriger Satz',
  'toolbar.next': 'Nächster Satz',
  'toolbar.voice': 'Stimme',
  'toolbar.speed': 'Tempo',
  'toolbar.volume': 'Lautstärke',
  'toolbar.follow': 'Mitlaufen',
  'toolbar.close': 'Dokument schließen',
  'toolbar.uiLanguage': 'Sprache der Oberfläche',

  'voices.neural': 'Natürliche Stimmen (lokal)',
  'voices.system': 'Systemstimmen (lokal)',
  'voices.none': 'Keine Offline-Stimme verfügbar',

  'status.idle': 'Bereit',
  'status.preparing': 'Wird vorbereitet…',
  'status.playing': 'Liest vor',
  'status.paused': 'Pausiert',
  'status.finished': 'Fertig',
  'status.loadingVoice': 'Stimme wird geladen… {percent} %',
  'status.parsing': '{name} wird geöffnet…',
  'status.sentence': 'Satz {current} von {total}',
  'status.words': '{count} Wörter',

  'privacy.badge': 'Offline',
  'privacy.detail':
    'Ihr Text verlässt dieses Gerät nicht. Die Sprachausgabe entsteht in diesem Tab, und die Seite wird mit einer Richtlinie ausgeliefert, die ausgehende Verbindungen blockiert.',

  'error.unsupported': '{name} kann nicht gelesen werden – unterstützt werden {formats}.',
  'error.parse': '{name} konnte nicht geöffnet werden. Die Datei ist möglicherweise beschädigt.',
  'error.empty': '{name} enthält keinen lesbaren Text.',
  'error.speech': 'Wiedergabe fehlgeschlagen: {message}',
  'error.noVoices':
    'Es ist keine lokale Stimme verfügbar. Bauen Sie das Image mit einer neuronalen Stimme, oder installieren Sie eine Systemstimme in Ihrem Betriebssystem.',
  'error.dismiss': 'Schließen',

  'shortcuts.title': 'Tastatur',
  'shortcuts.playPause': 'Leertaste – vorlesen oder pausieren',
  'shortcuts.skip': '← → – vorheriger oder nächster Satz',
  'shortcuts.speed': '− + – langsamer oder schneller',
  'shortcuts.click': 'Auf ein Wort klicken, um dort zu beginnen',
};

const DICTIONARIES: Record<UiLocale, Record<MessageKey, string>> = { en, de };

export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function createTranslator(locale: UiLocale): Translate {
  const dictionary = DICTIONARIES[locale];
  return (key, values) => {
    const template = dictionary[key];
    if (!values) return template;
    return template.replaceAll(/\{(\w+)\}/g, (match, name: string) =>
      name in values ? String(values[name]) : match,
    );
  };
}

export function preferredUiLocale(): UiLocale {
  return globalThis.navigator?.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

/**
 * Fills every `data-i18n*` slot in a subtree. Keeping the markup declarative
 * means a language switch is one call and cannot miss an element.
 */
export function applyTranslations(root: ParentNode, t: Translate): void {
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n as MessageKey);
  }
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n-label]')) {
    element.setAttribute('aria-label', t(element.dataset.i18nLabel as MessageKey));
  }
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    element.title = t(element.dataset.i18nTitle as MessageKey);
  }
}
