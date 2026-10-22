import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./components/Button";

export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Editor rendering failed", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-(--color-background) p-5">
          <div
            role="alert"
            aria-labelledby="editor-error-title"
            className="w-full max-w-lg rounded-xl border border-(--color-border) bg-(--color-surface) p-6 shadow-sm sm:p-8"
          >
            <h1 id="editor-error-title" className="text-2xl">
              The editor ran into a problem.
            </h1>
            <p className="mb-6 mt-3 text-(--color-text-muted)">
              Your unsaved changes are still in this session. Try opening the
              editor again.
            </p>
            <Button
              color="primary"
              onClick={() => this.setState({ hasError: false })}
            >
              Try again
            </Button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
