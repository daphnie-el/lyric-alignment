import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import { ApiError, api } from "../api";
import { toast } from "sonner";
import {
  DEFAULT_DURATION_MS,
  normalizeSegments,
  placeSegment,
  type Segment,
} from "./timing";

export type LyricLine = { id: string; index: number; text: string };
export type { Segment } from "./timing";

export type TrackPayload = {
  id: string;
  title: string;
  artist: string;
  duration_seconds: number;
  audio_url: string;
  lines: LyricLine[];
  version: number;
  alignment: { segments: Segment[] } | null;
};

export type EditorTrack = Omit<
  TrackPayload,
  "duration_seconds" | "alignment"
> & {
  durationMs: number;
  segments: Segment[];
};

export type SaveAlignmentRequest = {
  version: number;
  lines: LyricLine[];
  segments: Segment[];
};
export type SaveAlignmentResponse = Pick<
  TrackPayload,
  "version" | "lines" | "alignment"
>;

// Compare persisted values, independent of server array order or history depth.
function contentSnapshot(lines: LyricLine[], segments: Segment[]): string {
  return JSON.stringify({
    lines: [...lines]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, index, text }) => ({ id, index, text })),
    segments: [...segments]
      .sort((a, b) => a.line_id.localeCompare(b.line_id))
      .map(({ line_id, start_ms, end_ms }) => ({ line_id, start_ms, end_ms })),
  });
}

function hasUnsavedChanges(
  state: Pick<EditorState, "track" | "savedContent">,
): boolean {
  return (
    !!state.track &&
    contentSnapshot(state.track.lines, state.track.segments) !==
      state.savedContent
  );
}

type EditorState = {
  status: "loading" | "ready" | "error";
  track: EditorTrack | null;
  error: string | null;
  selectedLineId: string | null;
  retryCount: number;
  timingError: string | null;
  saving: boolean;
  saveError: string | null;
  savedContent: string | null;
  interacting: boolean;
  past: Segment[][];
  future: Segment[][];
};
type updateSegmentPayload = {
  lineId: string;
  field: "start_ms" | "end_ms";
  value: number | undefined;
};

type EditorAction =
  | { type: "undo" | "redo" }
  | { type: "saveStart" }
  | { type: "saveFailure"; error: string }
  | { type: "interaction"; active: boolean }
  | { type: "loadSuccess"; payload: TrackPayload }
  | { type: "loadFailure"; error: string }
  | { type: "retry" }
  | { type: "selectLine"; id: string | null }
  | { type: "removeSegment"; lineId: string }
  | { type: "updateSegment"; payload: updateSegmentPayload }
  | { type: "addLine"; lineId: string }
  | { type: "insertSegment"; lineId: string; startMs: number }
  | { type: "moveSegment"; lineId: string; startMs: number }
  | {
      type: "resizeSegment";
      lineId: string;
      field: "start_ms" | "end_ms";
      value: number;
    };

const initialState: EditorState = {
  status: "loading",
  track: null,
  error: null,
  selectedLineId: null,
  retryCount: 0,
  timingError: null,
  saving: false,
  saveError: null,
  savedContent: null,
  interacting: false,
  past: [],
  future: [],
};

const HISTORY_LIMIT = 100;

