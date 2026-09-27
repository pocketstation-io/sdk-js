import { PocketStationError } from '../errors.js';
import {
  SecretToken,
  SecretUrl,
  SessionId,
  type BusCredentialOptions,
  type BusState,
  type ControlClientOptions,
  type ControlFetch,
  type ControlRequestOptions,
  type CreateInvitationOptions,
  type CreateSessionOptions,
  type IceServer,
  type Invitation,
  type InvitationMetadata,
  type InvitationVisibility,
  type PublisherCredentialOptions,
  type PublisherCredentials,
  type RedeemedInvitation,
  type RedeemInvitationOptions,
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

/** An invitation is invalid, expired, revoked, or already redeemed. */
export class InvitationUnavailableError extends ControlPlaneError {
  public constructor() {
    super(
      'control.invitation_unavailable',
      'invitation is unavailable',
      { statusCode: 404 },
    );
    this.name = 'InvitationUnavailableError';
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
  readonly redactedValues?: readonly string[];
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

  /** Issue media-only publisher credentials scoped to one AudioBus. */
  public async issuePublisherCredentials(
    sessionId: string | SessionId,
    sourceToken: SecretToken,
    options: PublisherCredentialOptions,
  ): Promise<PublisherCredentials> {
    const identifier = sessionIdentifier(sessionId);
    const requestedBus = busId(options.busId, 'busId');
    const payload = await this.#request(
      'POST',
      `v1/sessions/${encodeURIComponent(identifier.toString())}/publish`,
      {
        expectedStatus: 200,
        expectJson: true,
        authorization: sourceToken,
        options,
        jsonBody: { bus_id: requestedBus },
      },
    );
    return publisherCredentials(payload);
  }

  /** Create one time-limited receiver invitation for an AudioBus. */
  public async createInvitation(
    sessionId: string | SessionId,
    sourceToken: SecretToken,
    options: CreateInvitationOptions,
  ): Promise<Invitation> {
    const identifier = sessionIdentifier(sessionId);
    const requestedBus = busId(options.busId, 'busId');
    const visibility = invitationVisibility(options.visibility ?? 'private');
    const payload = await this.#request(
      'POST',
      `v1/sessions/${encodeURIComponent(identifier.toString())}/invitations`,
      {
        expectedStatus: 201,
        expectJson: true,
        authorization: sourceToken,
        options,
        jsonBody: { bus_id: requestedBus, visibility },
      },
    );
    return invitation(payload, identifier, requestedBus);
  }

  /** Inspect safe invitation metadata without consuming the invitation. */
  public async inspectInvitation(
    locator: string | SecretToken,
    options: ControlRequestOptions = {},
  ): Promise<InvitationMetadata> {
    const normalizedLocator = invitationLocator(locator);
    if (/^[0-9a-f]{8}-/.test(normalizedLocator)) throw new RangeError('Inspection requires a readable navigation alias');
    let payload: JsonObject;
    try {
      payload = await this.#request(
        'GET',
        `v1/invitations/${encodeURIComponent(normalizedLocator)}`,
        { expectedStatus: 200, expectJson: true, options },
      );
    } catch (error) {
      if (error instanceof ControlPlaneError && error.statusCode === 404) {
        throw new InvitationUnavailableError();
      }
      throw error;
    }
    return invitationMetadata(payload);
  }

  /** Redeem one invitation exactly once through the consuming POST boundary. */
  public async redeemInvitation(
    locator: string | SecretToken,
    options: RedeemInvitationOptions = {},
  ): Promise<RedeemedInvitation> {
    const normalizedLocator = invitationLocator(locator);
    const suppliedJoinCode = redemptionJoinCode(options);
    const opaqueLocator = /^[0-9a-f]{8}-/.test(normalizedLocator);
    if (opaqueLocator && suppliedJoinCode !== undefined && suppliedJoinCode !== normalizedLocator) throw new InvitationUnavailableError();
    const joinCode = opaqueLocator ? normalizedLocator : suppliedJoinCode;
    if (joinCode === undefined) throw new InvitationUnavailableError();
    const redactedValues = [normalizedLocator, joinCode];
    let payload: JsonObject;
    try {
      payload = await this.#request(
        'POST',
        opaqueLocator ? 'v1/join' : `v1/join/${encodeURIComponent(normalizedLocator)}`,
        {
          expectedStatus: 200,
          expectJson: true,
          options,
          jsonBody: { join_code: joinCode },
          redactedValues,
        },
      );
    } catch (error) {
      if (error instanceof ControlPlaneError && error.statusCode === 404) {
        throw new InvitationUnavailableError();
      }
      throw error;
    }
    return redeemedInvitation(payload);
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
    const redactedValues = [...(parameters.redactedValues ?? [])];
    let body: string | undefined;
    if (parameters.authorization !== undefined) {
      exposedAuthorization = parameters.authorization.exposeSecret();
      redactedValues.push(exposedAuthorization);
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
            redactedValues,
          );
        }
        response = await this.#fetch(new URL(path, this.controlPlaneUrl), {
          method,
          headers,
          body,
          signal: operation.signal,
          redirect: 'error',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
      } catch (error) {
        throw requestFailure(
          operation.signal,
          timeoutMs,
          error,
          redactedValues,
        );
      }

      if (response.status !== parameters.expectedStatus) {
        const bytes = await readBounded(
          response,
          MAX_ERROR_BODY_BYTES,
          operation.signal,
          timeoutMs,
          redactedValues,
        );
        let detail = new TextDecoder().decode(bytes);
        detail = redact(detail, redactedValues);
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
        redactedValues,
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
  redactedValues: readonly string[] = [],
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
      redactedValues,
    )}`,
  );
}

async function readBounded(
  response: Response,
  limitBytes: number,
  signal: AbortSignal,
  timeoutMs: number,
  redactedValues: readonly string[] = [],
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
      throw requestFailure(signal, timeoutMs, error, redactedValues);
    }
    throw new ControlPlaneError(
      'control.request',
      `control-plane response body failed: ${redact(
        safeErrorMessage(error),
        redactedValues,
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

function redact(value: string, secrets: readonly string[] = []): string {
  return secrets.reduce(
    (redacted, secret) => redacted.replaceAll(secret, '[redacted]'),
    value,
  );
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

function publisherCredentials(payload: JsonObject): PublisherCredentials {
  const signalUrl = requiredString(payload, 'signal_url');
  let parsedSignalUrl: URL;
  try {
    parsedSignalUrl = new URL(signalUrl);
  } catch (error) {
    throw responseDecode(`control-plane signal_url is invalid: ${safeErrorMessage(error)}`);
  }
  if (!['ws:', 'wss:'].includes(parsedSignalUrl.protocol)) {
    throw responseDecode('control-plane signal_url must use ws or wss');
  }
  return Object.freeze({
    sessionId: decodedSessionId(payload),
    busId: requiredIdentifier(payload, 'bus_id', 64),
    publisherToken: decodedSecret(payload, 'publisher_token'),
    signalUrl: parsedSignalUrl.href,
    iceServers: iceServers(payload),
  });
}

function invitation(
  payload: JsonObject,
  sessionId: SessionId,
  requestedBus: string,
): Invitation {
  const visibility = decodedInvitationVisibility(payload);
  const joinCode = decodedOpaqueJoinCode(payload);
  const shareAlias = invitationAlias(requiredString(payload, 'share_alias'), visibility);
  const joinUrl = invitationUrl(payload, 'join_url', '/join', joinCode);
  const shareUrl = invitationUrl(payload, 'share_url', `/${shareAlias}`, joinCode);
  if (joinUrl && shareUrl && new URL(joinUrl.exposeSecret()).origin !== new URL(shareUrl.exposeSecret()).origin) {
    throw responseDecode('control-plane invitation URLs use different receiver origins');
  }
  return Object.freeze({
    sessionId,
    busId: requestedBus,
    joinCode: new SecretToken(joinCode),
    joinUrl,
    shareAlias,
    shareUrl,
    visibility,
    expiresAt: requiredExpiry(payload),
  });
}

function invitationMetadata(payload: JsonObject): InvitationMetadata {
  const visibility = decodedInvitationVisibility(payload);
  return Object.freeze({
    shareAlias: invitationAlias(
      requiredString(payload, 'share_alias'),
      visibility,
    ),
    visibility,
    expiresAt: requiredExpiry(payload),
  });
}

function redeemedInvitation(payload: JsonObject): RedeemedInvitation {
  const signalUrl = transportUrl(payload, 'signal_url', ['ws:', 'wss:']);
  const whepValue = optionalString(payload, 'whep_url');
  return Object.freeze({
    sessionId: decodedSessionId(payload),
    busId: requiredIdentifier(payload, 'bus_id', 64),
    subscriberToken: decodedSecret(payload, 'subscriber_token'),
    signalUrl,
    whepUrl:
      whepValue === null
        ? null
        : validatedTransportUrl(whepValue, 'whep_url', ['http:', 'https:']),
    iceServers: iceServers(payload),
  });
}

function invitationVisibility(value: unknown): InvitationVisibility {
  if (value !== 'public' && value !== 'private') {
    throw new RangeError("visibility must be 'public' or 'private'");
  }
  return value;
}

function decodedInvitationVisibility(payload: JsonObject): InvitationVisibility {
  try {
    return invitationVisibility(payload.visibility);
  } catch (error) {
    throw responseDecode(safeErrorMessage(error));
  }
}

function invitationLocator(value: string | SecretToken): string {
  const locator = (value instanceof SecretToken ? value.exposeSecret() : value).trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(locator)) {
    return locator;
  }
  if (/^[a-z]{4,24}-[a-z]{4,24}(?:-[a-z]{4,24})?$/.test(locator)) {
    return locator;
  }
  throw new RangeError('invitation locator must be an opaque code or a two- or three-word alias');
}

function invitationAlias(
  value: string,
  visibility: InvitationVisibility,
): string {
  let alias: string;
  try {
    alias = invitationLocator(value);
  } catch (error) {
    throw responseDecode(safeErrorMessage(error));
  }
  const wordCount = alias.split('-').length;
  const expectedWords = visibility === 'public' ? 2 : 3;
  if (wordCount !== expectedWords) {
    throw responseDecode(
      `${visibility} invitation share_alias must contain ${expectedWords} words`,
    );
  }
  return alias;
}

function opaqueJoinCode(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw new RangeError('joinCode must be an opaque delegated join credential');
  }
  return value;
}

function redemptionJoinCode(options: RedeemInvitationOptions): string | undefined {
  for (const value of [options.joinCode, options.secret]) {
    if (value !== undefined && !(value instanceof SecretToken)) throw new TypeError('joinCode must be a SecretToken');
  }
  const primary = options.joinCode?.exposeSecret();
  const compatibility = options.secret?.exposeSecret();
  if (primary !== undefined && compatibility !== undefined && primary !== compatibility) {
    throw new RangeError('joinCode and deprecated secret alias disagree');
  }
  const value = primary ?? compatibility;
  return value === undefined ? undefined : opaqueJoinCode(value);
}

function decodedOpaqueJoinCode(payload: JsonObject): string {
  try { return opaqueJoinCode(requiredString(payload, 'join_code')); }
  catch { throw responseDecode('control-plane join_code must be an opaque delegated credential'); }
}

function requiredExpiry(payload: JsonObject): string {
  const value = requiredString(payload, 'expires_at');
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw responseDecode('control-plane expires_at must be an RFC 3339 timestamp');
  }
  return value;
}

