import type { ReactNode } from "react";

export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <footer className="flex flex-wrap justify-end gap-3 border-t border-(--color-border) bg-(--color-elevated) px-6 py-4">
      {children}
    </footer>
  );
}
