import { EditorProvider } from './editor/EditorContext';
import { EditorLayout } from './editor/EditorLayout';

export default function App() {
  return <EditorProvider><EditorLayout /></EditorProvider>;
}
