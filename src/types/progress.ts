/**
 * Progress of a one-off local model download. Shared by every engine that has
 * to fetch weights before it can work, so neither engine family has to import
 * from the other.
 */
export interface LoadProgress {
  readonly loaded: number;
  readonly total: number;
}
