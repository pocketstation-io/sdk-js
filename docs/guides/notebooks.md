# Run PocketStation from a notebook

Use the notebook when you want to inspect live source identity, delivery, and
recording results while you develop an audio workflow. It runs the installed
Node package through Deno's Jupyter kernel. Capture, routing, Relay publication,
and recording still execute in the PocketStation Rust engine.

The included notebook captures one application. It leaves the microphone,
recording, and Relay off until you enable them.

## Install the kernel and package

Install Deno 2.9.6 and Jupyter, then register Deno's kernel:

```bash
deno jupyter --install
```

Deno currently marks the Jupyter command as unstable. PocketStation therefore
qualifies the exact runtime version used by its notebook test instead of
promising compatibility with every Deno release.

Install a packed PocketStation archive in the directory where you will open the
notebook:

```bash
npm install /path/to/pocketstation-0.1.4.tgz
```

The notebook imports `pocketstation/node` from that installation. It does not
import the SDK source tree.

Open [capture-and-share.ipynb](../../examples/notebooks/capture-and-share.ipynb)
and select the Deno kernel. Running the configuration cell asks for the exact
name, application ID, or process ID of a running desktop application.

## Add the microphone or recording

The configuration cell keeps both off. Change the microphone setting only when
you want both sides of a conversation. Use a stable device ID when the
operating-system default can change. Set a new recording directory when you
want PocketStation to write one WAV file per Stem.

The host that starts Jupyter owns capture permission. On macOS, grant microphone
and system-audio access to that host before relying on an unattended notebook
run. Read [Choose Sources and handle permissions](../concepts/sources-and-permissions.md)
for discovery and permission behavior.

## Publish to Relay

Keep Relay credentials outside the notebook. Set the values returned by your
PocketStation control service before starting Jupyter:

```bash
export POCKETSTATION_RELAY_URL=http://127.0.0.1:4800
export POCKETSTATION_RELAY_SESSION_ID=<session-id>
export POCKETSTATION_RELAY_SOURCE_TOKEN=<source-token>
```

When all three values are present, the notebook publishes `application` and,
when requested, `microphone` as separate AudioBuses. Supplying only part of the
Relay configuration fails before capture begins.

## Understand the result

The notebook sends each Stem to a small Connector that counts frames without
retaining their samples. That Connector gives each Source a 32-frame queue, or
up to 640 ms at the notebook's 20 ms frame duration, because notebook kernels
can briefly pause JavaScript while rendering cell output. A full queue rejects
the arriving frame and records a discontinuity. Relay publication and recording
use their own native delivery queues and are not delayed by this setting.

The final output includes:

- the Source identities observed by the Connector;
- live Core queue and delivery measurements;
- the terminal Session result;
- one result for each requested recording.

The notebook does not prove that a person heard browser output. Same-host Relay
receipt, WAN delivery, TURN, physical hearing, and target-specific native
packages remain separate measurements.

Notebook execution is arbitrary code execution. Review a notebook before you
run it, do not commit credentials into cells or outputs, and do not expose an
unprotected Jupyter server to a network.
