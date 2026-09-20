import { PocketStationError } from '../errors.js';
import {
  SecretToken,
  SessionId,
  type BusCredentialOptions,
  type BusState,
  type ControlClientOptions,
  type ControlFetch,
  type ControlRequestOptions,
  type CreateSessionOptions,
  type IceServer,
  type Invitation,
  type SessionCredentials,
  type SessionSnapshot,
  type SubscriberCredentials,
  type SubscriptionState,
} from './types.js';

const MAX_ERROR_BODY_BYTES = 4_096;
const MAX_JSON_BODY_BYTES = 65_536;
const MAX_ICE_SERVERS = 32;
const MAX_ICE_URLS = 16;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 10_000;

type JsonObject = Record<string, unknown>;

/** A configuration, transport, HTTP, or decoding control-plane failure. */
export class ControlPlaneError extends PocketStationError {
  /** HTTP status when the control plane returned an unexpected response. */
  public readonly statusCode: number | null;

  public constructor(
    code: string,
    message: string,
    options?: { statusCode?: number; cause?: unknown },
  ) {
    super(code, message, { cause: options?.cause });
    this.name = 'ControlPlaneError';
    this.statusCode = options?.statusCode ?? null;
  }
}

interface ActiveOperation {
  readonly signal: AbortSignal;
  readonly abort: (reason: 'closed') => void;
  readonly dispose: () => void;
}

interface RequestParameters {
  readonly expectedStatus: number;
  readonly authorization?: SecretToken;
  readonly jsonBody?: JsonObject;
  readonly expectJson: boolean;
  readonly options?: ControlRequestOptions;
}

/** Reusable, bounded asynchronous client for Session lifecycle operations. */
export class ControlClient {
  public readonly controlPlaneUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: ControlFetch;
  readonly #activeOperations = new Set<ActiveOperation>();
  #closed = false;

  public constructor(controlPlaneUrl: string, options: ControlClientOptions = {}) {
    this.controlPlaneUrl = normalizeBaseUrl(controlPlaneUrl);
    this.#timeoutMs = validateTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const fetchImplementation = options.fetch ?? globalThis.fetch;
    if (typeof fetchImplementation !== 'function') {
      throw new TypeError(
        'ControlClient requires a web-standard fetch implementation',
      );
    }
    this.#fetch = fetchImplementation.bind(globalThis);
  }

