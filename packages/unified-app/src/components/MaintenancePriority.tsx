import React from "react";
import { useTranslation } from "react-i18next";
import { Badge, Tone } from "../ui/Badge";

/**
 * v4 Requirement #5: one implementation of maintenance priority presentation.
 *
 * The two customer lists (Administration and Scheduling) previously each carried
 * their own copy of this badge, and both copies rendered the OVERDUE case from
 * `overdueCount` -- the number of overdue APPOINTMENTS -- into a label that says
 * "days". A customer with two late appointments read as "2 days overdue".
 *
 * Everything below is derived from the backend's own classification of the
 * stored `nextMaintenanceDueAt` (see services/maintenanceSchedule.service.ts).
 * Nothing here recomputes a due date, a day count or a threshold, so the colour
 * a row is painted, the words in its badge and the order it appears in the list
 * cannot disagree with each other.
 */
export type MaintenancePriority = "OVERDUE" | "DUE_SOON" | "NORMAL" | "UNKNOWN";

/** The shape the customer list endpoints return for every row. */
export interface MaintenanceDue {
  maintenancePriority?: MaintenancePriority;
  /** Signed: negative means overdue. Never rendered directly -- see below. */
  daysUntilMaintenance?: number | null;
  /** Positive magnitude for OVERDUE rows, null otherwise. */
  daysOverdue?: number | null;
}

const PRIORITY_TONES: Record<MaintenancePriority, Tone> = {
  OVERDUE: "danger",
  DUE_SOON: "warning",
  NORMAL: "success",
  UNKNOWN: "neutral",
};

/**
 * Restrained full-row emphasis for an overdue customer.
 *
 * A tinted background plus a start-edge rule, both from the semantic danger
 * tokens, so it stays legible in light and dark and flips side automatically in
 * RTL (`border-s` is logical, not left/right). Deliberately not a saturated fill:
 * the row still has to be read, and on a list where many customers are overdue a
 * loud treatment stops distinguishing anything.
 *
 * Returns "" for every other priority -- approaching and normal are carried by
 * the badge alone, which is what keeps a page of mostly-fine customers calm.
 */
export function maintenanceRowClass(priority?: MaintenancePriority): string {
  return priority === "OVERDUE"
    ? "bg-danger-bg border-s-2 border-s-danger-solid"
    : "";
}

/**
 * The badge itself. `dot` is kept so colour is never the only cue.
 *
 * The overdue label is built from `daysOverdue`, which the server already
 * returns as a POSITIVE magnitude, so there is no negation anywhere in the UI
 * and "متبقي -742 يوم" is not a string this code is able to produce.
 */
export function MaintenanceBadge({ due }: { due: MaintenanceDue }) {
  const { t } = useTranslation();
  const priority = due.maintenancePriority;
  const days = due.daysUntilMaintenance;

  let label: string | null = null;
  if (priority === "OVERDUE") label = t("countdown.overdueBy", { days: due.daysOverdue ?? 0 });
  else if (priority && priority !== "UNKNOWN" && days != null) {
    label = days === 0 ? t("countdown.dueToday")
      : days === 1 ? t("countdown.dueTomorrow")
      : t("countdown.dueIn", { days });
  }

  if (!label) return <Badge tone="neutral" dot>{t("countdown.noSchedule")}</Badge>;
  return <Badge tone={PRIORITY_TONES[priority!]} dot>{label}</Badge>;
}
