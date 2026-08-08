import type { SupportedLanguage } from '../reading/detectLanguage.ts';
import type { LoadProgress } from '../types/progress.ts';

export type TranslatorId = 'builtin' | 'bergamot';

export interface LanguagePair {
  readonly from: SupportedLanguage;
  readonly to: SupportedLanguage;
}

/**
 * A local machine-translation backend. Deliberately shaped like `SpeechEngine`:
 * the app picks whichever implementation the browser and deployment can support
 * and never learns which one it got.
 *
 * `translate` takes a batch because a round trip per sentence dominates the cost
 * of translating a document.
 */
export interface TranslationEngine {
  readonly id: TranslatorId;
  /** Whether this engine can translate this pair in the current browser. */
  isAvailable(pair: LanguagePair): Promise<boolean>;
  /** Loads whatever the pair needs before first use. Idempotent. */
  load(pair: LanguagePair, onProgress?: (progress: LoadProgress) => void): Promise<void>;
  /** Resolves to one translation per input, in the same order. */
  translate(texts: readonly string[], pair: LanguagePair): Promise<string[]>;
}
