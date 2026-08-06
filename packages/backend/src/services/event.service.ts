import { Prisma } from '@prisma/client';
import prisma from '../prisma';

export const EVENT_TYPES = {
  APPOINTMENT_STARTED:  'APPOINTMENT_STARTED',
  APPOINTMENT_COMPLETED:'APPOINTMENT_COMPLETED',
  APPOINTMENT_POSTPONED:'APPOINTMENT_POSTPONED',
  CUSTOMER_CREATED:     'CUSTOMER_CREATED',
  CUSTOMER_UPDATED:     'CUSTOMER_UPDATED',
  CUSTOMER_DELETED:     'CUSTOMER_DELETED',
  APPOINTMENT_CREATED:  'APPOINTMENT_CREATED',
  APPOINTMENT_UPDATED:  'APPOINTMENT_UPDATED',
  APPOINTMENT_DELETED:  'APPOINTMENT_DELETED',
  SCHEDULE_CHANGED:     'SCHEDULE_CHANGED',
  USER_UPDATED:         'USER_UPDATED',
  ACCESS_CODE_UPDATED:  'ACCESS_CODE_UPDATED',
  SETTINGS_UPDATED:     'SETTINGS_UPDATED',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export interface EventOptions {
  type: EventType;
  entityType: string;
  entityId: string;
  userId: string;
  payload: Record<string, unknown>;
}

export async function emitEvent(opts: EventOptions) {
  // Persists to the event_logs audit trail only. No socket broadcast here: this
  // generic 'event' channel had no frontend subscribers (verified across the app) and
  // was broadcasting full, unfiltered payloads -- including customer/appointment PII --
  // to every connected socket regardless of role. The role-scoped, per-feature socket
  // events (emitted separately by each route) are what the UI actually listens to.
  const event = await prisma.eventLog.create({
    data: {
      eventType: opts.type,
      entityType: opts.entityType,
      entityId: opts.entityId,
      userId: opts.userId,
      payload: opts.payload as Prisma.InputJsonValue,
    },
  });
  return event;
}
