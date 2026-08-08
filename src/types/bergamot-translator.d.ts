/**
 * `@browsermt/bergamot-translator` ships no types. Only the surface this app
 * uses is declared — the library exposes considerably more.
 */
declare module '@browsermt/bergamot-translator' {
  export interface BatchTranslatorOptions {
    /**
     * Where the model registry lives. Defaults inside the library to a remote
     * S3 bucket, so this app always sets it: the whole point is that models are
     * served from our own origin.
     */
    registryUrl?: string;
    cacheSize?: number;
    downloadTimeout?: number;
    pivotLanguage?: string | null;
    onerror?: (error: unknown) => void;
  }

  export interface TranslationRequest {
    from: string;
    to: string;
    text: string;
    html: boolean;
    qualityScores?: boolean;
    priority?: number;
  }

  export interface TranslationResponse {
    request: TranslationRequest;
    target: { text: string };
  }

  export class BatchTranslator {
    constructor(options?: BatchTranslatorOptions, backing?: unknown);
    translate(request: TranslationRequest): Promise<TranslationResponse>;
    delete(): void;
  }
}
