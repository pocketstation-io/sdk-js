import { jest } from '@jest/globals';
import {
  CaptureError,
  Session,
  SessionDeclarationError,
  SessionStartError,
  SourceOutput,
  discoverProcessInstances,
  type ObservedProcessInstance,
} from '../node/index.js';
import {
  nativeAddon,
  type NativeObservedProcessInstance,
  type NativeSessionHandle,
} from '../node/native.js';
import { nativeProcessSetMembers } from '../node/sources.js';

function observed(processId = 10, stableKey = 'root'): ObservedProcessInstance {
  return {
    processId,
    stableId: { platform: 'macos', kind: 'application', stableKey },
    processStartTimeNs: 18_446_744_073_709_551_615n,
  };
}

function replaceProperty(target: object, key: string, value: unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, value });
  return () => {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  };
}

function nativeSessionPrototype(): object {
  return (nativeAddon().NativeSession as unknown as { prototype: object }).prototype;
}

describe('exact application process-set declaration', () => {
  it('copies and canonicalizes all members without rounding start-time observations', () => {
    const first = observed(20, 'audio helper');
    const second = observed(10, 'browser root');
    const original = [first, second];
    const projected = nativeProcessSetMembers(original);
    expect(projected.map((member) => member.processId)).toEqual([10, 20]);
    expect(original).toEqual([first, second]);
    expect(projected[0]).toEqual({
      processId: 10, platform: 'macos', kind: 'application', stableKey: 'browser root',
      processStartTimeNs: '18446744073709551615',
    });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(projected.every(Object.isFrozen)).toBe(true);
    (second as { processStartTimeNs: bigint }).processStartTimeNs = 1n;
    (second.stableId as { stableKey: string }).stableKey = 'replacement';
    original.length = 0;
    expect(projected[0]?.stableKey).toBe('browser root');
    expect(projected[0]?.processStartTimeNs).toBe('18446744073709551615');
    expect(projected).toHaveLength(2);
  });

  it.each([
    null, {}, [], Array(1), Array.from({ length: 33 }, (_, i) => observed(i + 1)),
    [null], [{ ...observed(), processId: 0 }], [{ ...observed(), processId: -1 }],
    [{ ...observed(), processId: 1.5 }], [{ ...observed(), processId: '10' }],
    [{ ...observed(), processId: true }], [{ ...observed(), processId: NaN }],
    [{ ...observed(), processId: Infinity }], [{ ...observed(), processId: 2_147_483_648 }],
    [{ ...observed(), processStartTimeNs: 0n }],
    [{ ...observed(), processStartTimeNs: -1n }],
    [{ ...observed(), processStartTimeNs: 1 }],
    [{ ...observed(), processStartTimeNs: '1' }],
    [{ ...observed(), processStartTimeNs: 18_446_744_073_709_551_616n }],
    [{ ...observed(), stableId: { platform: 'macos', kind: 'input-device', stableKey: 'mic' } }],
    [{ ...observed(), stableId: { platform: 'macos', kind: 'application', stableKey: ' ' } }],
    [{ ...observed(), stableId: { platform: 'bogus', kind: 'application', stableKey: 'root' } }],
    [observed(), observed()],
    [observed(), observed(10, 'different identity')],
    [observed(), { ...observed(11), stableId: { platform: 'windows', kind: 'application', stableKey: 'root' } }],
  ])('rejects invalid or ambiguous selections before native dispatch: %p', (selection) => {
    const capture = jest.fn();
    const restore = replaceProperty(nativeSessionPrototype(), 'captureProcessSet', capture);
    try {
      const session = new Session();
      expect(() => session.captureProcessSet(selection as never)).toThrow(SessionDeclarationError);
      expect(capture).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('accepts both declared bounds and all 32 distinct members', () => {
    expect(nativeProcessSetMembers([{ ...observed(1), processStartTimeNs: 1n }])[0]?.processId).toBe(1);
    expect(nativeProcessSetMembers([observed(2_147_483_647)])[0]?.processId).toBe(2_147_483_647);
    expect(nativeProcessSetMembers(Array.from({ length: 32 }, (_, index) => observed(index + 1)))).toHaveLength(32);
  });

  it('reads only the bounded indexed selection instead of a caller-supplied iterator', () => {
    const selected = [observed(42)];
    const iterator = jest.fn(function* () { yield observed(99, 'outside selection'); });
    selected[Symbol.iterator] = iterator;
    expect(nativeProcessSetMembers(selected).map((member) => member.processId)).toEqual([42]);
    expect(iterator).not.toHaveBeenCalled();
  });

  it('fails closed with an older native addon instead of selecting one member or a wider identity', () => {
    const restore = replaceProperty(nativeSessionPrototype(), 'captureProcessSet', undefined);
    try {
      expect(() => new Session().captureProcessSet([observed()])).toThrow(
        expect.objectContaining({ code: 'capture.unsupported', name: 'CaptureError' }),
      );
    } finally {
      restore();
    }
  });

  it('uses the existing SourceOutput wrapper and keeps Session ownership checks', () => {
    const send = jest.fn(() => '91');
    const capture = jest.fn(function (this: NativeSessionHandle, _members: readonly NativeObservedProcessInstance[]) {
      return {
        sessionId: this.id, sourceInstanceId: '11', sourceId: '12', streamId: '13',
        outputPort: 'audio', send,
      };
    });
    const restore = replaceProperty(nativeSessionPrototype(), 'captureProcessSet', capture);
    try {
      const session = new Session();
      const output = session.captureProcessSet([observed(20, 'helper'), observed(10)]);
      expect(output).toBeInstanceOf(SourceOutput);
      expect(output.sessionId).toBe(session.id);
      expect([output.sourceInstanceId, output.sourceId, output.streamId]).toEqual([11n, 12n, 13n]);
      expect(output.outputPort).toBe('audio');
      expect(output.send(session.audio())).toBe(91n);
      expect(() => output.send(new Session().audio())).toThrow('different Sessions');
      expect(send).toHaveBeenCalledTimes(1);
      expect(capture.mock.calls[0]?.[0].map((member) => member.processId)).toEqual([10, 20]);
      expect(Object.isFrozen(capture.mock.calls[0]?.[0])).toBe(true);
    } finally {
      restore();
    }
  });

  it('retains native failure codes without attempting an alternate selector', () => {
    const capture = jest.fn(() => { throw new Error('capture.source_unavailable|one original process exited'); });
    const restore = replaceProperty(nativeSessionPrototype(), 'captureProcessSet', capture);
    try {
      expect(() => new Session().captureProcessSet([observed()])).toThrow(
        expect.objectContaining({ code: 'capture.source_unavailable', name: 'CaptureError' }),
      );
      expect(capture).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it('preserves structured startup cleanup uncertainty without treating it as a clean rejection', async () => {
    const takeRunning = jest.fn();
    const start = jest.fn(async () => ({
      failure: {
        code: 'capture.cleanup_unconfirmed',
        message: 'The original selected capture could not be confirmed closed',
      },
      takeRunning,
    }));
    const restore = replaceProperty(nativeSessionPrototype(), 'start', start);
    try {
      const failure = await new Session().start().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(SessionStartError);
      expect(failure).toMatchObject({ code: 'capture.cleanup_unconfirmed' });
      expect(takeRunning).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe('exact process-incarnation discovery', () => {
  it('retains lossless start-time and identity observations in immutable public values', async () => {
    const member = {
      processId: 42, platform: 'macos', kind: 'application', stableKey: 'audio helper',
      processStartTimeNs: '18446744073709551615',
    };
    const restore = replaceProperty(nativeAddon(), 'discoverProcessInstances', async () => [member]);
    try {
      const result = await discoverProcessInstances();
      expect(result).toEqual([observed(42, 'audio helper')]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result[0])).toBe(true);
      expect(Object.isFrozen(result[0]?.stableId)).toBe(true);
      member.stableKey = 'replacement';
      expect(result[0]?.stableId.stableKey).toBe('audio helper');
    } finally {
      restore();
    }
  });

  it('distinguishes no observed processes from an unsupported addon', async () => {
    let restore = replaceProperty(nativeAddon(), 'discoverProcessInstances', async () => []);
    try {
      await expect(discoverProcessInstances()).resolves.toEqual([]);
    } finally {
      restore();
    }
    restore = replaceProperty(nativeAddon(), 'discoverProcessInstances', undefined);
    try {
      await expect(discoverProcessInstances()).rejects.toBeInstanceOf(CaptureError);
      await expect(discoverProcessInstances()).rejects.toMatchObject({ code: 'capture.unsupported' });
    } finally {
      restore();
    }
  });

  it.each([null, {}, [null], Array(1), [{ processStartTimeNs: '1.5' }], [{ processStartTimeNs: 1 }], [{ processStartTimeNs: '0' }]])(
    'refuses malformed native observations: %p', async (members) => {
      const restore = replaceProperty(nativeAddon(), 'discoverProcessInstances', async () => members);
      try {
        await expect(discoverProcessInstances()).rejects.toBeInstanceOf(SessionDeclarationError);
      } finally {
        restore();
      }
    },
  );
});
