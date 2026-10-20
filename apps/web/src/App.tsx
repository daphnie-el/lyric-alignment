import { Toaster } from "sonner";
import ErrorBoundary from "./ErrorBoundary";
import { EditorProvider } from "./editor/EditorContext";
import { EditorLayout } from "./editor/EditorLayout";
import { PlaybackProvider } from "./editor/PlaybackContext";

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
        <PlaybackProvider>
          <ErrorBoundary>
            <EditorLayout />
          </ErrorBoundary>
        </PlaybackProvider>
      </EditorProvider>
    </>
  );
}
