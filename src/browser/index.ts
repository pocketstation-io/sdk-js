/**
 * Receive one selected PocketStation Relay AudioBus in a web browser.
 *
 * @packageDocumentation
 */
export { PocketStationError } from '../errors.js';
export { RelayReceiver, resolveRelayInvitation } from './relay-session.js';
export type {
  RelayClientMessage,
  RelayInvitation,
  RelayPlayoutObservation,
  RelayReceiverAccess,
  RelayReceiverOptions,
  RelayReceiverState,
  RelayServerMessage,
  RelaySessionState,
} from './types.js';
