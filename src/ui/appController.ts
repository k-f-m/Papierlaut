import { ReadingSession } from '../app/readingSession.ts';
import { UnsupportedFormatError } from '../documents/types.ts';
import { buildReadingModel } from '../reading/buildReadingModel.ts';
import { detectLanguage } from '../reading/detectLanguage.ts';
import { Highlighter } from '../reading/highlighter.ts';
import { applyTranslations, createTranslator } from './i18n.ts';
import { chooseVoice } from '../speech/voiceSelection.ts';
import { element, isEditingContext, setHidden } from './dom.ts';
import { sanitizeDocumentHtml } from '../documents/sanitize.ts';
import type { DocumentParserRegistry } from '../documents/parserRegistry.ts';
import type { ReadingModel } from '../reading/types.ts';
import type { PlaybackState, SessionSnapshot } from '../app/readingSession.ts';
import type { SettingsStore } from './settings.ts';
import type { SpeechEngine, Voice } from '../speech/types.ts';
import type { MessageKey, Translate, UiLocale } from './i18n.ts';

const STATUS_KEYS: Record<PlaybackState, MessageKey> = {
  idle: 'status.idle',
  preparing: 'status.preparing',
  playing: 'status.playing',
  paused: 'status.paused',
  finished: 'status.finished',
};

export interface AppDependencies {
  readonly parsers: DocumentParserRegistry;
  /** In preference order; the first engine offering a matching voice wins. */
  readonly engines: readonly SpeechEngine[];
  readonly settings: SettingsStore;
}

const RATE_STEP = 0.05;
const RATE_MIN = 0.5;
const RATE_MAX = 2;

/**
 * Wires the DOM to the reading session.
 *
 * Everything below the UI is injected, so this class holds only presentation
 * concerns: what to show, what a click means, and which preference to persist.
 */
