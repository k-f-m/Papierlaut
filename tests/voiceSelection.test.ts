import { describe, expect, it } from 'vitest';
import { chooseVoice } from '../src/speech/voiceSelection.ts';
import type { Voice } from '../src/speech/types.ts';

const voice = (id: string, engine: Voice['engine'], language: Voice['language']): Voice => ({
  id,
  engine,
  label: id,
  lang: language === 'de' ? 'de-DE' : 'en-US',
  language,
  requiresLoading: engine === 'piper',
});

const NEURAL_DE = voice('de_DE-thorsten-medium', 'piper', 'de');
const NEURAL_EN = voice('en_US-lessac-medium', 'piper', 'en');
const SYSTEM_DE = voice('system:Hedda', 'system', 'de');
const SYSTEM_EN = voice('system:Zira', 'system', 'en');

describe('chooseVoice', () => {
  it('prefers a neural voice in the document language', () => {
    expect(chooseVoice([SYSTEM_DE, NEURAL_DE, NEURAL_EN], 'de', null)).toBe(NEURAL_DE);
  });

  it('honours an explicit earlier choice when the language still fits', () => {
    expect(chooseVoice([NEURAL_DE, SYSTEM_DE], 'de', SYSTEM_DE.id)).toBe(SYSTEM_DE);
  });

  it('overrides an earlier choice that speaks the wrong language', () => {
    expect(chooseVoice([NEURAL_DE, NEURAL_EN], 'de', NEURAL_EN.id)).toBe(NEURAL_DE);
  });

  it('takes a system voice in the right language over a neural voice in the wrong one', () => {
    expect(chooseVoice([NEURAL_EN, SYSTEM_DE], 'de', null)).toBe(SYSTEM_DE);
  });

  it('falls back to any voice when none matches the language', () => {
    expect(chooseVoice([SYSTEM_EN], 'de', null)).toBe(SYSTEM_EN);
  });

  it('returns nothing when no voice is installed', () => {
    expect(chooseVoice([], 'de', null)).toBeUndefined();
  });
});
