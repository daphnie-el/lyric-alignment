# Implementation decisions

## 1. Editor shell and Context foundation (initial implementation)

- Follow the wireframe's toolbar, lyrics, timeline, inspector, and readout regions. Use existing Tailwind utilities and theme variables so the shell respects the current light/dark theme without adding dependencies.
- Keep loaded track data, request status, and lyric selection in a reducer, exposed through separate state and dispatch contexts. Transient controls and native audio playback do not need global state yet.
- Normalize API duration from seconds to integer milliseconds on load. Retain API line identifiers, saved segments, and version; derive selection details instead of duplicating them in state.
- Start without a selected line. The readout explicitly previews the selection rather than claiming playback synchronization. The initial timeline placeholder has since been replaced by the editable timeline described below.
- Initially defer audio import, waveform decoding, timing edits, saving, export, and synchronized karaoke. Timeline timing edits are now implemented; the other deferred capabilities remain outside this change.
- On desktop, constrain pane heights and scroll the lyric list independently. On narrow screens, stack panes in document order and bound the lyric list height so the other regions remain reachable.
- Abort obsolete track requests during cleanup and retry; keep errors and retry inside the shell so the layout remains usable when the API is unavailable.

## 2. Draggable lyrics and editable timeline: user choices and agent implementation decisions

### Behavior requested or explicitly selected by the user

- Make lyrics draggable and the timeline droppable. Reject duplicate placements by lyric identity; clicking an unplaced lyric adds it, while clicking a placed lyric selects it.
- Give newly placed lyrics a default duration of 3 seconds. Click-to-add appends after the last block, starting at zero on an empty timeline.
- Keep the exact drop time and prevent overlaps by pushing conflicting blocks forward only as far as needed, cascading through subsequent conflicts while preserving their durations.
- Reject the entire edit if its result would exceed the audio duration; preserve the previous timings.
- Allow moving timeline blocks and resizing both edges, updating `start_ms` and `end_ms`.
- Apply the same non-overlap rules to inspector edits and require complete, positive-duration timings stored as integer milliseconds.
- Repair saved overlaps on load by shifting later blocks forward. Show an alignment error if repair cannot fit inside the audio.

### Implementation choices proposed by the agent and approved in the plan

- Use the installed `@dnd-kit/react` for dragging and dropping, and centralize timing validation and ripple calculations in pure functions invoked through editor reducer actions. This keeps interaction paths consistent without changing the API segment shape.
- Preserve duration and the pointer grab offset when moving a block. Require a minimum duration of 1 ms; moving or shrinking leaves vacated gaps open.
- Derive block positions and widths from millisecond timings and the timeline scale. Provide horizontal scrolling, zoom controls, and placement previews so users can inspect edits before committing.
- Support keyboard adjustments of 100 ms with arrow keys and 1 second with Shift. Cancelled gestures leave committed timings unchanged.
- Synchronize inspector fields after timeline edits and ripple shifts. Treat invalid saved endpoints, unknown lyric references, or duplicate saved lyric identities as alignment errors.
- Keep changes in editor memory. Saving, waveform rendering, and lyric-sheet editing remain outside this task.

The user selected the behavior above through the original request and clarification answers. The agent proposed the implementation details in the plan, which the user explicitly approved for implementation.

## 3. Manual timeline saving

Saving supersedes the earlier in-memory-only scope recorded above.

### Decisions made by the user

- Add a Save button to the timeline using the existing API structure.
- Store the returned version after every successful save.
- Show user-friendly failure feedback, allowing either an error or a toast.
- Use `loadSuccess` to clear selection and undo history after saving.
- Show an unsaved-changes indicator and warn before closing or reloading with unsaved changes.
- Pause editing while a save is in progress; the user explicitly selected this option when asked.
- Emphasize Unsaved changes beside the Timeline heading with a border and danger color.
- Document the work and distinguish user decisions from agent decisions.
- Prevent duplicate submissions and saving during active drag or resize gestures. Enforce the editing pause in both controls and reducer actions while retaining zoom and audio playback.

### Implementation choices proposed by the agent and approved in the plan

