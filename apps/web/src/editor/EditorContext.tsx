import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import { api } from "../api";

export type LyricLine = { id: string; index: number; text: string };
export type Segment = { line_id: string; start_ms: number; end_ms: number };

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

type EditorState = {
  status: "loading" | "ready" | "error";
  track: EditorTrack | null;
  error: string | null;
  selectedLineId: string | null;
  retryCount: number;
};

type EditorAction =
  | { type: "loadSuccess"; payload: TrackPayload }
  | { type: "loadFailure"; error: string }
  | { type: "retry" }
  | { type: "selectLine"; id: string | null };

const initialState: EditorState = {
  status: "loading",
  track: null,
  error: null,
  selectedLineId: null,
  retryCount: 0,
};

function reducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "loadSuccess": {
      const { duration_seconds, alignment, ...track } = action.payload;
      return {
        ...state,
        status: "ready",
        error: null,
        selectedLineId: null,
        track: {
          ...track,
          lines: [...track.lines].sort((a, b) => a.index - b.index),
          durationMs: Math.round(duration_seconds * 1000),
          segments: alignment?.segments ?? [],
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
  }
}

const StateContext = createContext<EditorState | undefined>(undefined);
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

  return (
    <DispatchContext.Provider value={dispatch}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
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
