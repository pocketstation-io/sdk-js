import type { DuplexVoiceCapabilities } from './capabilities.js';
import type { ConversationConfig } from './configuration.js';
import type { ConversationOutcome } from './turns.js';

/** Existing Session values supplied to a stateful duplex provider. */
export class DuplexVoiceContext<
  TSession = unknown,
  TInput = unknown,
  TOutput = unknown,
> {
  public readonly session: TSession;
  public readonly input: TInput;
  public readonly output: TOutput;
  public readonly config: ConversationConfig;

  public constructor(
    session: TSession,
    input: TInput,
    output: TOutput,
    config: ConversationConfig,
  ) {
    this.session = session;
    this.input = input;
    this.output = output;
    this.config = config;
    Object.freeze(this);
  }
}

/** One finite provider connection attached to a PocketStation Session. */
export interface DuplexVoiceConnection<TRunning = unknown> {
  start(running: TRunning): Promise<void>;
  wait(): Promise<ConversationOutcome>;
  interrupt(): Promise<void>;
  cancelOutput(): Promise<void>;
  stop(): void;
  close(): Promise<void>;
}

/** Result returned after declaring a stateful provider connection. */
export type DuplexConnectResult<TRunning = unknown> =
  DuplexVoiceConnection<TRunning>;

/** Declare one stateful provider connection before the Session starts. */
export interface DuplexVoiceModel<
  TSession = unknown,
  TInput = unknown,
  TOutput = unknown,
  TRunning = unknown,
> {
  readonly capabilities: DuplexVoiceCapabilities;
  connect(
    context: DuplexVoiceContext<TSession, TInput, TOutput>,
  ): DuplexConnectResult<TRunning>;
}
