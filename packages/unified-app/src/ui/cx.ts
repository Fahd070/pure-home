/**
 * Joins class names, dropping anything falsy. Accepts unknown so the common
 * `someNode && "class"` guard works even when the guard is a ReactNode.
 */
export function cx(...parts: unknown[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" ");
}
