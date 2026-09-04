/** An error reported by a PocketStation SDK operation. */
export class PocketStationError extends Error {
  /** Stable machine-readable error code. */
  public readonly code: string;
  /** Original error when another operation caused this failure. */
  public override readonly cause: unknown;

  public constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PocketStationError';
    this.code = code;
    this.cause = options?.cause;
  }
}