- Send `{ version, lines, segments }` through the existing authenticated PUT endpoint, including an empty segment array when all placements are removed. Combine the returned version, lines, and alignment with track metadata before dispatching `loadSuccess`; clear both undo and redo history.
- Compare current persisted content with a saved baseline independently of history. Undoing back to the baseline clears the unsaved state; selection, zoom, rejected edits, and cancelled gestures do not mark changes. Repairs made during loading count as unsaved changes.
- Read the latest committed state when saving so inspector edits committed on blur are included.
- Use persistent accessible inline alerts rather than toasts. Preserve local edits, selection, history, and version after failures; version conflicts do not automatically load or overwrite server state.
- Register the browser's native leave confirmation only while content is unsaved, including during saving. Warning text and availability depend on the browser.
- Keep saving manual; autosave and local draft recovery are outside this change.
- Add Playwright coverage for save payloads, consecutive versions, empty timelines, history reset, dirty-state tracking, loading repairs, failures, conflicts, pending-save controls, active resizing, and reload warnings. Validate with typecheck, lint, and a production build.

### Details chosen by the agent during implementation

- Use a rounded badge with padding, medium-weight text, and a tinted background, drawing on the existing danger theme colors for light and dark modes.
- Choose the exact status and error messages, including guidance to review the latest version in another tab after a conflict.
- Organize save lifecycle and baseline state in the editor provider, add typed request/response interfaces and reducer guards, and memoize the derived unsaved state.
- Document usage, API behavior, failure handling, and verification in `decisions.md`, linked from the README and this decision log.

## 4. Audio playback alignment — Stage 1

- Use the existing theme color for a thin playhead and marker, with pointer events disabled so existing drag and resize interactions remain available. Expose current time as labelled text without a live announcement on every frame.
- Add browser tests using a generated silent WAV with a different duration, lyric count, and identifiers. This exercises the real media clock and native keyboard controls rather than simulating playback events.
- Timeline click-to-seek, keyboard seeking, and stamping remain for the next review stages.
- Verification: typecheck, lint, and production build passed. All three playback browser tests passed, along with the 29 existing timeline and save tests. Playback tests cover native Space play/pause, paused seeking, track completion, zoom/scroll positioning, unchanged selection, clean save state, and playback continuity after saving.

## 5. Audio playback alignment — Stage 2

### Implementation decisions made by the agent

- Convert pointer position relative to the full canvas rectangle to integer milliseconds and clamp it to the track bounds. The playback store also clamps seeks to the audio's actual duration.
- Require a primary pointer click that starts outside blocks and previews. Invalidate that click after more than four pixels of movement, pointer cancellation, or an editing gesture. This prevents a completed gesture's click from seeking while allowing the next ordinary click.
- Put the native seek slider in its own subscribing component, retaining isolated playback updates. Use a 100 ms step and leave arrow, Home, End, and other range interactions to the browser.
- Track audio metadata readiness in the playback store. Disable the slider and ignore seek commands until audio has a finite positive duration; metadata failure does not create a pretend seek position.
- Extend real-audio browser coverage for paused and playing seeks, zoom/scroll coordinates, native keyboard boundaries, unavailable audio, and gesture isolation.

## 6. Audio playback alignment — Stage 3

This stage supersedes the earlier click-to-append behavior recorded below.

### Choices approved by the user

- Add a Stamp current time button and Space stamping from the editor background. Preserve native activation in focused controls, including lyric buttons.
- Stamp the selected line, or the first untimed line if nothing is selected, and advance in sheet order. Clicking an untimed lyric stamps it without advancing; clicking a timed lyric only selects it.
- Close the previously stamped line at the next consecutive stamp, treating both changes and any ripple as one undo step. Keep the newest line at three seconds initially, or its existing duration when restamping, shortened at the track end.
- Reset consecutive stamping after seeking, selection, other timing edits, undo/redo, saving, or a track change. Rejected stamps preserve selection, timings, and history.

### Implementation decisions made by the agent

