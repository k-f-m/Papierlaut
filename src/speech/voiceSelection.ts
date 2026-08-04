import type { SupportedLanguage } from '../reading/detectLanguage.ts';
import type { Voice } from './types.ts';

/**
 * Picks the voice to read a document with.
 *
 * Order of preference, and the reasoning behind it:
 *  1. the voice the user last chose, if it still fits the document's language —
 *     an explicit choice outranks any heuristic;
 *  2. a neural voice in the document's language — the reason this app exists;
 *  3. any voice in the document's language — a robotic German voice still beats
 *     an English voice reading German;
 *  4. the previous choice regardless of language, then anything at all.
 */
export function chooseVoice(
  voices: readonly Voice[],
  language: SupportedLanguage,
  preferredId: string | null,
): Voice | undefined {
  if (voices.length === 0) return undefined;

  const preferred = preferredId ? voices.find((voice) => voice.id === preferredId) : undefined;
  if (preferred?.language === language) return preferred;

  const matching = voices.filter((voice) => voice.language === language);
  return (
    matching.find((voice) => voice.engine === 'piper') ??
    matching[0] ??
    preferred ??
    voices.find((voice) => voice.engine === 'piper') ??
    voices[0]
  );
}
