import { WordScheduler } from './wordScheduler.ts';
import { SpeechCancelledError } from './types.ts';
import { estimateWordTimings } from './wordTiming.ts';
import type {
  LoadProgress,
  SpeakRequest,
  SpeechEngine,
  Utterance,
  Voice,
  WordCallback,
} from './types.ts';
import type { SupportedLanguage } from '../reading/detectLanguage.ts';

/**
 * The browser's own Web Speech API — no download, instant start.
 *
 * Critically, only voices reporting `localService === true` are offered. The
 * pleasant-sounding ones in Chrome and Edge ("Google Deutsch", "Microsoft …
 * Online") synthesise on a vendor server, which means the utterance text leaves
 * the machine. Those are filtered out here rather than merely discouraged,
 * because a Content-Security-Policy cannot block them: speech synthesis does not
 * go through the page's network stack.
 */
export class SystemVoiceEngine implements SpeechEngine {
  readonly id = 'system' as const;

  async isAvailable(): Promise<boolean> {
    if (typeof globalThis.speechSynthesis === 'undefined') return false;
    return (await this.listVoices()).length > 0;
  }

  async listVoices(): Promise<Voice[]> {
    const voices = await loadSystemVoices();
    return voices
      .filter((voice) => voice.localService)
      .map(toVoice)
      .filter((voice): voice is Voice => voice !== undefined)
      .sort((a, b) => a.language.localeCompare(b.language) || a.label.localeCompare(b.label));
  }

  async load(_voice: Voice, onProgress?: (progress: LoadProgress) => void): Promise<void> {
    // System voices are already installed; report completion so callers can
    // treat both engines identically.
    onProgress?.({ loaded: 1, total: 1 });
  }

  speak(request: SpeakRequest, onWord: WordCallback): Utterance {
    return new SystemUtterance(request, onWord);
  }
}

/**
 * `getVoices()` is empty until the voice list has loaded, and Chrome only fires
 * `voiceschanged` once. The timeout keeps a browser that never fires it (or
 * genuinely has no voices) from hanging the engine probe.
 */
function loadSystemVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  const synthesis = globalThis.speechSynthesis;
  if (!synthesis) return Promise.resolve([]);

  const immediate = synthesis.getVoices();
  if (immediate.length > 0) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    const settle = (): void => {
      clearTimeout(timer);
      synthesis.removeEventListener('voiceschanged', settle);
      resolve(synthesis.getVoices());
    };
    const timer = setTimeout(settle, timeoutMs);
    synthesis.addEventListener('voiceschanged', settle);
  });
}

function toVoice(voice: SpeechSynthesisVoice): Voice | undefined {
  const language = languageOf(voice.lang);
  if (!language) return undefined;
  return {
    id: `system:${voice.voiceURI}`,
    engine: 'system',
    label: voice.name,
    lang: voice.lang,
    language,
    description: 'System voice',
    requiresLoading: false,
  };
}

function languageOf(tag: string): SupportedLanguage | undefined {
  const primary = tag.toLowerCase().split(/[-_]/)[0];
  if (primary === 'de') return 'de';
  if (primary === 'en') return 'en';
  return undefined;
}

/**
 * Chrome silently stops long utterances after roughly 15 seconds unless the
 * synthesiser is nudged. Sentences are short enough that this rarely bites, but
 * a slow rate on a long sentence gets there.
 */
const KEEPALIVE_INTERVAL_MS = 8000;
/** If no boundary event has arrived by now, this browser does not send them. */
const BOUNDARY_GRACE_MS = 600;
/** Rough syllable-weight throughput used only to fake timings on such browsers. */
const WEIGHT_PER_SECOND = 6;

class SystemUtterance implements Utterance {
  readonly done: Promise<void>;

  readonly #request: SpeakRequest;
  readonly #onWord: WordCallback;
  /** Held so the utterance is not garbage collected mid-speech, a known Chrome bug. */
  readonly #utterance: SpeechSynthesisUtterance;

  #scheduler: WordScheduler | undefined;
  #keepalive: ReturnType<typeof setInterval> | undefined;
  #boundaryProbe: ReturnType<typeof setTimeout> | undefined;
  #settle: ((error?: Error) => void) | undefined;
  #sawBoundary = false;
  #elapsedBeforePause = 0;
  #startedAt = 0;
  #paused = false;

