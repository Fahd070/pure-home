// Pure, side-effect-free helpers for turning an updater error into something
// safe to persist to the local log file AND safe to send to the renderer.
// Deliberately has no dependency on "electron" itself, so it can be unit
// tested directly (see packages/web/tests/updaterErrorSanitizer.test.ts).
//
// Neither the renderer-facing message nor the persisted log line is ever
// built from the raw error object or its stack trace -- only `.message`,
// `.name`, and `.code` (when present) are read, and each is scrubbed for
// local filesystem paths and token/key/password/secret/auth query-string
// values before use.
export interface SanitizedUpdaterError {
  message: string;
  name?: string;
  code?: string;
}

function scrub(value: string): string {
  return value
    .replace(/[A-Za-z]:\\[^\s"']+/g, "[local path]")
    .replace(/\/(?:home|Users)\/[^\s"']+/gi, "[local path]")
    .replace(/([?&](?:token|key|password|secret|auth)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 300);
}

export function sanitizeUpdaterErrorDetails(err: unknown): SanitizedUpdaterError {
  const rawMessage = err instanceof Error ? err.message : String(err ?? "Unknown error");
  const rawName = err instanceof Error ? err.name : undefined;
  const rawCodeValue: unknown = err instanceof Error ? (err as unknown as { code?: unknown }).code : undefined;
  const rawCode = typeof rawCodeValue === "string" ? rawCodeValue : undefined;

  return {
    message: scrub(rawMessage),
    name: rawName ? scrub(rawName) : undefined,
    code: rawCode ? scrub(rawCode) : undefined,
  };
}

// Convenience for call sites that only need the renderer-facing message.
export function sanitizeUpdaterError(err: unknown): string {
  return sanitizeUpdaterErrorDetails(err).message;
}

// Formats a single, sanitized, human-readable log line for a given failure
// context (e.g. "checkForUpdates()", "update check/download") -- this is
// what should ever be passed to the persisted logger, never the raw error.
export function formatUpdaterErrorLogLine(context: string, err: unknown): string {
  const details = sanitizeUpdaterErrorDetails(err);
  return `[updater] ${context} failed — name=${details.name ?? "unknown"} code=${details.code ?? "none"} message=${details.message}`;
}
