import { ControlClient, ControlPlaneError } from './control-client.js';
import type { ControlRequestOptions, OwnerCredentials, SessionCredentials } from './types.js';

const MAX_RENEW_WAIT_MS = 300_000;
const MAX_RENEW_ATTEMPTS = 3;

/** Owns serial credential renewal and final remote Session deletion. */
export class SessionOwner {
  readonly #control: ControlClient;
  readonly #timeoutMs: number;
  readonly #failureController = new AbortController();
  #credentials: SessionCredentials;
  #expiresAtMs: number;
  #failure: ControlPlaneError | null = null;
  #stopping = false;
  #wake: (() => void) | undefined;
  #worker: Promise<void> = Promise.resolve();
  #closeOperation: Promise<void> | null = null;

  private constructor(control: ControlClient, credentials: SessionCredentials, renewed: OwnerCredentials, timeoutMs: number) {
    this.#control = control;
    this.#timeoutMs = timeoutMs;
    this.#credentials = Object.freeze({ ...credentials, sourceToken: renewed.sourceToken });
    this.#expiresAtMs = ownerExpiry(renewed);
  }

  /** Bootstrap with an authenticated renewal, then keep the owner alive. */
  public static async maintain(control: ControlClient, credentials: SessionCredentials, options: ControlRequestOptions = {}): Promise<SessionOwner> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) throw new RangeError('timeoutMs must be positive and at most 300000');
    const renewed = await control.renewSession(credentials.sessionId, credentials.sourceToken, options);
    const owner = new SessionOwner(control, credentials, renewed, timeoutMs);
    owner.#worker = owner.#run();
    return owner;
  }

  /** Current immutable credentials; never cache the original token for cleanup. */
  public get credentials(): SessionCredentials { return this.#credentials; }
  /** Terminal renewal failure, retained without response bytes or credentials. */
  public get failure(): ControlPlaneError | null { return this.#failure; }
  /** Aborts only on terminal renewal failure, with a sanitized ControlPlaneError. */
  public get failureSignal(): AbortSignal { return this.#failureController.signal; }
  /** Check the observable owner lifetime before another management operation. */
  public assertActive(): void {
    if (this.#failure !== null) throw this.#failure;
    if (this.#stopping) throw new ControlPlaneError('control.owner_closed', 'Session owner is closed');
    if (Date.now() >= this.#expiresAtMs) throw new ControlPlaneError('control.owner_expired', 'Session owner capability has expired');
  }

  /** Stop scheduling, join the bounded in-flight renewal, then delete with its latest token. */
  public close(options: { readonly deleteRemoteSession?: boolean } = {}): Promise<void> {
    if (this.#closeOperation !== null) return this.#closeOperation;
    this.#stopping = true;
    this.#wake?.();
    this.#closeOperation = (async () => {
      await this.#worker;
      if (options.deleteRemoteSession ?? true) await this.#control.deleteSession(this.#credentials.sessionId, this.#credentials.sourceToken, { timeoutMs: this.#timeoutMs });
      if (this.#failure !== null) throw this.#failure;
    })();
    return this.#closeOperation;
  }

  public [Symbol.asyncDispose](): Promise<void> { return this.close(); }
  public toString(): string { return `SessionOwner(sessionId=${this.#credentials.sessionId.toString()}, credentials=[redacted])`; }

  async #run(): Promise<void> {
    while (!this.#stopping) {
      const remainingMs = this.#expiresAtMs - Date.now();
      if (remainingMs <= 0) { this.#fail(); return; }
      await this.#wait(Math.max(1, Math.min(MAX_RENEW_WAIT_MS, remainingMs / 2)));
      if (this.#stopping) return;
      let renewed = false;
      for (let attempt = 0; attempt < MAX_RENEW_ATTEMPTS && !this.#stopping; attempt++) {
        const availableMs = this.#expiresAtMs - Date.now();
        if (availableMs <= 0) break;
        try {
          const replacement = await this.#control.renewSession(this.#credentials.sessionId, this.#credentials.sourceToken, { timeoutMs: Math.max(1, Math.min(this.#timeoutMs, availableMs)) });
          const expiry = ownerExpiry(replacement);
          this.#credentials = Object.freeze({ ...this.#credentials, sourceToken: replacement.sourceToken });
          this.#expiresAtMs = expiry;
          renewed = true;
          break;
        } catch (error) {
          if (this.#stopping) return;
          if (!transientRenewal(error) || attempt + 1 === MAX_RENEW_ATTEMPTS) break;
          await this.#wait(Math.max(1, Math.min(250 * 2 ** attempt, (this.#expiresAtMs - Date.now()) / 4)));
        }
      }
      if (!renewed && !this.#stopping) { this.#fail(); return; }
    }
  }

  #fail(): void { this.#failure = new ControlPlaneError('control.owner_renewal_failed', 'Session owner renewal failed; remote management cannot continue'); this.#failureController.abort(this.#failure); }
  #wait(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => { clearTimeout(timer); this.#wake = undefined; resolve(); };
      const timer = setTimeout(done, delayMs);
      // An otherwise idle Node process is not kept alive solely by ownership.
      if (typeof timer === 'object' && 'unref' in timer) timer.unref();
      this.#wake = done;
    });
  }
}

function ownerExpiry(value: OwnerCredentials): number {
  const expiry = Date.parse(value.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new ControlPlaneError('control.owner_expired', 'Session renewal returned an expired owner capability');
  return expiry;
}
function transientRenewal(error: unknown): boolean {
  return error instanceof ControlPlaneError && (
    error.code === 'control.request' || error.code === 'control.timeout' ||
    error.statusCode === 408 || error.statusCode === 429 || (error.statusCode !== null && error.statusCode >= 500)
  );
}