  constructor(request: SpeakRequest, onWord: WordCallback) {
    this.#request = request;
    this.#onWord = onWord;

    const utterance = new SpeechSynthesisUtterance(request.text);
    utterance.lang = request.voice.lang;
    utterance.rate = clampRate(request.rate);
    utterance.volume = request.volume;
    const native = findNativeVoice(request.voice.id);
    if (native) utterance.voice = native;
    this.#utterance = utterance;

    this.done = new Promise<void>((resolve, reject) => {
      this.#settle = (error) => {
        this.#settle = undefined;
        this.#cleanup();
        if (error) reject(error);
        else resolve();
      };

      utterance.onstart = () => {
        this.#startedAt = performance.now();
        this.#keepalive = setInterval(() => {
          if (!this.#paused) globalThis.speechSynthesis.resume();
        }, KEEPALIVE_INTERVAL_MS);
        this.#boundaryProbe = setTimeout(() => this.#startEstimatedTimings(), BOUNDARY_GRACE_MS);
      };

      utterance.onboundary = (event) => {
        if (event.name && event.name !== 'word') return;
        this.#sawBoundary = true;
        this.#stopEstimation();
        this.#onWord(wordIndexForCharacter(this.#request.words, event.charIndex));
      };

      utterance.onend = () => this.#settle?.();

      utterance.onerror = (event) => {
        // "interrupted" and "canceled" are how a deliberate stop surfaces.
        const cancelled = event.error === 'interrupted' || event.error === 'canceled';
        this.#settle?.(cancelled ? new SpeechCancelledError() : new Error(`Speech synthesis failed: ${event.error}`));
      };
    });

    globalThis.speechSynthesis.speak(utterance);
  }

  pause(): void {
    if (this.#paused) return;
    this.#paused = true;
    this.#elapsedBeforePause += (performance.now() - this.#startedAt) / 1000;
    globalThis.speechSynthesis.pause();
  }

  resume(): void {
    if (!this.#paused) return;
    this.#paused = false;
    this.#startedAt = performance.now();
    globalThis.speechSynthesis.resume();
  }

  cancel(): void {
    // Settle immediately instead of waiting for an `interrupted` error that not
    // every browser delivers; the late event then finds nothing left to settle.
    this.#settle?.(new SpeechCancelledError());
    globalThis.speechSynthesis.cancel();
  }

  /** The Web Speech API fixes the rate when the utterance starts. */
  setRate(): boolean {
    return false;
  }

  /**
   * Safari and some Android builds never fire word boundaries. Rather than
   * leave the highlight frozen on the first word, fall back to the same
   * estimator the neural engine uses, against a predicted duration.
   */
  #startEstimatedTimings(): void {
    if (this.#sawBoundary || this.#scheduler) return;
    const words = this.#request.words;
    if (words.length === 0) return;

    const weight = words.reduce((sum, word) => sum + word.text.length / 3 + 1, 0);
    const duration = weight / (WEIGHT_PER_SECOND * clampRate(this.#request.rate));
    const timings = estimateWordTimings(words, duration);

    this.#scheduler = new WordScheduler(timings, this.#onWord);
    this.#scheduler.start(() => this.#elapsedSeconds());
  }

  #elapsedSeconds(): number {
    if (this.#paused) return this.#elapsedBeforePause;
    return this.#elapsedBeforePause + (performance.now() - this.#startedAt) / 1000;
  }

  #stopEstimation(): void {
    clearTimeout(this.#boundaryProbe);
    this.#boundaryProbe = undefined;
    this.#scheduler?.stop();
    this.#scheduler = undefined;
  }

  #cleanup(): void {
    clearInterval(this.#keepalive);
    this.#keepalive = undefined;
    this.#stopEstimation();
    this.#utterance.onboundary = null;
  }
}

function clampRate(rate: number): number {
  return Math.min(Math.max(rate, 0.1), 10);
}

function findNativeVoice(id: string): SpeechSynthesisVoice | undefined {
  const uri = id.startsWith('system:') ? id.slice('system:'.length) : id;
  return globalThis.speechSynthesis?.getVoices().find((voice) => voice.voiceURI === uri);
}

/** Maps a character offset from a boundary event onto a word index. */
export function wordIndexForCharacter(
  words: readonly { start: number; end: number }[],
  charIndex: number,
): number {
  if (words.length === 0) return -1;

  let low = 0;
  let high = words.length - 1;
  let candidate = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const word = words[mid] as { start: number; end: number };
    if (word.start > charIndex) {
      high = mid - 1;
    } else {
      candidate = mid;
      if (word.end > charIndex) break;
      low = mid + 1;
    }
  }
  return candidate;
}
