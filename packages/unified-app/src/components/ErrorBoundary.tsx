import React from "react";
import i18n from "../i18n";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

// Top-level render-failure guard: without this, any uncaught exception thrown
// while rendering a page (any department, any route) unmounts the whole React
// tree and leaves the user staring at a blank window with no way back short
// of force-quitting the app. This never happens for errors inside event
// handlers/async callbacks (React error boundaries only catch render/lifecycle
// errors by design) -- those are still handled locally by each call site's own
// try/catch + toast, as before.
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Diagnostics stay local to the developer console only -- never sent
    // anywhere, and never rendered into the fallback UI below (no stack
    // trace, no file paths, nothing user-facing beyond a generic message).
    console.error("[ErrorBoundary] Unhandled render error:", error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;

    const isAr = i18n.language === "ar";
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-canvas text-center px-6">
        <div className="max-w-sm">
          <div className="w-11 h-11 rounded-full bg-danger-bg border border-danger-border text-danger-fg flex items-center justify-center mx-auto mb-4" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.3 3.9 2.4 17.4A2 2 0 0 0 4.1 20.4h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              <path d="M12 9v4.5M12 17h.01" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-fg mb-2">
            {isAr ? "حدث خطأ غير متوقع" : "Something went wrong"}
          </h1>
          <p className="text-sm text-fg-muted mb-5">
            {isAr
              ? "حدث خطأ غير متوقع في التطبيق. لم تُفقد بياناتك — حاول إعادة التحميل."
              : "The app hit an unexpected error. Your data wasn't lost — try reloading."}
          </p>
          <button
            onClick={this.handleReload}
            className="bg-accent text-accent-fg px-4 h-control rounded-md text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            {isAr ? "إعادة التحميل" : "Reload"}
          </button>
        </div>
      </div>
    );
  }
}
