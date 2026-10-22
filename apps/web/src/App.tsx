import { Toaster } from "sonner";
import { EditorProvider } from "./context/EditorContext";
import { PlaybackProvider } from "./context/PlaybackContext";
import { EditorLayout } from "./editor/EditorLayout";
import ErrorBoundary from "./ErrorBoundary";
import SongImport from "./editor/LoadSongDialog";

export default function App() {
  return (
    <>
      <Toaster
        position="bottom-right"
        theme="system"
        closeButton
        duration={15000}
      />
      <EditorProvider>
        <SongImport />
        <PlaybackProvider>
          <ErrorBoundary>
            <EditorLayout />
          </ErrorBoundary>
        </PlaybackProvider>
      </EditorProvider>
    </>
  );
}
