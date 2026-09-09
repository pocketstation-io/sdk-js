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