function invitationUrl(
  payload: JsonObject,
  field: 'join_url' | 'share_url',
  expectedPath: string,
  joinCode: string,
): SecretUrl | null {
  const value = optionalString(payload, field);
  if (value === null || value.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw responseDecode(`control-plane ${field} must be an absolute URL`);
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== expectedPath ||
    parsed.search.length > 0
  ) {
    throw responseDecode(`control-plane ${field} has an invalid receiver URL`);
  }
  if (joinFragmentCode(parsed.hash) !== joinCode) {
    throw responseDecode(`control-plane ${field} does not contain its delegated join credential`);
  }
  try {
    return new SecretUrl(parsed.href);
  } catch (error) {
    throw responseDecode(safeErrorMessage(error));
  }
}

function joinFragmentCode(hash: string): string {
  const parameters = new URLSearchParams(hash.slice(1));
  const keys: string[] = [];
  parameters.forEach((_value, key) => keys.push(key));
  const values = parameters.getAll('join');
  if (keys.some((key) => key !== 'join') || values.length !== 1) {
    throw responseDecode('control-plane invitation fragment must contain one join credential');
  }
  try { return opaqueJoinCode(values[0] as string); }
  catch { throw responseDecode('control-plane invitation fragment contains an invalid join credential'); }
}

function transportUrl(
  payload: JsonObject,
  field: string,
  protocols: readonly string[],
): string {
  return validatedTransportUrl(requiredString(payload, field), field, protocols);
}

function validatedTransportUrl(
  value: string,
  field: string,
  protocols: readonly string[],
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw responseDecode(`control-plane ${field} must be an absolute URL`);
  }
  if (
    !protocols.includes(parsed.protocol) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw responseDecode(`control-plane ${field} is invalid`);
  }
  return parsed.href;
}
