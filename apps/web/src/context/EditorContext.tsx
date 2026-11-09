import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from "react";
import { useSaveAlignment } from "../hooks/useSaveAlignment";
import { useLoadTrack } from "../hooks/useLoadTrack";
import { useSongImport } from "../hooks/useSongImport";
import {
  HISTORY_LIMIT,
  commitSegments,
  contentSnapshot,
  hasUnsavedChanges,
  historyEntry,
} from "../utils/helpers";
import type { SaveConflict } from "../utils/saveConflict";
import { splitLyricText } from "../utils/splitLyric";
import {
  moveSegments,
  normalizeSegments,
  placeSegment,
  stampSegment,
  timingError,
} from "../utils/timing";
import {
  DEFAULT_DURATION_MS,
  EditorState,
  HistoryEntry,
  Segment,
  TrackPayload,
  updateSegmentPayload,
} from "../utils/types";
import { SongImportContext } from "./SongImportContext";

type EditorAction =
  | { type: "undo" | "redo" }
  | { type: "saveStart"; exportAfterSave?: boolean }
  | { type: "saveFailure"; error: string; conflict?: SaveConflict }
  | { type: "replaceServer" | "reloadLatest" | "retryRecovery" }
  | { type: "interaction"; active: boolean }
  | { type: "loadSuccess"; payload: TrackPayload }
  | { type: "loadEmpty" }
  | { type: "loadFailure"; error: string }
  | { type: "retry" }
  | { type: "selectLine"; id: string | null }
  | {
      type: "restoreSelection";
      trackId: string;
      selectedLineId: string | null;
      selectedTimelineIds: string[];
    }
  | { type: "toggleTimelineLine"; id: string }
  | { type: "moveSegments"; lineIds: string[]; offsetMs: number }
  | { type: "removeSegment"; lineId: string }
  | { type: "removeSegments"; lineIds: string[] }
  | { type: "addLine"; id: string; text: string }
  | { type: "mergeWithNext"; lineId: string }
  | {
      type: "splitLine";
      lineId: string;
      newId: string;
      afterWord: number;
      splitMs?: number;
    }
  | { type: "addLines"; lines: { id: string; text: string }[] }
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
    }
  | {
      type: "editLine";
      lineId: string;
      text: string;
    }
  | {
      type: "deleteLine";
      lineId: string;
    };

export const initialState: EditorState = {
  status: "loading",
  track: null,
  error: null,
  selectedLineId: null,
  selectedTimelineIds: [],
  retryCount: 0,
  timingError: null,
  saving: false,
  exportAfterSave: false,
  saveError: null,
  saveConflict: null,
  saveOperation: "save",
  saveVersion: null,
  savedContent: null,
  interacting: false,
  past: [],
  future: [],
};

