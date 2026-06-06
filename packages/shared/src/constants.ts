export const SAUDI_PHONE_REGEX = /^05\d{8}$/;
export const SOCKET_EVENTS = {
  CUSTOMER_CREATED: 'customer:created', CUSTOMER_UPDATED: 'customer:updated',
  APPOINTMENT_CREATED: 'appointment:created', APPOINTMENT_STATUS: 'appointment:status',
  TASK_APPROVED: 'task:approved', TASK_COMPLETED: 'task:completed', TASK_POSTPONED: 'task:postponed',
  NOTIFICATION_NEW: 'notification:new', MESSAGE_NEW: 'message:new', STATS_UPDATED: 'stats:updated',
} as const;
export const SOCKET_ROOMS = { ALL: 'all', ADMIN: 'admin', SCHEDULING: 'scheduling', TECHNICIAN: 'technician' } as const;
export const DEFAULT_SERVER_URL = 'http://localhost:3001';
