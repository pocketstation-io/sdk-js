# Sources and permissions

A Source identifies the audio PocketStation should open when a Session starts.
Declaration does not prompt for permission and does not open a device.

## Application audio

`Source.application(value)` accepts:

- an exact display name or native application ID;
- a positive process ID;
- a stable application identity returned by discovery;
- a process ID paired with its discovered stable identity.

Exact matching rejects ambiguity. A process ID is temporary and should not be
stored between application launches. Prefer a discovered stable identity when
an application needs to persist a selection.

## Exact application process sets

Some desktop applications use several audio processes. When a caller already
owns an exact process boundary, observe process incarnations and explicitly
select every required member:

```ts
import { discoverProcessInstances, Session } from "pocketstation/node";

async function declareSelectedApplication(authorizedProcessIds: ReadonlySet<number>) {
  const observed = await discoverProcessInstances();
  const selected = observed.filter((member) => authorizedProcessIds.has(member.processId));
  if (selected.length !== authorizedProcessIds.size) {
    throw new Error("Rediscover the complete selected process set before capture");
  }
  const session = new Session({ sampleRateHz: 48_000, channels: 2 });
  const application = session.captureProcessSet(selected);
  application.send(session.audio());
  return session;
}
```

`authorizedProcessIds` is the caller's explicit selection, not a browser name,
volume ranking or a permission supplied by discovery. Discovery does not grant
capture access. It returns immutable `ObservedProcessInstance` values with a
process ID, application `stableId` and `processStartTimeNs` bigint. Keep the
original observation; do not replace its start time when opening capture.
Use `discoverSources()` for names and current source states, joined by platform,
kind, stable key and PID. A silent selected process is still part of the scope.
Discovery may not observe every intended process. Require a complete join;
never silently omit a missing intended member from the selection.

`Session.captureProcessSet()` accepts 1–32 distinct application processes on
one platform. It copies and canonicalizes the observations before native
declaration. At native opening, every selected identity and start observation
must still match. The native tap includes only those original members, never
additional processes with the same name, application identity or new PID.
It does not promise individual browser-tab isolation.

The result is the existing `SourceOutput`: use its normal `send`, `connect`,
`through`, `publish`, `record` and `retainAudio` operations. Core assigns one
source and stream identity to the complete selection; it does not pretend the
set is one of its individual members. Normal Session startup, cancellation,
bounded delivery and checked finalization still apply.

This additive capability initially requires macOS 26 or later and a native
capture build. Strict process capture requires the native ability to disable
automatic process restoration; older macOS releases retain their existing
single-process/application selectors. Older native addons and unsupported
platforms report `CaptureError` with
`capture.unsupported`; there is no fallback to one member, a wider application
identity or the desktop mix. A successful declaration is not evidence that
permission, source admission, publication or remote audio decoding succeeded.
Use a fresh Session and fresh observations for any explicit rebind.

If startup reports `capture.cleanup_unconfirmed`, native rollback could not
confirm that an opened capture closed. Keep the selected source reserved and
surface recovery; do not treat the rejected start as permission to open a
competing capture. This code differs from ordinary source unavailability or a
permission rejection. Likewise, inspect the normal stop result for runtime or
capture-finalization failures before releasing a running source claim.

## Microphone audio

`Source.defaultMicrophone()` follows the host's current default input when the
Session opens. `Source.microphone(deviceId)` selects the stable device ID
returned by discovery. PocketStation does not silently fall back to another
microphone when an explicit device disappears.

Read permission without prompting:

```ts
import { microphonePermissionObservation } from "pocketstation/node";

const permission = await microphonePermissionObservation();
```

`not-observable` is not treated as `allowed`. The desktop application should
explain why it needs audio, request the operating-system permission from a
user action, and retry with a new Session after the permission changes.

## System audio

`Source.systemAudio()` requests the computer's complete desktop mix. Use it
only when the product needs everything the user can hear. Selected-application
capture provides a smaller privacy scope for most transcription and agent
workflows.

## Source failure

If an application exits or a device disappears, `running.events` reports the
failed Source and whether rediscovery is required. PocketStation keeps the
identity of the failed Stem and never substitutes another application or
device without an explicit new declaration.

See [Source identity and media time](source-identity-and-time.md) and
[Troubleshooting](../troubleshooting.md).
