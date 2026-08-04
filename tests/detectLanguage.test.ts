import { describe, expect, it } from 'vitest';
import { detectLanguage, localeFor } from '../src/reading/detectLanguage.ts';

const GERMAN = `Die Bedienungsanleitung beschreibt, wie das Gerät in Betrieb genommen wird.
Bevor Sie beginnen, lesen Sie bitte die Sicherheitshinweise. Wenn ein Fehler auftritt,
wenden Sie sich an den Support. Das Gerät darf nur mit dem mitgelieferten Netzteil
betrieben werden, und es ist nicht für den Einsatz im Freien vorgesehen.`;

const ENGLISH = `This document describes how the device is put into operation. Before you begin,
please read the safety instructions. If an error occurs, contact support. The device may
only be operated with the supplied power adapter, and it is not intended for outdoor use.`;

describe('detectLanguage', () => {
  it('recognises German prose', () => {
    const result = detectLanguage(GERMAN);
    expect(result.language).toBe('de');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('recognises English prose', () => {
    const result = detectLanguage(ENGLISH);
    expect(result.language).toBe('en');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('is not fooled by German loanwords in an English text', () => {
    expect(detectLanguage(`${ENGLISH} The Zeitgeist of the Kindergarten era.`).language).toBe('en');
  });

  it('is not fooled by a single English term in a German text', () => {
    expect(detectLanguage(`${GERMAN} Das Management-Team hat ein Update.`).language).toBe('de');
  });

  it('falls back when there is nothing to go on', () => {
    expect(detectLanguage('', 'de')).toEqual({ language: 'de', confidence: 0 });
    expect(detectLanguage('1234 5678 —', 'en').language).toBe('en');
  });

  it('reports low confidence for a genuinely mixed text', () => {
    expect(detectLanguage('Das ist the Text with und mixed words.').confidence).toBeLessThan(0.4);
  });
});

describe('localeFor', () => {
  it('maps to BCP-47 tags the speech engines understand', () => {
    expect(localeFor('de')).toBe('de-DE');
    expect(localeFor('en')).toBe('en-US');
  });
});
