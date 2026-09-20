import { PocketStationError } from '../errors.js';
import {
  immutableStrings,
  requireBoolean,
  requireNonEmpty,
} from './validation.js';

/** Cleanup and recovery facts attached to one voice failure. */
export interface VoiceErrorOptions {
  readonly stage: string;
  readonly providerId?: string;
  readonly cleanedUp?: readonly string[];
  readonly inputRemainsActive?: boolean;
  readonly nextAction?: string;
  readonly cause?: unknown;
}

/** Base error with cleanup and recovery facts for one voice operation. */
export class VoiceError extends PocketStationError {
  public readonly stage: string;
  public readonly providerId: string | undefined;
  public readonly cleanedUp: readonly string[];
  public readonly inputRemainsActive: boolean;
  public readonly nextAction: string | undefined;

  public constructor(
    message: string,
    options: VoiceErrorOptions,
    code = 'voice.error',
  ) {
    requireNonEmpty('stage', options.stage);
    if (options.providerId !== undefined) {
      requireNonEmpty('providerId', options.providerId);
    }
    requireBoolean(
      'inputRemainsActive',
      options.inputRemainsActive ?? false,
    );
    super(code, message, { cause: options.cause });
    this.name = 'VoiceError';
    this.stage = options.stage;
    this.providerId = options.providerId;
    this.cleanedUp = immutableStrings(options.cleanedUp ?? []);
    this.inputRemainsActive = options.inputRemainsActive ?? false;
    this.nextAction = options.nextAction;
  }
}

/** Declared voice components cannot form one valid conversation. */
export class VoiceConfigurationError extends VoiceError {
  public constructor(
    message: string,
    options: VoiceErrorOptions,
    code = 'voice.invalid_configuration',
  ) {
    super(message, options, code);
    this.name = 'VoiceConfigurationError';
  }
}

/** A selected provider did not receive a required credential. */
export class MissingProviderCredentialError extends VoiceConfigurationError {
  public constructor(message: string, options: VoiceErrorOptions) {
    super(message, options, 'voice.missing_provider_credential');
    this.name = 'MissingProviderCredentialError';
  }
}

/** A provider failed before the conversation became ready. */
export class ProviderStartupError extends VoiceError {
  public constructor(message: string, options: VoiceErrorOptions) {
    super(message, options, 'voice.provider_startup');
    this.name = 'ProviderStartupError';
  }
}

/** A provider operation exceeded its configured deadline. */
export class ProviderTimeoutError extends VoiceError {
  public constructor(message: string, options: VoiceErrorOptions) {
    super(message, options, 'voice.provider_timeout');
    this.name = 'ProviderTimeoutError';
  }
}

/** A provider could not serve the requested voice operation. */
export class ProviderUnavailableError extends VoiceError {
  public constructor(message: string, options: VoiceErrorOptions) {
    super(message, options, 'voice.provider_unavailable');
    this.name = 'ProviderUnavailableError';
  }
}

/** A provider cannot satisfy a required composition capability. */
export class UnsupportedVoiceCapabilityError extends VoiceConfigurationError {
  public constructor(message: string, options: VoiceErrorOptions) {
    super(message, options, 'voice.unsupported_capability');
    this.name = 'UnsupportedVoiceCapabilityError';
  }
}