- Put placement, previous-line closure, validation, and ripple in a pure timing helper. Remove the target's old placement before closing the previous line so it cannot cause a false overflow. Commit successful results through the same history helper as other timing edits.
- Store only the previous stamped line and its seek version in transient editor state. Increment the playback store's seek version on both app seek commands and native seeking events, so seek resets need no editor updates on clock ticks.
- Read the actual audio time once per action through stable playback commands. The Stamp control subscribes only to readiness; lyric items do not subscribe to frame updates. Block commands when audio is unavailable, saving is pending, or an editing gesture is active.
- Disable Space activation in the drag sensor so focused lyric buttons use their native click behavior. Ignore repeats, composing input, modifier combinations, prevented events, and keys from interactive or editable elements in the background shortcut.
- Use `aria-current` to identify editing selection: the installed drag library owns and overwrites `aria-pressed` with drag state. Update the lyric selection styling to match, making the next stamping target visible and accessible.
- Prevent the timeline scroller from shrinking when the new controls wrap. Its blocks must remain visible and reachable below the ruler.
- Share the real silent-audio browser fixture across playback and timing tests. Update click-placement expectations to playback-time placement and allow a shortened last segment. Keep API payloads, manual save behavior, and selection-preview karaoke unchanged.
- Verification: typecheck, lint, production build, and whitespace checks pass. All 15 playback/stamping checks pass. The complete browser suite has 52 passes and the same existing Save-button width failure recorded in Stage 2 (about 59 px idle versus 82 px with the spinner). Desktop and mobile editor screenshots were generated by the interaction tests; the desktop layout was visually inspected after fixing the timeline compression.

## 7. Stamped ends follow lyric-sheet neighbors

This supersedes Stage 3's provisional three-second duration and consecutive-stamp tracking.

- The user chose sheet order, skipping untimed lyrics: a stamp ends at the next timed lyric's start minus 1 ms, or at track end if there is no later timed lyric. The nearest earlier timed lyric ends at the new start minus 1 ms, including after seeking, selecting, or saving.
- Use a pure `stampSegment` helper with ordered lyric IDs. Build a segment lookup, construct sheet order, and validate the result with linear scans: O(lines + segments) time and memory, with no sorting, ripple, or input mutation.
- Require at least 2 ms between the stamped start and adjacent timed starts so the 1 ms gap leaves positive durations. Reject conflicts atomically; keep selection, history, and all other starts unchanged.
- Treat every timed lyric as an anchor. Stamping replaces the affected ends even when they were manually trimmed; other ends retain their values. Reject remaining sheet-order conflicts from manual edits rather than silently moving or rewriting other lines.
- Remove previous-stamp state and seek versions. Keep one undo step for both affected boundaries, the existing API payload, and native keyboard behavior.
- Manual dragging, resizing, and inspector edits keep their existing rules. Drag placement retains its three-second default; loading existing alignments does not apply the new stamp rule.
- Verification: all 8 stamping tests pass, covering sheet order, skipped lines, exact gaps, two-millisecond spacing, invalid stamps, immutability, atomic undo/redo, seeking, native keyboard behavior, and saving. Typecheck, lint, production build, and whitespace checks pass. The full suite has 52 passes and the existing Save-button width failure (59 px idle versus 82 px with its spinner).

##6. Timeline placement removal and bulk deletion

### Choices made explicitly by the user

- Delete removes timeline placements while keeping the lyric text. The user explicitly requested `removeSegment`, correcting the agent's initial interpretation that Delete should remove the lyric line itself.
- Initially, the user selected “Focused block” when asked what to remove from a multiple selection. The later request to implement bulk removal supersedes that choice: Delete or Backspace on a focused, selected block now removes all selected placements.
- Support removing 100 selected placements efficiently, preserving history so one Undo restores the entire removal and one Redo reapplies it.
- Treat empty or entirely unmatched ID lists as no-ops, returning the same state and preserving redo. Duplicate IDs are naturally deduplicated by the `Set`. Successful removal clears selection; Undo restores placements without restoring selection.

### Implementation choices proposed by the agent and approved by the user

