export type SupportedLanguage = 'de' | 'en';

export interface LanguageGuess {
  readonly language: SupportedLanguage;
  /** 0 = coin flip, 1 = unambiguous. Below ~0.15 the UI offers a manual choice. */
  readonly confidence: number;
}

/**
 * Function words carry the signal: they are frequent, short and almost never
 * shared between the two languages. Content words are deliberately excluded —
 * a German text about "Management" should not drift towards English.
 */
const GERMAN_MARKERS = new Set([
  'aber', 'alle', 'als', 'am', 'auch', 'auf', 'aus', 'bei', 'bin', 'bis', 'da', 'damit', 'dann',
  'das', 'dass', 'dem', 'den', 'der', 'des', 'die', 'diese', 'diesem', 'diesen', 'dieser', 'doch',
  'dort', 'du', 'durch', 'ein', 'eine', 'einem', 'einen', 'einer', 'eines', 'er', 'es', 'etwa',
  'für', 'gegen', 'haben', 'hat', 'hatte', 'ich', 'ihr', 'im', 'immer', 'in', 'ist', 'ja', 'kann',
  'kein', 'können', 'mehr', 'mit', 'muss', 'nach', 'nicht', 'noch', 'nun', 'nur', 'ob', 'oder',
  'ohne', 'schon', 'sehr', 'sein', 'seine', 'sich', 'sie', 'sind', 'so', 'über', 'um', 'und',
  'uns', 'unter', 'viel', 'vom', 'von', 'vor', 'war', 'waren', 'was', 'wenn', 'werden', 'wie',
  'wir', 'wird', 'wurde', 'zu', 'zum', 'zur', 'zwischen',
]);

const ENGLISH_MARKERS = new Set([
  'a', 'about', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'because',
  'been', 'but', 'by', 'can', 'could', 'do', 'does', 'each', 'for', 'from', 'had', 'has', 'have',
  'he', 'her', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'may', 'more',
  'most', 'must', 'my', 'no', 'not', 'of', 'on', 'one', 'only', 'or', 'other', 'our', 'out',
  'over', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'those', 'through', 'to', 'up', 'was', 'we', 'were', 'what',
  'when', 'which', 'who', 'will', 'with', 'would', 'you', 'your',
]);

/** ß and umlauts do not occur in English; capitalised nouns are a weaker hint. */
const GERMAN_ORTHOGRAPHY = /[äöüßÄÖÜ]/g;

const SAMPLE_WORD_LIMIT = 4000;

export function detectLanguage(text: string, fallback: SupportedLanguage = 'en'): LanguageGuess {
  const words = text.toLowerCase().match(/[\p{L}]+/gu)?.slice(0, SAMPLE_WORD_LIMIT) ?? [];
  if (words.length === 0) return { language: fallback, confidence: 0 };

  let german = 0;
  let english = 0;
  for (const word of words) {
    if (GERMAN_MARKERS.has(word)) german += 1;
    if (ENGLISH_MARKERS.has(word)) english += 1;
  }

  // Weight orthography relative to text length so a single "für" in a long
  // English document cannot flip the result.
  const umlauts = (text.slice(0, SAMPLE_WORD_LIMIT * 8).match(GERMAN_ORTHOGRAPHY) ?? []).length;
  german += Math.min(umlauts, words.length * 0.15) * 2;

  const total = german + english;
  if (total === 0) return { language: fallback, confidence: 0 };

  const language: SupportedLanguage = german >= english ? 'de' : 'en';
  const confidence = Math.abs(german - english) / total;
  return { language, confidence };
}

const LOCALES: Record<SupportedLanguage, string> = { de: 'de-DE', en: 'en-US' };

export function localeFor(language: SupportedLanguage): string {
  return LOCALES[language];
}
