import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useEditorState } from "./EditorContext";

type PlaybackSnapshot = {
  positionMs: number;
  playing: boolean;
  ready: boolean;
};

function createPlaybackStore() {
  let audio: HTMLAudioElement | null = null;
  let frame: number | null = null;
  let snapshot: PlaybackSnapshot = {
    positionMs: 0,
    playing: false,
    ready: false,
  };
  const listeners = new Set<() => void>();
  const events = [
    "play",
    "playing",
    "pause",
    "seeking",
    "seeked",
    "timeupdate",
    "ended",
    "loadedmetadata",
    "durationchange",
    "emptied",
    "error",
  ] as const;

  function getCurrentTimeMs() {
    const time = audio?.currentTime ?? 0;
    return Number.isFinite(time) ? Math.max(0, Math.round(time * 1000)) : 0;
  }

  function publish() {
    const positionMs = getCurrentTimeMs();
    const playing = !!audio && !audio.paused && !audio.ended && !audio.error;
    const ready =
      !!audio &&
      audio.readyState >= 1 &&
      Number.isFinite(audio.duration) &&
      audio.duration > 0 &&
      !audio.error;
    if (
      positionMs === snapshot.positionMs &&
      playing === snapshot.playing &&
      ready === snapshot.ready
    )
      return;
    snapshot = { positionMs, playing, ready };
    listeners.forEach((listener) => listener());
  }

  function stopFrame() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function tick() {
    frame = null;
    publish();
    if (snapshot.playing) frame = requestAnimationFrame(tick);
  }

  function synchronize() {
    publish();
    if (snapshot.playing) {
      if (frame === null) frame = requestAnimationFrame(tick);
    } else {
      stopFrame();
    }
  }

  // A stable callback ref owns listeners and animation cleanup, including when
  // React replaces the audio element or unmounts the playback session.
  function attachAudio(element: HTMLAudioElement | null) {
    stopFrame();
    if (audio) {
      events.forEach((event) => audio?.removeEventListener(event, synchronize));
      audio.pause();
    }
    audio = element;
    if (audio) {
      events.forEach((event) => audio?.addEventListener(event, synchronize));
    }
    synchronize();
  }

  return {
    attachAudio,
    getCurrentTimeMs,
    getReady: () => snapshot.ready,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async play() {
      await audio?.play();
    },
    pause() {
      audio?.pause();
    },
    seek(positionMs: number) {
      if (!audio || !snapshot.ready || !Number.isFinite(positionMs)) return;
      const durationMs = audio.duration * 1000;
      audio.currentTime = Math.max(0, Math.min(positionMs, durationMs)) / 1000;
      synchronize();
    },
  };
}

const PlaybackContext = createContext<ReturnType<
  typeof createPlaybackStore
> | null>(null);

function PlaybackSession({ children }: { children: ReactNode }) {
  const [store] = useState(createPlaybackStore);
  return (
    <PlaybackContext.Provider value={store}>
      {children}
    </PlaybackContext.Provider>
  );
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const { track } = useEditorState();
  // Save responses replace track data, but keep the same playback session.
  const identity = JSON.stringify([track?.id, track?.audio_url]);
  return <PlaybackSession key={identity}>{children}</PlaybackSession>;
}

export function usePlaybackControls() {
  const store = useContext(PlaybackContext);
  if (!store)
    throw new Error("Playback hooks must be used within PlaybackProvider");
  return store;
}

export function usePlaybackState() {
  const store = usePlaybackControls();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

export function usePlaybackReady() {
  const store = usePlaybackControls();
  return useSyncExternalStore(store.subscribe, store.getReady, store.getReady);
}
