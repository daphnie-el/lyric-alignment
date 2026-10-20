import { Toaster } from "sonner";
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
        duration={4000}
      />
      <EditorProvider>
        <PlaybackProvider>
          <EditorLayout />
        </PlaybackProvider>
      </EditorProvider>
    </>
  );
}
