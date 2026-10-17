# Implementation decisions

## Editor shell and Context foundation

- Follow the wireframe's toolbar, lyrics, timeline, inspector, and readout regions. Use existing Tailwind utilities and theme variables so the shell respects the current light/dark theme without adding dependencies.
- Keep loaded track data, request status, and lyric selection in a reducer, exposed through separate state and dispatch contexts. Transient controls and native audio playback do not need global state yet.
- Normalize API duration from seconds to integer milliseconds on load. Retain API line identifiers, saved segments, and version; derive selection details instead of duplicating them in state.
- Start without a selected line. The readout explicitly previews the selection rather than claiming playback synchronization. The timeline is an honest placeholder, with saved timing details visible in the inspector.
- Defer audio import, waveform decoding, timing edits, saving, export, and synchronized karaoke. Disable the corresponding controls rather than imply they work. This is a foundation step, not the complete take-home submission.
- On desktop, constrain pane heights and scroll the lyric list independently. On narrow screens, stack panes in document order and bound the lyric list height so the other regions remain reachable.
- Abort obsolete track requests during cleanup and retry; keep errors and retry inside the shell so the layout remains usable when the API is unavailable.
