import type { TFunction } from "i18next";

/**
 * v4 Requirement #10B/#10C: ONE report-status vocabulary and ONE translation of
 * it, shared by the filter control, the on-screen table, the PDF and the Excel
 * workbook.
 *
 * Before this, the appointment report's filter listed raw enum values
 * ("SCHEDULED", "RESCHEDULED", ...) in both languages and both exports printed
 * `appointment.status` verbatim, so an Arabic report contained English database
 * identifiers. Fixing that in the PDF builder and again in the Excel builder
 * would have produced two mappings that are correct today and divergent later --
 * which is exactly how the report and the screen end up disagreeing.
 *
 * The values mirror services/reportStatus.service.ts on the backend, which owns
 * the filtering. They are kept as two short lists rather than shared through a
 * package because they are the API's wire vocabulary: a mismatch is caught by
 * the server's own validation with a 400 naming the offending value, not
 * silently ignored.
 */
export const APPOINTMENT_REPORT_STATUSES = [
  "COMPLETED", "POSTPONED", "RESCHEDULED", "SCHEDULED", "PENDING", "IN_PROGRESS", "CANCELLED",
] as const;

export type AppointmentReportStatus = typeof APPOINTMENT_REPORT_STATUSES[number];

export const CUSTOMER_REPORT_STATUSES = [
  "COMPLETED", "POSTPONED", "OVERDUE", "UPCOMING", "SCHEDULED", "IN_PROGRESS", "CANCELLED",
  "THIS_MONTH", "NEXT_MONTH",
] as const;

export type CustomerReportStatus = typeof CUSTOMER_REPORT_STATUSES[number];

/**
 * The single appointment-status translation map.
 *
 * Takes `t` rather than reading i18next's current language, because a report can
 * legitimately be generated in a language while the UI sits in another, and
 * because a pure function of (status, t) is testable without mounting anything.
 */
export function appointmentStatusLabels(t: TFunction): Record<AppointmentReportStatus, string> {
  return {
    COMPLETED:   t("reports.apptStatusCompleted"),
    POSTPONED:   t("reports.apptStatusPostponed"),
    RESCHEDULED: t("reports.apptStatusRescheduled"),
    SCHEDULED:   t("reports.apptStatusScheduled"),
    PENDING:     t("reports.apptStatusPending"),
    IN_PROGRESS: t("reports.apptStatusInProgress"),
    CANCELLED:   t("reports.apptStatusCancelled"),
  };
}

export function customerStatusLabels(t: TFunction): Record<CustomerReportStatus, string> {
  return {
    COMPLETED:   t("reports.statusCompleted"),
    POSTPONED:   t("reports.statusPostponed"),
    OVERDUE:     t("reports.statusOverdue"),
    UPCOMING:    t("reports.statusUpcoming"),
    SCHEDULED:   t("reports.statusScheduled"),
    IN_PROGRESS: t("reports.statusInProgress"),
    CANCELLED:   t("reports.statusCancelled"),
    THIS_MONTH:  t("reports.statusThisMonth"),
    NEXT_MONTH:  t("reports.statusNextMonth"),
  };
}

/**
 * Which single status one appointment reports as.
 *
 * Must stay identical to getAppointmentReportStatus() on the backend, which is
 * what the filter runs in SQL: if a row were labelled COMPLETED here but matched
 * the RESCHEDULED filter there, a report filtered to RESCHEDULED would show rows
 * whose own status column said Completed.
 */
export function appointmentReportStatus(appt: { status?: string; workStatus?: string }): AppointmentReportStatus {
  if (appt.status === "CANCELLED") return "CANCELLED";
  if (appt.workStatus === "COMPLETED") return "COMPLETED";
  if (appt.workStatus === "IN_PROGRESS") return "IN_PROGRESS";
  if (appt.workStatus === "POSTPONED") return "POSTPONED";
  if (appt.status === "RESCHEDULED") return "RESCHEDULED";
  if (appt.status === "PENDING") return "PENDING";
  return "SCHEDULED";
}

/** The localized label for one appointment row, for the table, the PDF and Excel alike. */
export function appointmentStatusLabel(appt: { status?: string; workStatus?: string }, t: TFunction): string {
  return appointmentStatusLabels(t)[appointmentReportStatus(appt)];
}

/**
 * Turns a selection into the query parameter, or `undefined` for "no filter".
 *
 * An empty selection deliberately means ALL, which is the meaning both reports
 * already had when their dropdown sat on "All Statuses" -- an empty multi-select
 * that returned nothing would be a silent change of behaviour disguised as a new
 * control.
 */
export function statusParam(selected: readonly string[]): string | undefined {
  return selected.length ? selected.join(",") : undefined;
}
