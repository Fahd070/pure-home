export const SOCKET_EVENTS = {
  CUSTOMER_CREATED: 'customer:created',
  CUSTOMER_UPDATED: 'customer:updated',
  CUSTOMER_DELETED: 'customer:deleted',
  CUSTOMERS_BULK_DELETED: 'customers:bulk-deleted',
  APPOINTMENT_CREATED: 'appointment:created',
  APPOINTMENT_STATUS: 'appointment:status',
  APPOINTMENT_DELETED: 'appointment:deleted',
  APPOINTMENT_STARTED: 'appointment:started',
  APPOINTMENT_COMPLETED: 'appointment:completed',
  APPOINTMENT_POSTPONED: 'appointment:postponed',
  // v4 Requirement #7. The only genuinely NEW socket event in Phase 1 -- every
  // other v4 signal reuses an existing, already-redacted emit.
  APPOINTMENT_NO_ANSWER: 'appointment:no-answer',
  NOTIFICATION_NEW: 'notification:new',
  // Phase 2. Emitted into the recipient's OWN room when a notification of theirs
  // becomes read, so a second device belonging to the same user drops the badge
  // and closes the critical alert without waiting for a poll. Deliberately the
  // only new socket event in Phase 2: `notification:new` already covers arrival,
  // and a separate "counts-changed" event would carry no information that these
  // two do not, for every surface that reads counts from the server anyway.
  NOTIFICATION_READ: 'notification:read',
  MESSAGE_NEW: 'message:new',
  AUDIT_NEW: 'audit:new',
  DM_NEW: 'dm:new',
  DM_DELETED: 'dm:deleted',
  AUDIT_DELETED: 'audit:deleted',
  CONFIG_UPDATED:    'config:updated',
  SETTINGS_UPDATED:  'settings:updated',
};
export const SOCKET_ROOMS = {
  ALL: 'all',
  ADMIN: 'ADMIN',
  SCHEDULING: 'SCHEDULING',
  TECHNICIAN: 'TECHNICIAN',
};

/**
 * Notification `type` values.
 *
 * `type` is the event identity, and it is what every Phase 2 navigation badge
 * maps FROM -- there is deliberately no separate `category` column that could
 * disagree with it (see the Notification model in prisma/schema.prisma).
 */
export const NOTIFICATION_TYPES = {
  /** Pre-existing, produced by the hourly reminder cron. Always INFO. */
  APPOINTMENT_REMINDER: 'APPOINTMENT_REMINDER',
  /** Event A: Administration assigned an urgent appointment to one technician. */
  URGENT_APPOINTMENT_ASSIGNED: 'URGENT_APPOINTMENT_ASSIGNED',
  /** Event B: a technician postponed/rescheduled an appointment. */
  APPOINTMENT_POSTPONED: 'APPOINTMENT_POSTPONED',
  /** Event C: a technician recorded that the customer did not answer. */
  APPOINTMENT_NO_ANSWER: 'APPOINTMENT_NO_ANSWER',
} as const;

/**
 * Presentation level, stored on Notification.severity.
 *
 * INFO     -> navigation unread badge only (level 1).
 * CRITICAL -> also the centred critical alert (level 3), and -- for an urgent
 *             assignment reaching the technician it belongs to -- the red top
 *             banner (level 2).
 */
export const NOTIFICATION_SEVERITY = {
  INFO: 'INFO',
  CRITICAL: 'CRITICAL',
} as const;
