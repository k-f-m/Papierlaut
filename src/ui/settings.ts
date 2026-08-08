import { preferredUiLocale } from './i18n.ts';
import type { UiLocale } from './i18n.ts';

export interface Settings {
  rate: number;
  volume: number;
  follow: boolean;
  /** Show an interlinear translation under each sentence. */
  translate: boolean;
  uiLocale: UiLocale;
  /** Last voice the user chose, restored when it is still available. */
  voiceId: string | null;
}

/** Injected so the controller has no direct dependency on browser storage. */
export interface SettingsStore {
  load(): Settings;
  save(patch: Partial<Settings>): void;
}

const KEY = 'papierlaut.settings.v1';

function defaults(): Settings {
  return {
    rate: 1,
    volume: 1,
    follow: true,
    translate: false,
    uiLocale: preferredUiLocale(),
    voiceId: null,
  };
}

const RATE_RANGE = [0.5, 2] as const;

function coerce(raw: unknown): Settings {
  const base = defaults();
  if (typeof raw !== 'object' || raw === null) return base;
  const value = raw as Partial<Record<keyof Settings, unknown>>;

  return {
    rate:
      typeof value.rate === 'number' && Number.isFinite(value.rate)
        ? Math.min(Math.max(value.rate, RATE_RANGE[0]), RATE_RANGE[1])
        : base.rate,
    volume:
      typeof value.volume === 'number' && Number.isFinite(value.volume)
        ? Math.min(Math.max(value.volume, 0), 1)
        : base.volume,
    follow: typeof value.follow === 'boolean' ? value.follow : base.follow,
    translate: typeof value.translate === 'boolean' ? value.translate : base.translate,
    uiLocale: value.uiLocale === 'de' || value.uiLocale === 'en' ? value.uiLocale : base.uiLocale,
    voiceId: typeof value.voiceId === 'string' ? value.voiceId : null,
  };
}

/**
 * Preferences live in localStorage. Storage can be disabled or full, and losing
 * a preference is never worth breaking the app over, so every access is
 * tolerant of failure.
 */
export class LocalSettingsStore implements SettingsStore {
  #cache: Settings | undefined;

  load(): Settings {
    if (this.#cache) return { ...this.#cache };
    let parsed: unknown;
    try {
      const raw = globalThis.localStorage?.getItem(KEY);
      parsed = raw === null || raw === undefined ? undefined : JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    this.#cache = coerce(parsed);
    return { ...this.#cache };
  }

  save(patch: Partial<Settings>): void {
    const next = { ...this.load(), ...patch };
    this.#cache = next;
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
    } catch {
      // Preferences simply do not persist this session.
    }
  }
}