export class AppController {
  readonly #deps: AppDependencies;
  readonly #ui = {
    dropzone: element<HTMLElement>('dropzone'),
    fileInput: element<HTMLInputElement>('file-input'),
    chooseFile: element<HTMLButtonElement>('choose-file'),
    reader: element<HTMLElement>('reader'),
    article: element<HTMLElement>('document'),
    play: element<HTMLButtonElement>('play'),
    previous: element<HTMLButtonElement>('previous'),
    next: element<HTMLButtonElement>('next'),
    stop: element<HTMLButtonElement>('stop'),
    voice: element<HTMLSelectElement>('voice'),
    rate: element<HTMLInputElement>('rate'),
    rateValue: element<HTMLOutputElement>('rate-value'),
    volume: element<HTMLInputElement>('volume'),
    follow: element<HTMLInputElement>('follow'),
    status: element<HTMLElement>('status'),
    position: element<HTMLElement>('position'),
    progress: element<HTMLElement>('progress'),
    closeDocument: element<HTMLButtonElement>('close-document'),
    uiLanguage: element<HTMLSelectElement>('ui-language'),
    toast: element<HTMLElement>('toast'),
    toastMessage: element<HTMLElement>('toast-message'),
    toastDismiss: element<HTMLButtonElement>('toast-dismiss'),
  };

  #t: Translate;
  #highlighter: Highlighter;
  #session: ReadingSession | undefined;
  #model: ReadingModel | undefined;
  #voices: Voice[] = [];
  #voice: Voice | undefined;
  #dragDepth = 0;
  #statusOverride: string | undefined;

  constructor(dependencies: AppDependencies) {
    this.#deps = dependencies;
    this.#t = createTranslator(dependencies.settings.load().uiLocale);
    this.#highlighter = new Highlighter(this.#ui.article, {
      follow: dependencies.settings.load().follow,
      anchor: 0.38,
    });
  }

  async start(): Promise<void> {
    const settings = this.#deps.settings.load();
    this.#ui.fileInput.accept = this.#deps.parsers.acceptAttribute;
    this.#ui.rate.value = String(settings.rate);
    this.#ui.volume.value = String(settings.volume);
    this.#ui.follow.checked = settings.follow;
    this.#ui.uiLanguage.value = settings.uiLocale;
    this.#applyLocale(settings.uiLocale);
    this.#renderRate(settings.rate);

    this.#bindFileInput();
    this.#bindDragAndDrop();
    this.#bindTransport();
    this.#bindKeyboard();

    await this.#loadVoices();
  }

  // --- Voices --------------------------------------------------------------

  async #loadVoices(): Promise<void> {
    const found: Voice[] = [];
    for (const engine of this.#deps.engines) {
      try {
        if (await engine.isAvailable()) found.push(...(await engine.listVoices()));
      } catch {
        // One unavailable engine must not take the other down with it.
      }
    }
    this.#voices = found;
    this.#renderVoiceOptions();
    if (found.length === 0) this.#showError(this.#t('error.noVoices'));
  }

  #renderVoiceOptions(): void {
    const select = this.#ui.voice;
    select.replaceChildren();

    if (this.#voices.length === 0) {
      const empty = new Option(this.#t('voices.none'), '');
      empty.disabled = true;
      select.append(empty);
      select.disabled = true;
      return;
    }

    select.disabled = false;
    for (const [engineId, label] of [
      ['piper', this.#t('voices.neural')],
      ['system', this.#t('voices.system')],
    ] as const) {
      const voices = this.#voices.filter((voice) => voice.engine === engineId);
      if (voices.length === 0) continue;

      const group = document.createElement('optgroup');
      group.label = label;
      for (const voice of voices) {
        const option = new Option(`${voice.label} · ${voice.lang}`, voice.id);
        option.selected = voice.id === this.#voice?.id;
        if (voice.description) option.title = voice.description;
        group.append(option);
      }
      select.append(group);
    }
  }

  #engineFor(voice: Voice): SpeechEngine {
    const engine = this.#deps.engines.find((candidate) => candidate.id === voice.engine);
    if (!engine) throw new Error(`No engine registered for ${voice.engine}`);
    return engine;
  }

  /**
   * Loads the model before the first sentence is requested, so the download
   * shows as progress instead of as an unexplained pause after pressing play.
   */
  async #prepareVoice(voice: Voice): Promise<void> {
    if (!voice.requiresLoading) return;
    try {
      await this.#engineFor(voice).load(voice, ({ loaded, total }) => {
        const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
        this.#statusOverride = this.#t('status.loadingVoice', { percent });
        this.#renderStatus();
      });
    } finally {
      this.#statusOverride = undefined;
      this.#renderStatus();
    }
  }

  // --- Documents -----------------------------------------------------------

  async #openFile(file: File): Promise<void> {
    this.#session?.stop();
    this.#statusOverride = this.#t('status.parsing', { name: file.name });
    this.#renderStatus();

    try {
      const parsed = await this.#deps.parsers.parse(file);

      // Sanitise before anything touches the live DOM: the markup came from an
      // untrusted file, and this is the only boundary it crosses.
      this.#ui.article.innerHTML = sanitizeDocumentHtml(parsed.html);

      const probe = this.#ui.article.textContent ?? '';
      if (probe.trim().length === 0) {
        this.#showError(this.#t('error.empty', { name: file.name }));
        this.#reset();
        return;
      }

      const { language } = detectLanguage(probe);
      const model = buildReadingModel(this.#ui.article, language);
      this.#model = model;
      this.#ui.article.lang = model.locale;
      this.#highlighter.attach(model);

      document.title = `${parsed.title} — ${this.#t('app.name')}`;

      const settings = this.#deps.settings.load();
      const voice = chooseVoice(this.#voices, language, settings.voiceId);
      this.#voice = voice;
      this.#renderVoiceOptions();

      setHidden(this.#ui.dropzone, true);
      setHidden(this.#ui.reader, false);
      setHidden(this.#ui.closeDocument, false);

      if (!voice) {
        this.#showError(this.#t('error.noVoices'));
      } else {
        this.#session = this.#createSession(model, voice, settings.rate, settings.volume);
        await this.#prepareVoice(voice);
      }

      this.#renderSnapshot(this.#session?.snapshot);
      this.#ui.article.focus({ preventScroll: true });
    } catch (error) {
      if (error instanceof UnsupportedFormatError) {
        this.#showError(
          this.#t('error.unsupported', {
            name: file.name,
            formats: this.#deps.parsers.supportedExtensions.join(', '),
          }),
        );
      } else {
        this.#showError(this.#t('error.parse', { name: file.name }));
        console.error(error);
      }
      this.#reset();
    } finally {
      this.#statusOverride = undefined;
      this.#renderStatus();
    }
  }

  #createSession(model: ReadingModel, voice: Voice, rate: number, volume: number): ReadingSession {
    return new ReadingSession(
      model,
      this.#engineFor(voice),
      voice,
      this.#highlighter,
      { rate, volume },
      {
        onChange: (snapshot) => this.#renderSnapshot(snapshot),
        onError: (error) => this.#showError(this.#t('error.speech', { message: error.message })),
      },
    );
  }

  #reset(): void {
    this.#session?.stop();
    this.#session = undefined;
    this.#model = undefined;
    this.#highlighter.clear();
    this.#ui.article.replaceChildren();
    setHidden(this.#ui.reader, true);
    setHidden(this.#ui.dropzone, false);
    setHidden(this.#ui.closeDocument, true);
    document.title = this.#t('app.name');
    this.#renderSnapshot(undefined);
  }

  // --- Bindings ------------------------------------------------------------

  #bindFileInput(): void {
    this.#ui.chooseFile.addEventListener('click', () => this.#ui.fileInput.click());
    this.#ui.fileInput.addEventListener('change', () => {
      const file = this.#ui.fileInput.files?.[0];
      if (file) void this.#openFile(file);
      // Reset so re-picking the same file fires `change` again.
      this.#ui.fileInput.value = '';
    });
  }

  /**
   * Drag events fire for every element entered, so a plain enter/leave pair
   * flickers over child nodes. Counting depth keeps the highlight steady.
   */
  #bindDragAndDrop(): void {
    const zone = this.#ui.dropzone;

    const allowDrop = (event: DragEvent): void => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      zone.classList.add('is-dragging');
    };

    window.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      this.#dragDepth += 1;
      allowDrop(event);
    });

    window.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return;
      allowDrop(event);
    });

    window.addEventListener('dragleave', (event) => {
      if (!hasFiles(event)) return;
      this.#dragDepth = Math.max(0, this.#dragDepth - 1);
      if (this.#dragDepth === 0) zone.classList.remove('is-dragging');
    });

    window.addEventListener('drop', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      this.#dragDepth = 0;
      zone.classList.remove('is-dragging');
      const file = event.dataTransfer?.files?.[0];
      if (file) void this.#openFile(file);
    });
  }

  #bindTransport(): void {
    this.#ui.play.addEventListener('click', () => this.#session?.toggle());
    this.#ui.stop.addEventListener('click', () => this.#session?.stop());
    this.#ui.previous.addEventListener('click', () => this.#session?.skip(-1));
    this.#ui.next.addEventListener('click', () => this.#session?.skip(1));
    this.#ui.closeDocument.addEventListener('click', () => this.#reset());

    this.#ui.rate.addEventListener('input', () => {
      const rate = Number(this.#ui.rate.value);
      this.#renderRate(rate);
      this.#session?.setRate(rate);
      this.#deps.settings.save({ rate });
    });

    this.#ui.volume.addEventListener('input', () => {
      const volume = Number(this.#ui.volume.value);
      this.#session?.setVolume(volume);
      this.#deps.settings.save({ volume });
    });

    this.#ui.follow.addEventListener('change', () => {
      const follow = this.#ui.follow.checked;
      this.#highlighter.setOptions({ follow });
      this.#deps.settings.save({ follow });
    });

    this.#ui.voice.addEventListener('change', () => {
      const voice = this.#voices.find((candidate) => candidate.id === this.#ui.voice.value);
      if (!voice) return;
      this.#voice = voice;
      this.#deps.settings.save({ voiceId: voice.id });
      this.#session?.setVoice(this.#engineFor(voice), voice);
      void this.#prepareVoice(voice);
    });

    this.#ui.uiLanguage.addEventListener('change', () => {
      const locale = this.#ui.uiLanguage.value === 'de' ? 'de' : 'en';
      this.#deps.settings.save({ uiLocale: locale });
      this.#applyLocale(locale);
      this.#renderVoiceOptions();
      this.#renderSnapshot(this.#session?.snapshot);
    });

    this.#ui.toastDismiss.addEventListener('click', () => setHidden(this.#ui.toast, true));

    // Clicking a word is the fastest way to say "read from here".
    this.#ui.article.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-w]');
      const index = target?.dataset.w;
      if (index === undefined) return;
      this.#session?.jumpToWord(Number(index));
      this.#session?.play();
    });
  }

  #bindKeyboard(): void {
    window.addEventListener('keydown', (event) => {
      if (!this.#session || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditingContext(event.target)) return;

      switch (event.key) {
        case ' ':
          event.preventDefault();
          this.#session.toggle();
          break;
        case 'ArrowRight':
          event.preventDefault();
          this.#session.skip(1);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          this.#session.skip(-1);
          break;
        case 'Escape':
          this.#session.stop();
          break;
        case '+':
        case '=':
          this.#nudgeRate(RATE_STEP);
          break;
        case '-':
        case '_':
          this.#nudgeRate(-RATE_STEP);
          break;
        default:
          break;
      }
    });
  }

  #nudgeRate(delta: number): void {
    const rate = Math.round(
      Math.min(Math.max(Number(this.#ui.rate.value) + delta, RATE_MIN), RATE_MAX) * 100,
    ) / 100;
    this.#ui.rate.value = String(rate);
    this.#renderRate(rate);
    this.#session?.setRate(rate);
    this.#deps.settings.save({ rate });
  }

  // --- Rendering -----------------------------------------------------------

  #applyLocale(locale: UiLocale): void {
    this.#t = createTranslator(locale);
    document.documentElement.lang = locale;
    applyTranslations(document, this.#t);
  }

  #renderRate(rate: number): void {
    this.#ui.rateValue.textContent = `${rate.toFixed(2).replace(/0$/, '')}×`;
  }

  #renderSnapshot(snapshot: SessionSnapshot | undefined): void {
    const playing = snapshot?.state === 'playing';
    this.#ui.play.querySelector('.icon-play')?.toggleAttribute('hidden', playing);
    this.#ui.play.querySelector('.icon-pause')?.toggleAttribute('hidden', !playing);
    this.#ui.play.setAttribute(
      'aria-label',
      this.#t(playing ? 'toolbar.pause' : 'toolbar.play'),
    );

    const disabled = !snapshot || snapshot.sentenceCount === 0;
    for (const button of [this.#ui.play, this.#ui.previous, this.#ui.next, this.#ui.stop]) {
      button.disabled = disabled;
    }

    this.#ui.progress.style.width = `${((snapshot?.progress ?? 0) * 100).toFixed(1)}%`;

    if (snapshot && snapshot.sentenceCount > 0) {
      const words = this.#model?.words.length ?? 0;
      this.#ui.position.textContent = `${this.#t('status.sentence', {
        current: snapshot.sentence + 1,
        total: snapshot.sentenceCount,
      })} · ${this.#t('status.words', { count: words.toLocaleString() })}`;
    } else {
      this.#ui.position.textContent = '';
    }

    this.#renderStatus(snapshot);
  }

  #renderStatus(snapshot: SessionSnapshot | undefined = this.#session?.snapshot): void {
    if (this.#statusOverride) {
      this.#ui.status.textContent = this.#statusOverride;
      return;
    }
    this.#ui.status.textContent = this.#t(STATUS_KEYS[snapshot?.state ?? 'idle']);
  }

  #showError(message: string): void {
    this.#ui.toastMessage.textContent = message;
    setHidden(this.#ui.toast, false);
  }
}

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}
