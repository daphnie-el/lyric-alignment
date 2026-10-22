import { Toaster } from "sonner";
import { EditorProvider } from "./context/EditorContext";
import { PlaybackProvider } from "./context/PlaybackContext";
import { useTheme } from "./context/ThemeContext";
import { EditorLayout } from "./editor/EditorLayout";
import SongImport from "./editor/LoadSongDialog";
import ErrorBoundary from "./error-boundary";

export default function App() {
  const { theme } = useTheme();
  return (
    <>
      <Toaster
        position="bottom-right"
        theme={theme}
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
