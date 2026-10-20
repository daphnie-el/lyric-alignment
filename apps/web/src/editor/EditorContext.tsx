import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { ApiError, api } from "../api";
import {
  DEFAULT_DURATION_MS,
  normalizeSegments,
  moveSegments,
  placeSegment,
  stampSegment,
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
  selectedTimelineIds: string[];
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
  | { type: "toggleTimelineLine"; id: string }
  | { type: "moveSegments"; lineIds: string[]; offsetMs: number }
  | { type: "removeSegment"; lineId: string }
  | { type: "updateSegment"; payload: updateSegmentPayload }
  | {
      type: "stampLine";
      lineId?: string;
      startMs: number;
      advance: boolean;
    }
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
  selectedTimelineIds: [],
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

function commitSegments(
  state: EditorState,
  segments: Segment[],
  selectedLineId: string | null,
  selectedTimelineIds = selectedLineId &&
    segments.some((segment) => segment.line_id === selectedLineId)
    ? [selectedLineId]
    : [],
): EditorState {
  const track = state.track;
  if (!track) return state;
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
    selectedLineId,
    selectedTimelineIds,
    timingError: null,
    track: changed ? { ...track, segments } : track,
    past: changed
      ? [...state.past, track.segments].slice(-HISTORY_LIMIT)
      : state.past,
    future: changed ? [] : state.future,
  };
}

function reducer(state: EditorState, action: EditorAction): EditorState {
  // Guard every editing path, including keyboard and queued interaction events.
  if (state.saving && !["loadSuccess", "saveFailure"].includes(action.type))
    return state;
  switch (action.type) {
    case "stampLine": {
      const track = state.track;
      if (!track || state.status !== "ready" || state.interacting) return state;
      const lineId =
        action.lineId ??
        state.selectedLineId ??
        track.lines.find((line) =>
          !track.segments.some((segment) => segment.line_id === line.id),
        )?.id;
      const index = track.lines.findIndex((line) => line.id === lineId);
      if (!lineId || index < 0) return state;
      const result = stampSegment(
        track.segments,
        track.lines.map((line) => line.id),
        lineId,
        action.startMs,
        track.durationMs,
      );
      if (!result.segments)
        return { ...state, timingError: result.error };
      const selected = action.advance
        ? track.lines[index + 1]?.id ?? null
        : lineId;
      return commitSegments(state, result.segments, selected);
    }
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
      const selectedTimelineIds = state.selectedTimelineIds.filter((id) =>
        segments.some((segment) => segment.line_id === id),
      );
      const selectedLineId = state.selectedTimelineIds.length > 1 &&
        !selectedTimelineIds.includes(state.selectedLineId ?? "")
        ? selectedTimelineIds.at(-1) ?? null
        : state.selectedLineId;
      return {
        ...state,
        timingError: null,
        selectedTimelineIds,
        selectedLineId,
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
        selectedTimelineIds: [],
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
      return {
        ...state,
        selectedLineId: action.id,
        selectedTimelineIds: action.id &&
          state.track?.segments.some((segment) => segment.line_id === action.id)
          ? [action.id]
          : [],
      };
    case "toggleTimelineLine": {
      if (!state.track?.segments.some((s) => s.line_id === action.id)) return state;
      const selectedTimelineIds = state.selectedTimelineIds.includes(action.id)
        ? state.selectedTimelineIds.filter((id) => id !== action.id)
        : [...state.selectedTimelineIds, action.id];
      return {
        ...state,
        selectedTimelineIds,
        selectedLineId: selectedTimelineIds.includes(action.id)
          ? action.id
          : selectedTimelineIds.at(-1) ?? null,
      };
    }
    case "moveSegments": {
      if (!state.track) return state;
      const result = moveSegments(
        state.track.segments, action.lineIds, action.offsetMs, state.track.durationMs,
      );
      if (result.error) return { ...state, timingError: result.error };
      return commitSegments(state, result.segments!, state.selectedLineId, state.selectedTimelineIds);
    }
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
        selectedTimelineIds: [],
        timingError: null,
        track: changed ? { ...state.track, segments } : state.track,
        past: changed
          ? [...state.past, state.track.segments].slice(-HISTORY_LIMIT)
          : state.past,
        future: changed ? [] : state.future,
      };
    }
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
      if (action.type === "insertSegment" && existing)
        return {
          ...state,
          timingError: "This lyric is already on the timeline.",
        };
      let candidate: Segment;
      if (action.type === "insertSegment") {
        const start = action.startMs;
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
      return commitSegments(state, result.segments!, lineId);
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

  const alignTrack = useCallback(async (signal: AbortSignal) => {
    if (!track) return;
    const body: SaveAlignmentRequest = {
      version: track.version,
      lines: track.lines,
      segments: track.segments,
    };
    try {
      const saved = await api<SaveAlignmentResponse>("/api/v1/track/alignment", {
        method: "PUT",
        body: JSON.stringify(body),
        signal,
      });
      if (signal.aborted) return;
      dispatch({
        type: "loadSuccess",
        payload: {
          ...track,
          duration_seconds: track.durationMs / 1000,
          ...saved,
        },
      });
      toast.success("Changes saved successfully");
    } catch (error: unknown) {
      if (signal.aborted) return;
      const message =
        error instanceof ApiError && error.status === 409
          ? "Another session saved a newer version. Your changes are still here and have not been saved. Review the latest version."
          : "Could not save your changes. Your changes are still here and remain unsaved. Check your connection and try Save again.";
      dispatch({ type: "saveFailure", error: message });
    }
  }, [track]);

  useEffect(() => {
    if (!saving || !track) return;
    const controller = new AbortController();
    void alignTrack(controller.signal);
    return () => controller.abort();
  }, [saving, track, alignTrack]);

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
