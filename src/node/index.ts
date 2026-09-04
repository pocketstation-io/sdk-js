/**
 * Native desktop audio capture and Session composition for Node.js.
 *
 * @packageDocumentation
 */
export { PocketStationError } from './errors.js';
export {
  Endpoint,
  RunningSession,
  Session,
  Stem,
  type SessionOptions,
  type StopResult,
} from './session.js';
export { Source } from './sources.js';
export {
  AudioStream,
  type AudioFrame,
  type AudioReadOptions,
} from './streams.js';