export function reducer(state: EditorState, action: EditorAction): EditorState {
  // Guard every editing path, including keyboard and queued interaction events.
  if (
    state.saving &&
    !["loadSuccess", "loadEmpty", "saveFailure"].includes(action.type)
  )
    return state;
  switch (action.type) {
    case "stampLine": {
      const track = state.track;
      if (!track || state.status !== "ready" || state.interacting) return state;
      const lineId =
        action.lineId ??
        state.selectedLineId ??
        track.lines.find(
          (line) =>
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
      if (!result.segments) return { ...state, timingError: result.error };
      const selected = action.advance
        ? (track.lines[index + 1]?.id ?? null)
        : lineId;
      return commitSegments(state, result.segments, selected);
    }
    case "interaction":
      return state.interacting === action.active
        ? state
        : { ...state, interacting: action.active };
    case "replaceServer":
      if (
        !state.track ||
        state.interacting ||
        state.saveConflict?.kind !== "version"
      )
        return state;
      return {
        ...state,
        saving: true,
        saveOperation: "save",
        saveVersion: state.saveConflict.snapshot.version,
        saveError: null,
        exportAfterSave: false,
      };
    case "reloadLatest":
    case "retryRecovery":
      if (!state.saveConflict || state.interacting) return state;
      return {
        ...state,
        saving: true,
        saveOperation: action.type === "reloadLatest" ? "reload" : "recover",
        saveError: null,
        exportAfterSave: false,
      };
    case "saveStart":
      if (
        state.status !== "ready" ||
        state.saveConflict ||
        state.interacting ||
        !hasUnsavedChanges(state)
      )
        return state;
      return {
        ...state,
        saving: true,
        saveOperation: "save",
        saveVersion: null,
        saveError: null,
        exportAfterSave: action.exportAfterSave ?? false,
      };
    case "saveFailure":
      return {
        ...state,
        saving: false,
        exportAfterSave: false,
        saveError: action.error,
        saveConflict: action.conflict ?? state.saveConflict,
        saveVersion: null,
      };
    case "undo":
    case "redo": {
      if (!state.track) return state;
      const source = action.type === "undo" ? state.past : state.future;
      const entry: HistoryEntry | undefined = source.at(-1);
      if (!entry) return state;
      const { lines, segments } = entry;
      const selectedTimelineIds = state.selectedTimelineIds.filter((id) =>
        segments.some((segment) => segment.line_id === id),
      );
      const selectedLineId =
        !lines.some((line) => line.id === state.selectedLineId) ||
        (state.selectedTimelineIds.length > 1 &&
          !selectedTimelineIds.includes(state.selectedLineId ?? ""))
          ? (selectedTimelineIds.at(-1) ?? null)
          : state.selectedLineId;
      return {
        ...state,
        timingError: null,
        selectedTimelineIds,
        selectedLineId,
        track: { ...state.track, lines, segments },
        past:
          action.type === "undo"
            ? state.past.slice(0, -1)
            : [...state.past, historyEntry(state.track)].slice(-HISTORY_LIMIT),
        future:
          action.type === "redo"
            ? state.future.slice(0, -1)
            : [...state.future, historyEntry(state.track)].slice(
                -HISTORY_LIMIT,
              ),
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
          exportAfterSave: false,
          saveError: null,
          savedContent: null,
          past: [],
          future: [],
        };
      return {
        ...state,
        timingError: null,
        saving: false,
        exportAfterSave: false,
        saveError: null,
        interacting: false,
        saveConflict: null,
        saveVersion: null,
        saveOperation: "save",
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
    case "loadEmpty":
      return { ...initialState, status: "empty", retryCount: state.retryCount };
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
        selectedTimelineIds:
          action.id &&
          state.track?.segments.some((segment) => segment.line_id === action.id)
            ? [action.id]
            : [],
      };
    case "restoreSelection": {
      if (state.track?.id !== action.trackId) return state;
      const track = state.track;
      return {
        ...state,
        selectedLineId: track.lines.some(
          (line) => line.id === action.selectedLineId,
        )
          ? action.selectedLineId
          : null,
        selectedTimelineIds: action.selectedTimelineIds.filter((id) =>
          track.segments.some((segment) => segment.line_id === id),
        ),
      };
    }
    case "toggleTimelineLine": {
      if (!state.track?.segments.some((s) => s.line_id === action.id))
        return state;
      const selectedTimelineIds = state.selectedTimelineIds.includes(action.id)
        ? state.selectedTimelineIds.filter((id) => id !== action.id)
        : [...state.selectedTimelineIds, action.id];
      return {
        ...state,
        selectedTimelineIds,
        selectedLineId: selectedTimelineIds.includes(action.id)
          ? action.id
          : (selectedTimelineIds.at(-1) ?? null),
      };
    }
    case "moveSegments": {
      if (!state.track) return state;
      const result = moveSegments(
        state.track.segments,
        action.lineIds,
        action.offsetMs,
        state.track.durationMs,
      );
      if (result.error) return { ...state, timingError: result.error };
      return commitSegments(
        state,
        result.segments!,
        state.selectedLineId,
        state.selectedTimelineIds,
      );
    }
    case "removeSegments": {
      if (!state.track || state.interacting || !action.lineIds.length)
        return state;
      const ids = new Set(action.lineIds);
      const segments = state.track.segments.filter(
        (segment) => !ids.has(segment.line_id),
      );
      if (segments.length === state.track.segments.length) return state;
      return commitSegments(state, segments, null, []);
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
          ? [...state.past, historyEntry(state.track)].slice(-HISTORY_LIMIT)
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
              timingError: `Please provide the ${field === "start_ms" ? "start at" : "end at"} time.`,
            };
          candidate = { ...existing, [field]: value };
        }
      }
      const result = placeSegment(track.segments, candidate, track.durationMs);
      if (result.error) return { ...state, timingError: result.error };
      return commitSegments(state, result.segments!, lineId);
    }
    case "addLine":
    case "addLines": {
      const track = state.track;
      if (!track || state.status !== "ready" || state.interacting) return state;
      const additions = (
        action.type === "addLine" ? [action] : action.lines
      ).map(({ id, text }) => ({ id, text: text.trim() }));
      if (!additions.length) return state;
      const ids = new Set(track.lines.map((line) => line.id));
      for (const line of additions) {
        if (!line.text || !line.id.trim() || ids.has(line.id)) return state;
        ids.add(line.id);
      }
      const index = track.lines.reduce(
        (next, line) => Math.max(next, line.index + 1),
        0,
      );
      return {
        ...state,
        selectedLineId: additions[0].id,
        selectedTimelineIds: [],
        timingError: null,
        track: {
          ...track,
          lines: [
            ...track.lines,
            ...additions.map((line, offset) => ({
              ...line,
              index: index + offset,
            })),
          ],
        },
        past: [...state.past, historyEntry(track)].slice(-HISTORY_LIMIT),
        future: [],
      };
    }
    case "splitLine": {
      const track = state.track;
      if (
        !track ||
        state.status !== "ready" ||
        state.interacting ||
        state.selectedLineId !== action.lineId ||
        state.selectedTimelineIds.length > 1 ||
        !action.newId.trim() ||
        track.lines.some((line) => line.id === action.newId)
      )
        return state;
      const position = track.lines.findIndex(
        (line) => line.id === action.lineId,
      );
      const original = track.lines[position];
      if (!original) return state;
      const parts = splitLyricText(original.text, action.afterWord);
      if (!parts) return state;
      const segment = track.segments.find(
        (item) => item.line_id === original.id,
      );
      const splitMs = action.splitMs;
      if (
        segment &&
        (splitMs === undefined ||
          !Number.isSafeInteger(splitMs) ||
          splitMs <= segment.start_ms ||
          splitMs >= segment.end_ms)
      )
        return {
          ...state,
          timingError:
            "Choose a split time after the start time and before the end time.",
        };
      const lines = [
        ...track.lines.slice(0, position),
        { ...original, text: parts[0] },
        { id: action.newId, index: original.index + 1, text: parts[1] },
        ...track.lines.slice(position + 1).map((line, offset) => ({
          ...line,
          index: original.index + 2 + offset,
        })),
      ];
      const segments =
        segment && splitMs !== undefined
          ? track.segments.flatMap((item) =>
              item.line_id === original.id
                ? [
                    { ...item, end_ms: splitMs },
                    {
                      line_id: action.newId,
                      start_ms: splitMs,
                      end_ms: item.end_ms,
                    },
                  ]
                : [item],
            )
          : track.segments;
      return {
        ...state,
        track: { ...track, lines, segments },
        selectedLineId: original.id,
        selectedTimelineIds: segment ? [original.id] : [],
        timingError: null,
        past: [...state.past, historyEntry(track)].slice(-HISTORY_LIMIT),
        future: [],
      };
    }
    case "mergeWithNext": {
      const track = state.track;
      if (
        !track ||
        state.status !== "ready" ||
        state.interacting ||
        state.selectedLineId !== action.lineId ||
        state.selectedTimelineIds.length > 1
      )
        return state;
      const index = track.lines.findIndex((line) => line.id === action.lineId);
      const selected = track.lines[index];
      const incoming = track.lines[index + 1];
      if (!selected || !incoming) return state;
      const selectedSegment = track.segments.find(
        (segment) => segment.line_id === selected.id,
      );
      const incomingSegment = track.segments.find(
        (segment) => segment.line_id === incoming.id,
      );
      const mergedSegment: Segment | undefined = selectedSegment
        ? {
            ...selectedSegment,
            end_ms: incomingSegment?.end_ms ?? selectedSegment.end_ms,
          }
        : incomingSegment
          ? { ...incomingSegment, line_id: selected.id }
          : undefined;
      if (mergedSegment) {
        const error = timingError(mergedSegment, track.durationMs);
        if (error) return { ...state, timingError: error };
        if (
          track.segments.some(
            (segment) =>
              segment.line_id !== selected.id &&
              segment.line_id !== incoming.id &&
              segment.start_ms < mergedSegment.end_ms &&
              segment.end_ms > mergedSegment.start_ms,
          )
        )
          return {
            ...state,
            timingError: "Merging these lyrics would overlap another line.",
          };
      }
      const lines = track.lines
        .filter((line) => line.id !== incoming.id)
        .map((line) =>
          line.id === selected.id
            ? {
                ...line,
                text: `${selected.text.trimEnd()}, ${incoming.text.trimStart()}`,
              }
            : line,
        );
      // Replace timing in place so unrelated segments retain their values and order.
      const segments = track.segments.flatMap((segment) => {
        if (segment.line_id === selected.id)
          return mergedSegment ? [mergedSegment] : [];
        if (segment.line_id === incoming.id)
          return !selectedSegment && mergedSegment ? [mergedSegment] : [];
        return [segment];
      });
      return {
        ...state,
        track: { ...track, lines, segments },
        selectedLineId: selected.id,
        selectedTimelineIds: mergedSegment ? [selected.id] : [],
        timingError: null,
        past: [...state.past, historyEntry(track)].slice(-HISTORY_LIMIT),
        future: [],
      };
    }
    case "editLine": {
      if (!state.track) return state;
      const track = state.track;
      const lineIndex = track.lines.findIndex(
        (line) => line.id === action.lineId,
      );
      if (lineIndex === -1) return state;
      if (track.lines[lineIndex].text === action.text) return state;
      const updatedLines = [...track.lines];
      updatedLines[lineIndex] = {
        ...updatedLines[lineIndex],
        text: action.text,
      };
      return {
        ...state,
        track: { ...track, lines: updatedLines },
        past: [...state.past, historyEntry(track)].slice(-HISTORY_LIMIT),
        future: [],
      };
    }
    case "deleteLine": {
      if (!state.track) return state;
      const track = state.track;
      const lineIndex = track.lines.findIndex(
        (line) => line.id === action.lineId,
      );
      if (lineIndex === -1) return state;
      const updatedLines = [...track.lines];
      updatedLines.splice(lineIndex, 1);
      const updatedSegments = track.segments.filter(
        (segment) => segment.line_id !== action.lineId,
      );
      return {
        ...state,
        selectedLineId: null,
        selectedTimelineIds: [],
        timingError: null,
        track: { ...track, lines: updatedLines, segments: updatedSegments },
        past: [...state.past, historyEntry(track)].slice(-HISTORY_LIMIT),
        future: [],
      };
    }
  }
}