- Dispatch one `removeSegments` action carrying the selected IDs. Build one `Set` and filter the segment array once: O(n + k) removal work for n placements and k selected IDs.
- Reuse `commitSegments` for one history commit and redo invalidation. Keep immutable references to unchanged segment objects and lyric arrays, including the previous array in history. Deep cloning and a separate history system were unnecessary; retained arrays still consume memory within the existing 100-entry history limit.
- Preserve the existing single-placement `removeSegment` action for inspector controls. Adding a bulk action avoids changing the inspector's established behavior.
- Keep Delete and the existing Backspace shortcut in the focused block's keyboard handler, with saving, drag/resize, dropping, and composition guards. Prevent default behavior and propagation for a handled shortcut. A global shortcut was unnecessary for the approved focused-block interaction.

### Details chosen by the agent during implementation

- Add a reducer-level interaction guard as well as the keyboard guards so a bulk action cannot change placements during an active gesture. The existing reducer guard already blocks edits while saving.
- Export the existing reducer and initial state for direct browser-based tests of state identity, structural sharing, history, and duplicate IDs. This adds module exports without changing API requests or persisted data.
- Exercise the real UI with 101 placements: select 100, remove them with Backspace, verify the remaining placement's timing and all lyric text, then Undo and Redo. Update the earlier focused-block-only test to expect full-selection removal.

### Assumptions, trade-offs, and verification limits

- The brief did not set a latency target. The agent chose a linear removal algorithm and a functional 100-selection test; no claim of a measured deletion latency or benchmark is made. Rendering, selection, and dirty-state calculation have their own costs beyond the removal algorithm.
- Retain the current snapshot history design rather than introducing inverse-operation patches, workers, virtualization, or a new store. Those would add complexity without evidence that this 100-placement operation needs them.
- Backspace support existed before the bulk change and was retained, rather than introduced as an additional unsolicited shortcut. Selection clearing, no-op handling, and reference reuse originated in the agent's proposal and were explicitly approved in the implementation plan.

##8. LRC export with an incomplete-timing warning

### Choices made by the user

- Export lyrics through the existing LRC download helper. “Missing lines” means lyric lines already added to the sheet that have no timeline placement; unadded draft text is outside this warning.
- When some lines are untimed, show their count and ask whether to export only timed lines or keep editing. Export immediately when all lines are timed.
- When exporting unsaved edits, offer Save and export, Export without saving, and Keep editing. Combine this choice with the untimed-line warning when applicable; either export choice includes only timed lines.
- Determine whether saving is needed by comparing current lyric text and timings with the saved baseline through `unsavedChanges`.
- Use `downloadLrc` and `segmentsToLrc`, preserving chronological timestamp ordering, centisecond formatting, and UTF-8 lyric text. Trim the track title and replace filesystem-invalid characters with underscores for the filename; fall back to `lyrics.lrc` for an empty title

### Implementation choices proposed by the agent and approved in the plan

- Read lyrics and segments from the current editor track, including unsaved edits. Match lyric IDs against segment `line_id` values to derive timed and untimed counts without duplicating editor state.
- Use a native modal dialog titled “Some lines aren’t timed yet”, with correctly pluralized counts and “Keep editing” and “Export N timed lines” actions. Initially focus Keep editing, contain keyboard focus, support Escape dismissal, and restore focus to Export LRC on close. Keep modal state local and prevent editor shortcuts from changing the document behind it.
- Disable export when the track is unavailable, no lyrics are timed, or a timeline interaction is active. When no lyrics are timed, show “Time at least one lyric line to export.”
- Reuse `downloadLrc` and `segmentsToLrc`, preserving chronological timestamp ordering, centisecond formatting, and UTF-8 lyric text. Trim the track title and replace filesystem-invalid characters with underscores for the filename; fall back to `lyrics.lrc` for an empty title.
- Keep the existing backend and public data types unchanged. Export does not save or alter editor contents.
- Keep the dialog's initial focus on Keep editing, keyboard focus containment, Escape dismissal, focus restoration, and editor shortcut isolation. Disable export during saving and active timeline interactions; cancellation performs neither saving nor downloading.
