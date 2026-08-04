import type { SupportedLanguage } from '../reading/detectLanguage.ts';
import type { UtteranceWord } from '../reading/types.ts';

export type EngineId = 'piper' | 'system';

export interface Voice {
  /** Unique across engines. */
  readonly id: string;
  readonly engine: EngineId;
  readonly label: string;
  /** BCP-47 tag, e.g. `de-DE`. */
  readonly lang: string;
  readonly language: SupportedLanguage;
  readonly description?: string;
  /** True when the voice needs a one-off local model load before first use. */
  readonly requiresLoading: boolean;
}

export interface SpeakRequest {
  readonly text: string;
  readonly voice: Voice;
  readonly words: readonly UtteranceWord[];
  /** 1 = the voice's natural pace. */
  readonly rate: number;
  readonly volume: number;
}

/**
 * Reports the word currently being spoken as an index into
 * `SpeakRequest.words`, or -1 while no word is active.
 */
export type WordCallback = (wordIndex: number) => void;

/** A single utterance in flight. Every method must be safe to call in any state. */
export interface Utterance {
  /** Resolves when playback completes, rejects if synthesis or playback fails. */
  readonly done: Promise<void>;
  pause(): void;
  resume(): void;
  cancel(): void;
  /** Applies a new rate mid-utterance. Returns false if the engine cannot. */
  setRate(rate: number): boolean;
}

export interface LoadProgress {
  readonly loaded: number;
  readonly total: number;
}

export interface SpeechEngine {
  readonly id: EngineId;
  /** Whether this engine can run at all in the current browser/deployment. */
  isAvailable(): Promise<boolean>;
  listVoices(): Promise<Voice[]>;
  /** Loads whatever the voice needs before it can speak. Idempotent. */
  load(voice: Voice, onProgress?: (progress: LoadProgress) => void): Promise<void>;
  speak(request: SpeakRequest, onWord: WordCallback): Utterance;
}

/**
 * Engines that can synthesise ahead of time. Kept separate from `SpeechEngine`
 * so the session does not have to pretend the system voice supports it.
 */
export interface PrewarmingEngine {
  prewarm(request: Omit<SpeakRequest, 'rate' | 'volume'>): void;
}

export function supportsPrewarm(engine: SpeechEngine): engine is SpeechEngine & PrewarmingEngine {
  return typeof (engine as Partial<PrewarmingEngine>).prewarm === 'function';
}

export class SpeechCancelledError extends Error {
  constructor() {
    super('Utterance cancelled');
    this.name = 'SpeechCancelledError';
  }
}

export function isCancellation(error: unknown): boolean {
  return error instanceof SpeechCancelledError;
}