const StateContext = createContext<
  | (EditorState & { unsavedChanges: boolean; editingLocked: boolean })
  | undefined
>(undefined);
const DispatchContext = createContext<Dispatch<EditorAction> | undefined>(
  undefined,
);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [state, reducerDispatch] = useReducer(reducer, initialState);
  const importLockRef = useRef(false);
  const dispatch = useCallback<Dispatch<EditorAction>>((action) => {
    if (!importLockRef.current) reducerDispatch(action);
  }, []);
  const onStored = useCallback((payload: TrackPayload) => {
    // Only the import workflow may replace the document while import is locked.
    reducerDispatch({ type: "loadSuccess", payload });
  }, []);
  const songImport = useSongImport({
    track: state.track,
    canImport:
      state.status !== "loading" && !state.saving && !state.interacting,
    importLockRef,
    onStored,
  });
  const { importing } = songImport;

  const onLoadSuccess = useCallback(
    (payload: TrackPayload) => {
      dispatch({ type: "loadSuccess", payload });
    },
    [dispatch],
  );

  const onLoadEmpty = useCallback(() => {
    dispatch({ type: "loadEmpty" });
  }, [dispatch]);

  const onLoadFailure = useCallback(
    (error: string) => {
      dispatch({ type: "loadFailure", error });
    },
    [dispatch],
  );

  useLoadTrack({
    retryCount: state.retryCount,
    onSuccess: onLoadSuccess,
    onEmpty: onLoadEmpty,
    onFailure: onLoadFailure,
  });

  const unsavedChanges = useMemo(
    () =>
      hasUnsavedChanges({
        track: state.track,
        savedContent: state.savedContent,
      }),
    [state.track, state.savedContent],
  );
  const contextState = useMemo(
    () => ({
      ...state,
      unsavedChanges,
      editingLocked: state.saving || importing,
    }),
    [state, unsavedChanges, importing],
  );
  useEffect(() => {
    if (!unsavedChanges && !importing) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [unsavedChanges, importing]);

  const onSaveFailure = useCallback(
    (error: string, conflict?: SaveConflict) => {
      dispatch({ type: "saveFailure", error, conflict });
    },
    [dispatch],
  );

  useSaveAlignment({
    saving: state.saving,
    track: state.track,
    operation: state.saveOperation,
    version: state.saveVersion,
    exportAfterSave: state.exportAfterSave,
    onSuccess: onLoadSuccess,
    onEmpty: onLoadEmpty,
    onFailure: onSaveFailure,
  });

  return (
    <DispatchContext.Provider value={dispatch}>
      <StateContext.Provider value={contextState}>
        <SongImportContext.Provider value={songImport}>
          {children}
        </SongImportContext.Provider>
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
