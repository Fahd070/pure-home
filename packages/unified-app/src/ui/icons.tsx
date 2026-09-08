import React from "react";

/**
 * One monochrome 24x24 stroke set for the whole product. The nav and toolbars
 * previously used emoji, which every Windows build renders at its own size,
 * weight and colour -- so a row of nav items never optically aligned and none
 * of them could inherit the foreground colour of the active theme. These
 * inherit currentColor and share one stroke weight.
 */

export type IconName =
  | "dashboard" | "customers" | "reports" | "appointments" | "acceptance"
  | "urgent" | "technicians" | "callReports" | "expenses" | "messages"
  | "notifications" | "messaging" | "accessCodes" | "settings" | "queue"
  | "add" | "search" | "filter" | "download" | "edit" | "trash" | "close"
  | "check" | "chevronDown" | "chevronStart" | "chevronEnd" | "menu"
  | "help" | "logout" | "language" | "external" | "refresh" | "clock"
  | "location" | "phone" | "user" | "calendar" | "info" | "eye" | "eyeOff";

const PATHS: Record<IconName, React.ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></>,
  customers: <><path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" /><circle cx="9" cy="7" r="3.2" /><path d="M22 20v-1.5a4 4 0 0 0-3-3.87" /><path d="M16.5 4.13a4 4 0 0 1 0 5.74" /></>,
  reports: <><path d="M3 21h18" /><rect x="4.5" y="12" width="3.5" height="6" rx="0.8" /><rect x="10.25" y="8" width="3.5" height="10" rx="0.8" /><rect x="16" y="4" width="3.5" height="14" rx="0.8" /></>,
  appointments: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  acceptance: <><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></>,
  urgent: <><path d="M10.3 3.9 2.4 17.4A2 2 0 0 0 4.1 20.4h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4.5M12 17h.01" /></>,
  technicians: <><path d="M14.5 6.5a4.5 4.5 0 0 0 5.9 5.9L21 13l-8 8-1.5-1.5" /><path d="M9.5 3.5 3 10l3.5 3.5L13 7Z" /></>,
  callReports: <><path d="M12 21a9 9 0 1 0-7.5-4L3.5 21l4.2-1A9 9 0 0 0 12 21Z" /><path d="M15.4 13.7c-.3-.15-1.7-.85-2-.95s-.5-.15-.7.15-.75.95-.9 1.15-.35.2-.65.05a7.9 7.9 0 0 1-2.3-1.4 8.7 8.7 0 0 1-1.6-2c-.16-.3 0-.45.12-.6l.45-.5c.14-.17.19-.29.29-.48a.55.55 0 0 0 0-.5c-.08-.15-.65-1.55-.9-2.12s-.48-.5-.66-.5h-.57a1.1 1.1 0 0 0-.8.37 3.3 3.3 0 0 0-1 2.4 5.6 5.6 0 0 0 1.2 2.95 12.7 12.7 0 0 0 4.85 4.3 6.1 6.1 0 0 0 2.45.68 2.8 2.8 0 0 0 1.8-.57 2.3 2.3 0 0 0 .6-1.35Z" /></>,
  expenses: <><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" /><path d="M2.5 10h19" /><path d="M17.5 14.5h1.5" /></>,
  messages: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" /></>,
  notifications: <><path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z" /><path d="M10.3 19a2 2 0 0 0 3.4 0" /></>,
  messaging: <><path d="M20.5 12.5a7.5 7.5 0 0 1-8 7.5 8.6 8.6 0 0 1-2.6-.4L4.5 21l1.4-4.2A7.4 7.4 0 0 1 4.5 12.5a7.5 7.5 0 0 1 8-7.5 7.5 7.5 0 0 1 8 7.5Z" /></>,
  accessCodes: <><circle cx="7.5" cy="15.5" r="3.5" /><path d="M10 13 20 3M17.5 5.5l2 2M15 8l2 2" /></>,
  settings: <><circle cx="12" cy="12" r="3.1" /><path d="M19.1 14.2a1.5 1.5 0 0 0 .3 1.66l.05.05a1.85 1.85 0 1 1-2.62 2.62l-.05-.05a1.5 1.5 0 0 0-1.66-.3 1.5 1.5 0 0 0-.9 1.37v.15a1.85 1.85 0 1 1-3.7 0v-.08a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.66.3l-.05.05A1.85 1.85 0 1 1 5.2 15.9l.05-.05a1.5 1.5 0 0 0 .3-1.66 1.5 1.5 0 0 0-1.37-.9h-.15a1.85 1.85 0 1 1 0-3.7h.08a1.5 1.5 0 0 0 1.37-.98 1.5 1.5 0 0 0-.3-1.66l-.05-.05A1.85 1.85 0 1 1 7.75 4.3l.05.05a1.5 1.5 0 0 0 1.66.3h.07a1.5 1.5 0 0 0 .9-1.37v-.15a1.85 1.85 0 1 1 3.7 0v.08a1.5 1.5 0 0 0 .9 1.37 1.5 1.5 0 0 0 1.66-.3l.05-.05a1.85 1.85 0 1 1 2.62 2.62l-.05.05a1.5 1.5 0 0 0-.3 1.66v.07a1.5 1.5 0 0 0 1.37.9h.15a1.85 1.85 0 1 1 0 3.7h-.08a1.5 1.5 0 0 0-1.37.9Z" /></>,
  queue: <><path d="M3.5 5.5l2 2 3-3.5M3.5 12l2 2 3-3.5M3.5 18.5l2 2 3-3.5" /><path d="M12.5 6h8M12.5 12.5h8M12.5 19h8" /></>,
  add: <><path d="M12 5v14M5 12h14" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.9-3.9" /></>,
  filter: <><path d="M3.5 5.5h17l-6.5 7.7V19l-4 2v-7.8Z" /></>,
  download: <><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" /><path d="M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" /></>,
  edit: <><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17Z" /><path d="m15 6 3 3" /></>,
  trash: <><path d="M3.5 6.5h17M9 6.5V4.8A1.3 1.3 0 0 1 10.3 3.5h3.4A1.3 1.3 0 0 1 15 4.8v1.7" /><path d="M6 6.5 7 20a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 20l1-13.5" /><path d="M10.5 11v6M13.5 11v6" /></>,
  close: <><path d="M6 6l12 12M18 6 6 18" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7" /></>,
  chevronDown: <><path d="m6 9.5 6 6 6-6" /></>,
  chevronStart: <><path d="m14.5 5.5-6 6.5 6 6.5" /></>,
  chevronEnd: <><path d="m9.5 5.5 6 6.5-6 6.5" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.2-2.5 3.8" /><path d="M12 17.2h.01" /></>,
  logout: <><path d="M9.5 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.5" /><path d="M15.5 16.5 20 12l-4.5-4.5M20 12H9.5" /></>,
  language: <><circle cx="12" cy="12" r="9" /><path d="M3.5 12h17" /><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" /></>,
  external: <><path d="M13.5 4.5H19.5V10.5" /><path d="M19.5 4.5 11 13" /><path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" /></>,
  refresh: <><path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" /><path d="M20.5 4v5h-5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.3l3.4 2" /></>,
  location: <><path d="M20 10.5c0 5.5-8 12-8 12s-8-6.5-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10.3" r="2.8" /></>,
  phone: <><path d="M21 16.9v2.6a1.7 1.7 0 0 1-1.9 1.7 17.4 17.4 0 0 1-7.6-2.7 17.1 17.1 0 0 1-5.3-5.3A17.4 17.4 0 0 1 3.5 5.5 1.7 1.7 0 0 1 5.2 3.6h2.6a1.7 1.7 0 0 1 1.7 1.5c.1.9.3 1.7.6 2.5a1.7 1.7 0 0 1-.4 1.8L8.6 10.5a14 14 0 0 0 5 5l1.1-1.1a1.7 1.7 0 0 1 1.8-.4c.8.3 1.6.5 2.5.6a1.7 1.7 0 0 1 1.5 1.7Z" /></>,
  user: <><circle cx="12" cy="8" r="3.8" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="M8 14h3v3H8Z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11.5V16.5M12 7.8h.01" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M10.6 6.1A8.9 8.9 0 0 1 12 6c6 0 9.5 6 9.5 6a16.4 16.4 0 0 1-2.6 3.3" /><path d="M6.7 7.9A16 16 0 0 0 2.5 12S6 18 12 18a9.6 9.6 0 0 0 3.6-.7" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="m3.5 3.5 17 17" /></>,
};

export function Icon({
  name, className = "w-4 h-4", strokeWidth = 1.6, title,
}: { name: IconName; className?: string; strokeWidth?: number; title?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}

/** WhatsApp is a brand mark, so it stays a filled glyph rather than a stroke icon. */
export function WhatsAppIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.556 4.122 1.527 5.853L0 24l6.335-1.652A11.93 11.93 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.806 9.806 0 0 1-5.003-1.374l-.36-.214-3.72.975.99-3.618-.234-.372A9.82 9.82 0 0 1 2.182 12C2.182 6.58 6.58 2.182 12 2.182S21.818 6.58 21.818 12 17.42 21.818 12 21.818z" />
    </svg>
  );
}
