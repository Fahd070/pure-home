/** The localizable shape of a notification row. */
export interface LocalizableNotification {
  title: string;
  body: string;
  titleEn?: string | null;
  bodyEn?: string | null;
}

/**
 * Picks the notification text to display, for one field, in one language.
 *
 * The storage contract, which this mirrors exactly:
 *   `title` / `body`     -- plain display text in the default language (Arabic).
 *                           The shipped Desktop v3.6.5 client renders these
 *                           columns DIRECTLY, so they hold ordinary readable
 *                           text and nothing else -- never a serialized
 *                           structure, never a translation key.
 *   `titleEn` / `bodyEn` -- optional English counterparts, added in Phase 2.
 *
 * An English reader gets the English column when it exists and falls back to the
 * default-language column when it does not. That fallback is the normal case for
 * every notification written before Phase 2: those rows have no English text and
 * were deliberately not rewritten to invent any, so an older Arabic notification
 * simply stays Arabic rather than rendering blank.
 *
 * There is no parsing here, and there must never be: the previous iteration of
 * this file decoded a JSON `{ar, en}` pair out of `title`/`body`, which would
 * have shown raw JSON on every v3.6.5 Desktop screen during rollout.
 */
export function resolveNotificationText(
  notification: LocalizableNotification | null | undefined,
  field: "title" | "body",
  lang: string
): string {
  if (!notification) return "";
  const fallback = notification[field] || "";
  if (lang !== "en") return fallback;
  const english = field === "title" ? notification.titleEn : notification.bodyEn;
  // Treat an empty string the same as a missing column -- both mean "no English
  // text for this row", and neither should render as a blank notification.
  return english || fallback;
}
