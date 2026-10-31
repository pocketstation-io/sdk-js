# Platform support

The package contains native Node support for macOS, Windows, and Linux, but a
source implementation and a published prebuilt package are separate claims.

Current evidence for JavaScript package 0.1.6:

| Area | Status |
|---|---|
| macOS arm64/x64 Node addons and installed consumers | `REAL` for qualification component cases |
| macOS selected-application physical capture | `REAL-DEVICE-PROVEN` for the recorded host |
| macOS microphone physical capture | `REAL-DEVICE-PROVEN` in the recorded Relay/browser and multistem workflow |
| Windows and Linux Node packages | `REAL` for installed component cases; physical capture remains unproven |
| Browser Relay receiver | `REAL` for same-host Chromium, Firefox, and WebKit receipt; WAN, TURN, and physical hearing remain unproven |
| npm installation | `REAL`; 0.1.6 is published and its six target packages passed clean installed-consumer qualification |

Desktop capture permissions belong to the host executable. On macOS, the
terminal or desktop application running Node must receive the applicable
microphone and system-audio permission. Windows and Linux permission and audio
session behavior must be verified in the application environment that ships
the addon.

Do not infer cross-platform performance from a successful macOS run. Target
packages, physical devices, latency, WAN behavior, TURN, and physical hearing
must each pass their own qualification.

The same-host Relay proof captures a physical microphone and a selected
application, publishes both as independent AudioBuses, receives both in
Chromium, Firefox, and WebKit, and finalizes two recordings without active
delivery loss. It does not establish those results on Windows or Linux.