  /** Create one Session and return its source-owner credentials. */
  public async createSession(
    options: CreateSessionOptions = {},
  ): Promise<SessionCredentials> {
    const requiredBuses = busIds(
      options.requiredBuses ?? ['application', 'microphone'],
      'requiredBuses',
    );
    const payload = await this.#request('POST', 'v1/sessions', {
      expectedStatus: 201,
      expectJson: true,
      options,
      jsonBody: { required_buses: requiredBuses },
    });
    return sessionCredentials(payload);
  }

  /** Read the current state of one Session. */
  public async session(
    sessionId: string | SessionId,
    sourceToken: SecretToken,
    options: ControlRequestOptions = {},
  ): Promise<SessionSnapshot> {
    const identifier = sessionIdentifier(sessionId);
    const payload = await this.#request(
      'GET',
      `v1/sessions/${encodeURIComponent(identifier.toString())}`,
      {
        expectedStatus: 200,
        expectJson: true,
        authorization: sourceToken,
        options,
      },
    );
    return sessionSnapshot(payload);
  }

  /** Issue receiver credentials scoped to one AudioBus. */
  public async issueSubscriberCredentials(
    sessionId: string | SessionId,
    sourceToken: SecretToken,
    options: BusCredentialOptions = {},
  ): Promise<SubscriberCredentials> {
    const identifier = sessionIdentifier(sessionId);
    const requestedBus = busId(options.busId ?? 'mix', 'busId');
    const payload = await this.#request(
      'POST',
      `v1/sessions/${encodeURIComponent(identifier.toString())}/subscribe`,
      {
        expectedStatus: 200,
        expectJson: true,
        authorization: sourceToken,
        options,
        jsonBody: { bus_id: requestedBus },
      },
    );
    return subscriberCredentials(payload);
  }

  /** Create one time-limited receiver invitation for an AudioBus. */
  public async createInvitation(
    sessionId: string | SessionId,
    sourceToken: SecretToken,
    options: BusCredentialOptions = {},
  ): Promise<Invitation> {
    const identifier = sessionIdentifier(sessionId);
    const requestedBus = busId(options.busId ?? 'mix', 'busId');
    const payload = await this.#request(
      'POST',
      `v1/sessions/${encodeURIComponent(identifier.toString())}/invitations`,
      {
        expectedStatus: 201,
        expectJson: true,
        authorization: sourceToken,
        options,
        jsonBody: { bus_id: requestedBus },
      },
    );
    return invitation(payload, identifier);
  }

  /** Delete one Session. */
  public async deleteSession(
    sessionId: string | SessionId,
    sourceToken: SecretToken,
    options: ControlRequestOptions = {},
  ): Promise<void> {
    const identifier = sessionIdentifier(sessionId);
    await this.#request(
      'DELETE',
      `v1/sessions/${encodeURIComponent(identifier.toString())}`,
      {
        expectedStatus: 204,
        expectJson: false,
        authorization: sourceToken,
        options,
      },
    );
  }

  /** Cancel active operations and reject future work. Idempotent. */
  public close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const operation of this.#activeOperations) operation.abort('closed');
  }

  public [Symbol.dispose](): void {
    this.close();
  }

  async #request(
    method: string,
    path: string,
    parameters: RequestParameters,
  ): Promise<JsonObject> {
    if (this.#closed) throw new Error('ControlClient has closed');

    const timeoutMs = validateTimeout(
      parameters.options?.timeoutMs ?? this.#timeoutMs,
    );
    const operation = createOperation(timeoutMs, parameters.options?.signal);
    this.#activeOperations.add(operation);
    const headers = new Headers();
    let exposedAuthorization: string | undefined;
    let body: string | undefined;
    if (parameters.authorization !== undefined) {
      exposedAuthorization = parameters.authorization.exposeSecret();
      headers.set('authorization', `Bearer ${exposedAuthorization}`);
    }
    if (parameters.jsonBody !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(parameters.jsonBody);
    }

    try {
      let response: Response;
      try {
        if (operation.signal.aborted) {
          throw requestFailure(
            operation.signal,
            timeoutMs,
            new DOMException('aborted', 'AbortError'),
            exposedAuthorization,
          );
        }
        response = await this.#fetch(new URL(path, this.controlPlaneUrl), {
          method,
          headers,
          body,
          signal: operation.signal,
        });
      } catch (error) {
        throw requestFailure(
          operation.signal,
          timeoutMs,
          error,
          exposedAuthorization,
        );
      }

      if (response.status !== parameters.expectedStatus) {
        const bytes = await readBounded(
          response,
          MAX_ERROR_BODY_BYTES,
          operation.signal,
          timeoutMs,
          exposedAuthorization,
        );
        let detail = new TextDecoder().decode(bytes);
        if (exposedAuthorization !== undefined) {
          detail = detail.replaceAll(exposedAuthorization, '[redacted]');
        }
        throw new ControlPlaneError(
          'control.http_status',
          `control-plane returned HTTP ${response.status}: ${detail}`,
          { statusCode: response.status },
        );
      }

      if (!parameters.expectJson) {
        await response.body?.cancel().catch(() => undefined);
        return Object.freeze({});
      }

      const bytes = await readBounded(
        response,
        MAX_JSON_BODY_BYTES,
        operation.signal,
        timeoutMs,
        exposedAuthorization,
      );
      let decoded: unknown;
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        decoded = JSON.parse(text) as unknown;
      } catch (error) {
        throw new ControlPlaneError(
          'control.response_decode',
          `control-plane response could not be decoded: ${safeErrorMessage(error)}`,
        );
      }
      if (!isJsonObject(decoded)) {
        throw responseDecode('control-plane response must be a JSON object');
      }
      return decoded;
    } finally {
      operation.dispose();
      this.#activeOperations.delete(operation);
    }
  }
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(
      'controlPlaneUrl must be an absolute http or https URL',
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError(
      'controlPlaneUrl must be an absolute http or https URL',
    );
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new TypeError('controlPlaneUrl must not contain credentials');
  }
  parsed.search = '';
  parsed.hash = '';
  if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
  return parsed.toString();
}

function validateTimeout(value: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_TIMEOUT_MS
  ) {
    throw new RangeError(
      `timeoutMs must be greater than 0 and at most ${MAX_TIMEOUT_MS}`,
    );
  }
  return value;
}

function createOperation(
  timeoutMs: number,
  source?: AbortSignal,
): ActiveOperation {
  const controller = new AbortController();
  let disposed = false;
  const timeout = globalThis.setTimeout(
    () => controller.abort('timeout'),
    timeoutMs,
  );
  const onAbort = (): void => controller.abort('cancelled');
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    globalThis.clearTimeout(timeout);
    source?.removeEventListener('abort', onAbort);
  };
  controller.signal.addEventListener('abort', dispose, { once: true });
  if (source?.aborted === true) controller.abort('cancelled');
  else source?.addEventListener('abort', onAbort, { once: true });
  return Object.freeze({
    signal: controller.signal,
    abort: (reason: 'closed') => controller.abort(reason),
    dispose,
  });
}

