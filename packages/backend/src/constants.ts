export const SOCKET_EVENTS = {
  CUSTOMER_CREATED: 'customer:created',
  CUSTOMER_UPDATED: 'customer:updated',
  CUSTOMER_DELETED: 'customer:deleted',
  CUSTOMERS_BULK_DELETED: 'customers:bulk-deleted',
  APPOINTMENT_CREATED: 'appointment:created',
  APPOINTMENT_STATUS: 'appointment:status',
  TASK_APPROVED: 'task:approved',
  TASK_COMPLETED: 'task:completed',
  TASK_POSTPONED: 'task:postponed',
  NOTIFICATION_NEW: 'notification:new',
  MESSAGE_NEW: 'message:new',
  AUDIT_NEW: 'audit:new',
  DM_NEW: 'dm:new',
  DM_DELETED: 'dm:deleted',
  AUDIT_DELETED: 'audit:deleted',
  CONFIG_UPDATED: 'config:updated',
};
export const SOCKET_ROOMS = {
  ALL: 'all',
  ADMIN: 'ADMIN',
  SCHEDULING: 'SCHEDULING',
  TECHNICIAN: 'TECHNICIAN',
};