import { createContext, useContext } from "react";
import type { useSongImport } from "../hooks/useSongImport";

export const SongImportContext = createContext<ReturnType<typeof useSongImport> | null>(null);

export function useSongImportContext() {
  const value = useContext(SongImportContext);
  if (!value) throw new Error("Song import must be used within EditorProvider");
  return value;
}