function requestFailure(
  signal: AbortSignal,
  timeoutMs: number,
  error: unknown,
  redactedValue?: string,
): ControlPlaneError {
  if (signal.aborted) {
    if (signal.reason === 'timeout') {
      return new ControlPlaneError(
        'control.timeout',
        `control-plane request exceeded its ${timeoutMs} ms deadline`,
      );
    }
    if (signal.reason === 'closed') {
      return new ControlPlaneError(
        'control.closed',
        'control-plane request was cancelled because ControlClient closed',
      );
    }
    return new ControlPlaneError(
      'control.cancelled',
      'control-plane request was cancelled',
    );
  }
  return new ControlPlaneError(
    'control.request',
    `control-plane request failed: ${redact(
      safeErrorMessage(error),
      redactedValue,
    )}`,
  );
}

async function readBounded(
  response: Response,
  limitBytes: number,
  signal: AbortSignal,
  timeoutMs: number,
  redactedValue?: string,
): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limitBytes + 1 - total;
      if (remaining <= 0) break;
      const retained = value.byteLength <= remaining ? value : value.slice(0, remaining);
      chunks.push(retained);
      total += retained.byteLength;
      if (total > limitBytes) break;
    }
  } catch (error) {
    if (signal.aborted) {
      throw requestFailure(signal, timeoutMs, error, redactedValue);
    }
    throw new ControlPlaneError(
      'control.request',
      `control-plane response body failed: ${redact(
        safeErrorMessage(error),
        redactedValue,
      )}`,
    );
  } finally {
    if (total > limitBytes) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (total > limitBytes) {
    throw new ControlPlaneError(
      'control.response_too_large',
      `control-plane response exceeds ${limitBytes} bytes`,
    );
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redact(value: string, secret?: string): string {
  return secret === undefined ? value : value.replaceAll(secret, '[redacted]');
}

function responseDecode(message: string): ControlPlaneError {
  return new ControlPlaneError('control.response_decode', message);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(payload: JsonObject, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string') {
    throw responseDecode(
      `control-plane response field '${key}' has the wrong type`,
    );
  }
  return value;
}

function requiredBoolean(payload: JsonObject, key: string): boolean {
  const value = payload[key];
  if (typeof value !== 'boolean') {
    throw responseDecode(
      `control-plane response field '${key}' has the wrong type`,
    );
  }
  return value;
}

function requiredArray(payload: JsonObject, key: string): unknown[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    throw responseDecode(
      `control-plane response field '${key}' has the wrong type`,
    );
  }
  return value;
}

function optionalString(payload: JsonObject, key: string): string | null {
  const value = payload[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw responseDecode(
      `control-plane response field '${key}' has the wrong type`,
    );
  }
  return value;
}

function nonnegativeInteger(
  payload: JsonObject,
  key: string,
  minimum = 0,
): number {
  const value = payload[key];
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw responseDecode(
      `control-plane response field '${key}' must be an integer of at least ${minimum}`,
    );
  }
  return value as number;
}

function identifier(value: string, field: string, maximum: number): string {
  if (
    value.length === 0 ||
    value.length > maximum ||
    !/^[A-Za-z0-9._-]+$/.test(value)
  ) {
    throw new RangeError(
      `${field} must contain 1 to ${maximum} ASCII letters, digits, '.', '_' or '-'`,
    );
  }
  return value;
}

function busId(value: string, field: string): string {
  return identifier(value, field, 64);
}

function busIds(values: readonly unknown[], field: string): readonly string[] {
  if (
    values.length < 1 ||
    values.length > 16 ||
    !values.every((value) => typeof value === 'string')
  ) {
    throw new RangeError(`${field} must contain between 1 and 16 bus IDs`);
  }
  const result = values.map((value) => busId(value as string, field));
  if (new Set(result).size !== result.length) {
    throw new RangeError(`${field} must not contain duplicate bus IDs`);
  }
  return Object.freeze(result);
}

function decodedBusIds(values: readonly unknown[], field: string): readonly string[] {
  try {
    return busIds(values, field);
  } catch (error) {
    throw responseDecode(safeErrorMessage(error));
  }
}

function sessionIdentifier(value: string | SessionId): SessionId {
  return value instanceof SessionId ? value : new SessionId(value);
}

function decodedSessionId(payload: JsonObject): SessionId {
  try {
    return new SessionId(requiredString(payload, 'session_id'));
  } catch (error) {
    if (error instanceof ControlPlaneError) throw error;
    throw responseDecode(safeErrorMessage(error));
  }
}

function decodedSecret(payload: JsonObject, key: string): SecretToken {
  try {
    return new SecretToken(requiredString(payload, key));
  } catch (error) {
    if (error instanceof ControlPlaneError) throw error;
    throw responseDecode(safeErrorMessage(error));
  }
}

