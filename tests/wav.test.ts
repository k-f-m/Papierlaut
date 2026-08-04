import { describe, expect, it } from 'vitest';
import { decodeWave, encodeWave, measureSpeechBounds } from '../src/speech/wav.ts';

interface ClipSpec {
  sampleRate?: number;
  leadInSeconds?: number;
  toneSeconds?: number;
  tailSeconds?: number;
  amplitude?: number;
}

/** Silence, then a tone, then silence — the shape a synthesiser produces. */
function buildClip({
  sampleRate = 22050,
  leadInSeconds = 0,
  toneSeconds = 1,
  tailSeconds = 0,
  amplitude = 0.6,
}: ClipSpec = {}): { samples: Float32Array; sampleRate: number } {
  const lead = Math.round(leadInSeconds * sampleRate);
  const tone = Math.round(toneSeconds * sampleRate);
  const tail = Math.round(tailSeconds * sampleRate);
  const samples = new Float32Array(lead + tone + tail);
  for (let i = 0; i < tone; i += 1) {
    samples[lead + i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * amplitude;
  }
  return { samples, sampleRate };
}

describe('measureSpeechBounds', () => {
  it('reports the clip duration', () => {
    const { samples, sampleRate } = buildClip({ toneSeconds: 2 });
    expect(measureSpeechBounds(samples, sampleRate).duration).toBeCloseTo(2, 3);
  });

  it('measures the silence a synthesiser pads a clip with', () => {
    const { samples, sampleRate } = buildClip({ leadInSeconds: 0.2, toneSeconds: 1, tailSeconds: 0.3 });
    const bounds = measureSpeechBounds(samples, sampleRate);
    expect(bounds.leadIn).toBeGreaterThan(0.18);
    expect(bounds.leadIn).toBeLessThan(0.22);
    expect(bounds.tailOut).toBeGreaterThan(0.28);
    expect(bounds.tailOut).toBeLessThan(0.32);
  });

  it('finds no padding in a clip that starts and ends loud', () => {
    const { samples, sampleRate } = buildClip({ toneSeconds: 1 });
    const bounds = measureSpeechBounds(samples, sampleRate);
    expect(bounds.leadIn).toBeCloseTo(0, 2);
    expect(bounds.tailOut).toBeCloseTo(0, 2);
  });

  it('never trims a clip that is silent throughout', () => {
    const { samples, sampleRate } = buildClip({ leadInSeconds: 1, toneSeconds: 0 });
    const bounds = measureSpeechBounds(samples, sampleRate);
    expect(bounds.leadIn).toBe(0);
    expect(bounds.tailOut).toBe(0);
    expect(bounds.duration).toBeCloseTo(1, 3);
  });

  it('caps trimming so a mostly-quiet clip keeps most of its timeline', () => {
    const { samples, sampleRate } = buildClip({ leadInSeconds: 0.9, toneSeconds: 0.1 });
    const bounds = measureSpeechBounds(samples, sampleRate);
    expect(bounds.leadIn).toBeLessThanOrEqual(bounds.duration * 0.4 + 1e-6);
  });

  it('handles an empty clip', () => {
    expect(measureSpeechBounds(new Float32Array(0), 22050)).toEqual({
      duration: 0,
      leadIn: 0,
      tailOut: 0,
    });
  });
});

describe('encodeWave', () => {
  it('writes a RIFF/WAVE header describing 16-bit mono PCM', () => {
    const buffer = encodeWave(new Float32Array(10), 22050);
    const view = new DataView(buffer);
    const tag = (at: number): string =>
      String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));

    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(tag(12)).toBe('fmt ');
    expect(tag(36)).toBe('data');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(22050);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(4, true)).toBe(buffer.byteLength - 8);
    expect(view.getUint32(40, true)).toBe(20); // 10 samples, 2 bytes each
  });

  it('round-trips samples within 16-bit precision', () => {
    const { samples, sampleRate } = buildClip({ toneSeconds: 0.05 });
    const decoded = decodeWave(encodeWave(samples, sampleRate));

    expect(decoded.sampleRate).toBe(sampleRate);
    expect(decoded.samples).toHaveLength(samples.length);
    for (const [i, value] of samples.entries()) {
      expect(decoded.samples[i]).toBeCloseTo(value, 3);
    }
  });

  it('preserves measured bounds across the round trip', () => {
    const { samples, sampleRate } = buildClip({ leadInSeconds: 0.2, toneSeconds: 0.5, tailSeconds: 0.2 });
    const before = measureSpeechBounds(samples, sampleRate);
    const decoded = decodeWave(encodeWave(samples, sampleRate));
    const after = measureSpeechBounds(decoded.samples, decoded.sampleRate);

    expect(after.duration).toBeCloseTo(before.duration, 6);
    expect(after.leadIn).toBeCloseTo(before.leadIn, 6);
    expect(after.tailOut).toBeCloseTo(before.tailOut, 6);
  });

  it('clamps overshoot instead of letting it wrap around', () => {
    // The vocoder can exceed ±1; wrapping would turn a loud syllable into noise.
    const decoded = decodeWave(encodeWave(Float32Array.from([2, -2, 0.5]), 22050));
    expect(decoded.samples[0]).toBeCloseTo(1, 3);
    expect(decoded.samples[1]).toBeCloseTo(-1, 6);
    expect(decoded.samples[2]).toBeCloseTo(0.5, 3);
  });

  it('produces a header-only file for no samples', () => {
    expect(encodeWave(new Float32Array(0), 22050).byteLength).toBe(44);
  });
});
