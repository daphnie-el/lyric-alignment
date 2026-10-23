# Notes

## Layout scaffolding and Architecture

I used AI to help scaffold a component-based React editor, divided into the toolbar, lyrics pane, timeline, inspector, and playback preview. My choices are described here, while implementation decisions made by the agent are recorded in `decisions.md`.

**Architecture.** Shared editor state lives in `EditorProvider`, managed by a reducer and exposed through separate state and dispatch contexts. Components read the current state and dispatch actions; the reducer applies changes to lyrics, timings, selection, and undo/redo history. Lyrics and timing segments remain separate, linked by line IDs, so selection references existing data rather than duplicating it.

The provider coordinates API requests and normalizes durations from seconds to integer milliseconds when loading data. Timing validation and transformations live in pure helpers shared by timeline and inspector interactions, keeping the same rules across editing methods.

Playback uses a separate provider with a stable store and `useSyncExternalStore`. The native audio element supplies the playback clock, while components displaying playback state subscribe to updates. This keeps frequent clock updates out of editor state, undo history, and save calculations. Playback sessions are keyed by track ID and audio URL so saving preserves playback, while replacing the song resets it.

I separated persisted document content from transient interaction state. Lyrics and timings are saved through the API, while selection, playback, and gesture previews remain client-side. Undo/redo tracks committed content edits, with compound operations recorded as one history step.

**Packages and tooling.** I added:

- **ESLint** for static checks, including React Hooks rules.
- **Tailwind CSS** for utility-based styling and responsive layouts.
- **`@dnd-kit/react`** for draggable lyric blocks and placing them in the timeline drop interactions.
- **`@floating-ui/react`** for tooltip positioning and hover, focus, and dismissal behavior.
- **`@phosphor-icons/react`** for a consistent set of filled icons.
- **Sonner** for toast feedback, including successful saves and audio-loading results.
- **Busboy** for streaming multipart audio uploads on the backend without buffering entire files in memory. i added it to enable users upload local files.

I also installed React best-practice skills from skills.sh to guide coding agents on rendering performance, state usage, and dependency imports.

**Recovery and unsaved work.** I placed an error boundary inside the state providers so a rendering failure can show a retry screen while retaining in-memory editor state. Unsaved content is compared against the saved baseline, with a visible indicator and a native browser warning before closing or reloading. The warning helps prevent accidental loss; it does not persist unsaved edits across reloads.

### Unknown page URL redirects

- All unregistered URL's are redirected to the existing dashboard at `/` instead of showing a 404 screen. i achieved this by Check the pathname before mounting React and use `window.location.replace()` for non-root paths, preserving query parameters and fragments. Replacing the history entry avoids returning to the invalid URL with Back, and delaying mount avoids initializing the editor on that URL.

## Validation

I used logic tests to verify timing rules, stamping, group movement, and LRC serialization, alongside Playwright tests for editing workflows, keyboard interactions, undo/redo, saving, importing, and exporting. API integration tests covered persistence, uploads, and track replacement, while failure scenarios checked that errors, timeouts, and conflicts preserved local work. I also checked responsive layouts, dialog focus behavior, and accessible feedback, and ran TypeScript checks, ESLint, and the production build.

I used **React DevTools Profiler** to record key interactions, including button-based lyric stamping and dragging and dropping timeline blocks. This helped identify unnecessary rendering that functional tests would not reveal.

The initial recording showed all 80 `LyricItem` components rendering on every editor update, even when most rows were unchanged. I applied `React.memo` and passed the editing lock as a prop instead of having each row subscribe to the full editor context, allowing unchanged rows to skip rendering.
In the follow-up recording, total lyric-row renders dropped from 640 to 30, despite twice as many editor updates, and average `LyricsPane` render time decreased from 5.2 ms to 0.8 ms. These measurements demonstrate reduced rendering work in the recorded sessions; they are not a controlled benchmark of overall application performance

## Other key decisions I directed

- **Keep timing edits predictable.** Dropping a lyric preserves its exact drop time and pushes conflicting blocks forward while retaining their durations. If the result exceeds the song’s duration, the whole edit is rejected. Inspector edits follow the same timing rules.

- **Make stamping follow lyric-sheet order.** A stamped line ends just before the next timed lyric, and the nearest earlier timed line ends just before the new stamp. Untimed lines are skipped. This replaced the initial fixed-duration stamping behavior.

- **Separate removing timings from deleting lyrics.** Removing a timeline placement keeps its lyric text available for retiming. Bulk removal is one undoable action, so removing many placements can be reversed together.

- **Make saving explicit and visible.** I chose manual saving, a prominent unsaved-changes indicator, and a warning before leaving with unsaved work. Editing pauses during saving, and a successful save clears selection and undo history.

- **Give users control over save conflicts.** Local work stays available after a version conflict. Users explicitly choose whether to replace the server version or load the latest version.

- **Explain incomplete exports.** Export warns when sheet lyrics remain untimed and offers to export only timed lines. For unsaved changes, users can save and export, export without saving, or keep editing.

- **Keep song loading focused on one current track.** Users can load a device file or direct audio **URL**. Replacing a song also replaces its lyrics and alignment, with a warning and an opportunity to export first.

- **Bring playback into the timeline.** I chose a draggable playhead that pauses running playback during scrubbing and resumes on release. Stop resets playback to zero, and automatic scrolling keeps the playhead visible.

- **Refine the editing controls.** I chose bounded, automatically growing textareas, clearer timing labels, separate field errors, and consistent filled icons with tooltips. Delete retains a visible label when space allows.

.

## Deliberately skipped:

- I delibrately skipped using a waveform, I decided to keep the interface simple.
- I deliberately left out offline sync. I focused on explicit saving, preserving local work after failures, and handling version conflicts.

### Nice to have

- **Offline editing and synchronization**: Persist local drafts and queue changes while offline, then synchronize on reconnection with explicit conflict handling.
- **Audio waveform visualization**: Display the waveform beneath lyric blocks to provide an audio reference when placing and adjusting timing boundaries.