function requiredIdentifier(
  payload: JsonObject,
  key: string,
  maximum: number,
): string {
  try {
    return identifier(requiredString(payload, key), key, maximum);
  } catch (error) {
    if (error instanceof ControlPlaneError) throw error;
    throw responseDecode(safeErrorMessage(error));
  }
}

function iceServers(payload: JsonObject): readonly IceServer[] {
  const rawServers = payload.ice_servers ?? [];
  if (!Array.isArray(rawServers)) {
    throw responseDecode(
      "control-plane response field 'ice_servers' has the wrong type",
    );
  }
  if (rawServers.length > MAX_ICE_SERVERS) {
    throw new ControlPlaneError(
      'control.response_too_large',
      `control-plane returned more than ${MAX_ICE_SERVERS} ICE servers`,
    );
  }
  return Object.freeze(
    rawServers.map((rawServer): IceServer => {
      if (!isJsonObject(rawServer)) {
        throw responseDecode('control-plane ICE server must be a JSON object');
      }
      const urls = requiredArray(rawServer, 'urls');
      if (!urls.every((url) => typeof url === 'string')) {
        throw responseDecode('control-plane ICE server URLs must be strings');
      }
      if (urls.length > MAX_ICE_URLS) {
        throw new ControlPlaneError(
          'control.response_too_large',
          `ICE server returned more than ${MAX_ICE_URLS} URLs`,
        );
      }
      const username = optionalString(rawServer, 'username');
      const credentialValue = optionalString(rawServer, 'credential');
      let credential: SecretToken | null = null;
      if (credentialValue !== null) {
        try {
          credential = new SecretToken(credentialValue);
        } catch (error) {
          throw responseDecode(safeErrorMessage(error));
        }
      }
      return Object.freeze({
        urls: Object.freeze(urls as string[]),
        username,
        credential,
      });
    }),
  );
}

function sessionCredentials(payload: JsonObject): SessionCredentials {
  return Object.freeze({
    sessionId: decodedSessionId(payload),
    requiredBuses: decodedBusIds(
      requiredArray(payload, 'required_buses'),
      'requiredBuses',
    ),
    sourceToken: decodedSecret(payload, 'source_token'),
    whipUrl: optionalString(payload, 'whip_url'),
    whepUrl: optionalString(payload, 'whep_url'),
    iceServers: iceServers(payload),
  });
}

function busStates(payload: JsonObject): readonly BusState[] {
  const raw = requiredArray(payload, 'buses');
  if (raw.length > 16 || !raw.every(isJsonObject)) {
    throw responseDecode('control-plane buses must contain at most 16 objects');
  }
  return Object.freeze(
    raw.map((state): BusState =>
      Object.freeze({
        busId: requiredIdentifier(state, 'bus_id', 64),
        role: requiredIdentifier(state, 'role', 64),
        sourceActive: requiredBoolean(state, 'source_active'),
        sourceGeneration: nonnegativeInteger(state, 'source_generation'),
      }),
    ),
  );
}

function subscriptionStates(payload: JsonObject): readonly SubscriptionState[] {
  const raw = requiredArray(payload, 'subscriptions');
  if (raw.length > 1_024 || !raw.every(isJsonObject)) {
    throw responseDecode(
      'control-plane subscriptions must contain at most 1024 objects',
    );
  }
  return Object.freeze(
    raw.map((state): SubscriptionState =>
      Object.freeze({
        subscriberId: requiredIdentifier(state, 'subscriber_id', 128),
        busId: requiredIdentifier(state, 'bus_id', 64),
      }),
    ),
  );
}

function sessionSnapshot(payload: JsonObject): SessionSnapshot {
  return Object.freeze({
    sessionId: decodedSessionId(payload),
    stateRevision: nonnegativeInteger(payload, 'state_revision', 1),
    relayEpoch: optionalString(payload, 'relay_epoch'),
    relayRevision: nonnegativeInteger(payload, 'relay_revision'),
    requiredBuses: decodedBusIds(
      requiredArray(payload, 'required_buses'),
      'requiredBuses',
    ),
    buses: busStates(payload),
    subscriptions: subscriptionStates(payload),
    ready: requiredBoolean(payload, 'ready'),
    subscriptionCount: nonnegativeInteger(payload, 'subscription_count'),
    codec: requiredString(payload, 'codec'),
  });
}

function subscriberCredentials(payload: JsonObject): SubscriberCredentials {
  return Object.freeze({
    sessionId: decodedSessionId(payload),
    busId: requiredIdentifier(payload, 'bus_id', 64),
    subscriberToken: decodedSecret(payload, 'subscriber_token'),
  });
}

function invitation(payload: JsonObject, sessionId: SessionId): Invitation {
  return Object.freeze({
    sessionId,
    joinCode: requiredString(payload, 'join_code'),
    joinUrl: requiredString(payload, 'join_url'),
    expiresAt: requiredString(payload, 'expires_at'),
  });
}
