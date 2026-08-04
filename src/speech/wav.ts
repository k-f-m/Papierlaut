/**
 * Waveform helpers for locally synthesised speech.
 *
 * The model emits raw float samples. Two things are done with them: they are
 * wrapped in a WAV container so an `<audio>` element can play them — which is
 * what gives pitch-preserving speed control — and they are measured so the
 * highlight knows where speech actually begins.
 *
 * Measuring matters more than it sounds. The model pads each clip with silence,
 * and without subtracting that lead-in every sentence would light up its first
 * word a beat before the voice reaches it.
 */

export interface SpeechBounds {
  /** Total clip length in seconds, padding included. */
  readonly duration: number;
  /** Seconds of near-silence before speech begins. */
  readonly leadIn: number;
  /** Seconds of near-silence after speech ends. */
  readonly tailOut: number;
}

/** RMS below this, relative to full scale, counts as silence. */
const SILENCE_FLOOR = 0.012;
/** Window for the silence scan — long enough not to be fooled by a single click. */
const WINDOW_SECONDS = 0.005;
/** Never trim more than this share of a clip, however quiet it looks. */
const MAX_TRIM_RATIO = 0.4;

export function measureSpeechBounds(samples: Float32Array, sampleRate: number): SpeechBounds {
  const duration = sampleRate > 0 ? samples.length / sampleRate : 0;
  if (samples.length === 0 || sampleRate <= 0) return { duration, leadIn: 0, tailOut: 0 };

  const windowSize = Math.max(1, Math.round(sampleRate * WINDOW_SECONDS));
  const windows = Math.ceil(samples.length / windowSize);

  let first = -1;
  let last = -1;
  for (let w = 0; w < windows; w += 1) {
    const from = w * windowSize;
    const to = Math.min(samples.length, from + windowSize);
    let sum = 0;
    for (let i = from; i < to; i += 1) {
      const value = samples[i] as number;
      sum += value * value;
    }
    if (Math.sqrt(sum / (to - from)) > SILENCE_FLOOR) {
      if (first < 0) first = w;
      last = w;
    }
  }

  if (first < 0) return { duration, leadIn: 0, tailOut: 0 };

  const maxTrim = duration * MAX_TRIM_RATIO;
  const leadIn = Math.min((first * windowSize) / sampleRate, maxTrim);
  const tailOut = Math.min(Math.max(duration - ((last + 1) * windowSize) / sampleRate, 0), maxTrim);
  return { duration, leadIn: Math.max(0, leadIn), tailOut };
}

const HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const FORMAT_PCM = 1;

/**
 * Wraps mono float samples in a 16-bit PCM WAV container.
 *
 * Values are clamped before scaling: the vocoder can overshoot ±1, and letting
 * that wrap around would turn a loud syllable into a burst of noise.
 */
export function encodeWave(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const channels = 1;
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const dataBytes = samples.length * bytesPerSample * channels;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  const writeTag = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeTag(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeTag(8, 'WAVE');

  writeTag(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, FORMAT_PCM, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true); // byte rate
  view.setUint16(32, channels * bytesPerSample, true); // block align
  view.setUint16(34, BITS_PER_SAMPLE, true);

  writeTag(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] as number));
    // Asymmetric scaling: int16 reaches -32768 but only +32767.
    view.setInt16(HEADER_BYTES + i * 2, Math.round(clamped * (clamped < 0 ? 32768 : 32767)), true);
  }

  return buffer;
}

/** Reads back what `encodeWave` wrote — used by the tests, and handy when debugging. */
export function decodeWave(buffer: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(buffer);
  const sampleRate = view.getUint32(24, true);
  const dataBytes = view.getUint32(40, true);
  const count = Math.floor(dataBytes / 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    samples[i] = view.getInt16(HEADER_BYTES + i * 2, true) / 32768;
  }
  return { samples, sampleRate };
}