function reducer(state: EditorState, action: EditorAction): EditorState {
  // Guard every editing path, including keyboard and queued interaction events.
  if (state.saving && !["loadSuccess", "saveFailure"].includes(action.type))
    return state;
  switch (action.type) {
    case "interaction":
      return { ...state, interacting: action.active };
    case "saveStart":
      if (
        state.status !== "ready" ||
        state.interacting ||
        !hasUnsavedChanges(state)
      )
        return state;
      return { ...state, saving: true, saveError: null };
    case "saveFailure":
      return { ...state, saving: false, saveError: action.error };
    case "undo":
    case "redo": {
      if (!state.track) return state;
      const source = action.type === "undo" ? state.past : state.future;
      const segments = source.at(-1);
      if (!segments) return state;
      return {
        ...state,
        timingError: null,
        track: { ...state.track, segments },
        past:
          action.type === "undo"
            ? state.past.slice(0, -1)
            : [...state.past, state.track.segments].slice(-HISTORY_LIMIT),
        future:
          action.type === "redo"
            ? state.future.slice(0, -1)
            : [...state.future, state.track.segments].slice(-HISTORY_LIMIT),
      };
    }
    case "loadSuccess": {
      const { duration_seconds, alignment, ...track } = action.payload;
      const durationMs = Math.round(duration_seconds * 1000);
      const normalized = normalizeSegments(
        alignment?.segments ?? [],
        durationMs,
        new Set(track.lines.map((line) => line.id)),
      );
      if (normalized.error)
        return {
          ...state,
          status: "error",
          error: `Invalid alignment: ${normalized.error}`,
          track: null,
          saving: false,
          saveError: null,
          savedContent: null,
          past: [],
          future: [],
        };
      return {
        ...state,
        timingError: null,
        saving: false,
        saveError: null,
        interacting: false,
        savedContent: contentSnapshot(track.lines, alignment?.segments ?? []),
        past: [],
        future: [],
        status: "ready",
        error: null,
        selectedLineId: null,
        track: {
          ...track,
          lines: [...track.lines].sort((a, b) => a.index - b.index),
          durationMs,
          segments: normalized.segments!,
        },
      };
    }
    case "loadFailure":
      return { ...state, status: "error", error: action.error };
    case "retry":
      return { ...initialState, retryCount: state.retryCount + 1 };
    case "selectLine":
      if (
        action.id !== null &&
        !state.track?.lines.some((line) => line.id === action.id)
      )
        return state;
      return { ...state, selectedLineId: action.id };
    case "removeSegment": {
      if (
        !state.track ||
        !state.track.lines.some((line) => line.id === action.lineId)
      )
        return state;
      const segments = state.track.segments.filter(
        (segment) => segment.line_id !== action.lineId,
      );
      const changed = segments.length !== state.track.segments.length;
      return {
        ...state,
        selectedLineId: null,
        timingError: null,
        track: changed ? { ...state.track, segments } : state.track,
        past: changed
          ? [...state.past, state.track.segments].slice(-HISTORY_LIMIT)
          : state.past,
        future: changed ? [] : state.future,
      };
    }
    case "addLine":
    case "insertSegment":
    case "moveSegment":
    case "resizeSegment":
    case "updateSegment": {
      if (!state.track) return state;
      const track = state.track;
      const lineId =
        action.type === "updateSegment" ? action.payload.lineId : action.lineId;
      if (!track.lines.some((line) => line.id === lineId)) return state;
      const existing = track.segments.find(
        (segment) => segment.line_id === lineId,
      );
      if (action.type === "addLine" && existing)
        return { ...state, selectedLineId: lineId, timingError: null };
      if (action.type === "insertSegment" && existing)
        return {
          ...state,
          timingError: "This lyric is already on the timeline.",
        };
      let candidate: Segment;
      if (action.type === "addLine" || action.type === "insertSegment") {
        const start =
          action.type === "addLine"
            ? Math.max(0, ...track.segments.map((s) => s.end_ms))
            : action.startMs;
        candidate = {
          line_id: lineId,
          start_ms: start,
          end_ms: start + DEFAULT_DURATION_MS,
        };
      } else {
        if (!existing) return state;
        if (action.type === "moveSegment") {
          candidate = {
            ...existing,
            start_ms: action.startMs,
            end_ms: action.startMs + existing.end_ms - existing.start_ms,
          };
        } else {
          const { field, value } =
            action.type === "updateSegment" ? action.payload : action;
          if (value === undefined)
            return {
              ...state,
              timingError: "Both timing endpoints are required.",
            };
          candidate = { ...existing, [field]: value };
        }
      }
      const result = placeSegment(track.segments, candidate, track.durationMs);
      if (result.error) return { ...state, timingError: result.error };
      const segments = result.segments!;
      const changed =
        segments.length !== track.segments.length ||
        segments.some((segment, index) => {
          const previous = track.segments[index];
          return (
            !previous ||
            segment.line_id !== previous.line_id ||
            segment.start_ms !== previous.start_ms ||
            segment.end_ms !== previous.end_ms
          );
        });
      return {
        ...state,
        selectedLineId: lineId,
        timingError: null,
        track: changed ? { ...track, segments } : track,
        past: changed
          ? [...state.past, track.segments].slice(-HISTORY_LIMIT)
          : state.past,
        future: changed ? [] : state.future,
      };
    }
  }
}

const StateContext = createContext<
  (EditorState & { unsavedChanges: boolean }) | undefined
>(undefined);
const DispatchContext = createContext<Dispatch<EditorAction> | undefined>(
  undefined,
);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  useEffect(() => {
    const controller = new AbortController();
    api<TrackPayload>("/api/v1/track", { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted)
          dispatch({ type: "loadSuccess", payload });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          dispatch({
            type: "loadFailure",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => controller.abort();
  }, [state.retryCount]);

  const unsavedChanges = useMemo(
    () =>
      hasUnsavedChanges({
        track: state.track,
        savedContent: state.savedContent,
      }),
    [state.track, state.savedContent],
  );
  const contextState = useMemo(
    () => ({ ...state, unsavedChanges }),
    [state, unsavedChanges],
  );
  useEffect(() => {
    if (!unsavedChanges) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [unsavedChanges]);

  const { saving, track } = state;
  useEffect(() => {
    if (!saving || !track) return;
    const controller = new AbortController();
    const body: SaveAlignmentRequest = {
      version: track.version,
      lines: track.lines,
      segments: track.segments,
    };
    api<SaveAlignmentResponse>("/api/v1/track/alignment", {
      method: "PUT",
      body: JSON.stringify(body),
      signal: controller.signal,
    })
      .then((saved) => {
        if (!controller.signal.aborted) {
          dispatch({
            type: "loadSuccess",
            payload: {
              ...track,
              duration_seconds: track.durationMs / 1000,
              ...saved,
            },
          });
          toast.success("Changes saved successfully");
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          error instanceof ApiError && error.status === 409
            ? "Another session saved a newer version. Your changes are still here and have not been saved. Review the latest version in another tab before deciding whether to reload and discard your changes."
            : "Could not save your changes. Your changes are still here and remain unsaved. Check your connection and try Save again.";
        dispatch({ type: "saveFailure", error: message });
      });
    return () => controller.abort();
  }, [saving, track]);

  return (
    <DispatchContext.Provider value={dispatch}>
      <StateContext.Provider value={contextState}>
        {children}
      </StateContext.Provider>
    </DispatchContext.Provider>
  );
}

export function useEditorState() {
  const state = useContext(StateContext);
  if (state === undefined)
    throw new Error("useEditorState must be used within EditorProvider");
  return state;
}

export function useEditorDispatch() {
  const dispatch = useContext(DispatchContext);
  if (dispatch === undefined)
    throw new Error("useEditorDispatch must be used within EditorProvider");
  return dispatch;
}
