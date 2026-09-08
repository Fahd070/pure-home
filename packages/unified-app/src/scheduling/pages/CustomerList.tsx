import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";
import PreviousMaintenanceNoteBox from "../../components/PreviousMaintenanceNoteBox";
import { dateOnlyToApiDate, formatGregorianDate } from "../../utils/dateTimeInput";
import { Button } from "../../ui/Button";
import { Input, Select, Textarea, Field } from "../../ui/Field";
import { Badge, Tone } from "../../ui/Badge";
import { Toolbar } from "../../ui/Surface";
import { EmptyState, Loading } from "../../ui/Feedback";
import { TableShell, Table, THead, TH, TBody, TR, TD } from "../../ui/Table";
import { Modal } from "../../ui/Modal";
import { Icon } from "../../ui/icons";

function formatCycle(cycle: string, freq: number, t: any) {
  const n = Number(freq) || 1;
  if (cycle === "DAILY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.day") : t("customers.days")}`;
  if (cycle === "WEEKLY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.week") : t("customers.weeks")}`;
  if (cycle === "MONTHLY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.month") : t("customers.months")}`;
  return cycle;
}

/**
 * Maintenance countdown. The three states used to be told apart by a coloured
 * emoji circle inside a coloured pill -- the same information encoded twice,
 * and the emoji rendered at a different size on every machine. One toned badge
 * with a dot carries it now, and the dot is not the only cue: the label itself
 * says overdue / due today / due in N.
 */
function MaintenanceBadge({ c, t }: { c: any; t: any }) {
  if (c.alertLevel === "overdue") {
    return <Badge tone="danger" dot>{t("countdown.overdueBy", { days: c.overdueCount })}</Badge>;
  }
  if (c.alertLevel === "soon") {
    const label = c.daysUntil === 0 ? t("countdown.dueToday") : c.daysUntil === 1 ? t("countdown.dueTomorrow") : t("countdown.dueIn", { days: c.daysUntil });
    return <Badge tone="warning" dot>{label}</Badge>;
  }
  if (c.daysUntil !== null) {
    return <Badge tone="success" dot>{t("countdown.dueIn", { days: c.daysUntil })}</Badge>;
  }
  return null;
}

const STATUS_TONES: Record<string, Tone> = {
  SCHEDULED: "info",
  RESCHEDULED: "warning",
  CANCELLED: "danger",
  PENDING: "neutral",
  COMPLETED: "success",
  IN_PROGRESS: "progress",
  POSTPONED: "pending",
  APPROVED: "accent",
  PENDING_APPROVAL: "neutral",
};

function ScheduleModal({ customer, onClose, onSuccess }: { customer: any; onClose: () => void; onSuccess: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ type: "MAINTENANCE", date: "", notes: "" });

  // Modification #7: keyed on customer.id -- this modal is always opened for one
  // fixed customer, but keeping the id in the query key keeps this consistent
  // with the other forms and cache-safe if that ever changes.
  const { data: prevNote } = useQuery({
    queryKey: ["latest-maintenance-note", customer.id],
    queryFn: () => api.get(`/customers/${customer.id}/latest-maintenance-note`).then(r => r.data.data.nextMaintenanceNote),
  });

  const scheduledDate = dateOnlyToApiDate(form.date);

  const schedule = useMutation({
    mutationFn: () => api.post("/appointments", {
      customerId: customer.id,
      type: form.type,
      scheduledDate,
      notes: form.notes || undefined
    }),
    onSuccess: () => {
      toast.success(t("scheduling.scheduledSuccess"));
      onSuccess();
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.message || t("common.error"))
  });

  return (
    <Modal
      open
      onClose={onClose}
      closeOnBackdrop={false}
      size="sm"
      title={t("scheduling.scheduleMaintenance")}
      description={customer.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!scheduledDate} loading={schedule.isPending} onClick={() => schedule.mutate()}>
            {t("scheduling.scheduleMaintenance")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <PreviousMaintenanceNoteBox note={prevNote} />
        <Field label={t("appointments.type")} htmlFor="sched-type">
          <Select id="sched-type" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            <option value="MAINTENANCE">{t("appointments.maintenance")}</option>
            <option value="INSTALLATION">{t("appointments.installation")}</option>
          </Select>
        </Field>
        <Field label={t("common.date")} htmlFor="sched-date" required>
          <Input id="sched-date" type="date" lang="en-GB" dir="ltr" value={form.date}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
        </Field>
        <Field label={t("common.notes")} htmlFor="sched-notes">
          <Textarea id="sched-notes" rows={3} value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </Field>
      </div>
    </Modal>
  );
}

export function HistoryModal({ customer, onClose, apiClient = api }: { customer: any; onClose: () => void; apiClient?: typeof api }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data: detail, isLoading } = useQuery({
    queryKey: ["customer-sched-detail", customer.id],
    queryFn: () => apiClient.get("/customers/" + customer.id).then(r => r.data.data),
  });

  const cancelAppt = useMutation({
    mutationFn: (id: string) => apiClient.patch("/appointments/" + id + "/status", { status: "CANCELLED" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer-sched-detail", customer.id] });
      toast.success(t("common.success"));
    }
  });

  const appointments: any[] = detail?.appointments || [];
  const completed = appointments.filter((a: any) => a.workStatus === "COMPLETED");
  const lastMaint = completed[0];
  // Source of truth: backend-computed from actualCompletionDate + recurrence
  // (see maintenanceSchedule.service.ts) -- NOT the earliest upcoming
  // scheduledDate, which may not exist or may not reflect the real cycle.
  const nextMaintenance: string | null = detail?.nextMaintenance || null;

  function apptStatusKey(a: any) {
    if (a.isUrgent && a.urgentVisitRecord) return "tasks.completed";
    if (a.status === "CANCELLED") return "appointments.cancelled";
    if (a.workStatus === "COMPLETED") return "tasks.completed";
    if (a.workStatus === "IN_PROGRESS") return "tasks.inProgress";
    if (a.workStatus === "POSTPONED") return "tasks.postponed";
    if (a.status === "SCHEDULED") return "appointments.scheduled";
    if (a.status === "RESCHEDULED") return "appointments.rescheduled";
    return "appointments.pending";
  }

  function apptStatusTone(a: any): Tone {
    if (a.isUrgent && a.urgentVisitRecord) return STATUS_TONES.COMPLETED;
    return STATUS_TONES[a.workStatus || a.status] || "neutral";
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      className="max-h-[88vh]"
      title={`${t("scheduling.maintenanceHistory")} — ${customer.name}`}
      description={
        <>
          <span dir="ltr">{customer.secondaryPhone ? `${t("customers.primaryPhone")}: ${customer.phone}` : customer.phone}</span>
          {customer.secondaryPhone && <span className="ms-2" dir="ltr">{t("customers.secondaryPhone")}: {customer.secondaryPhone}</span>}
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface-subtle border border-line-subtle rounded-md p-3">
            <p className="text-2xs uppercase tracking-wide text-fg-muted mb-1">{t("scheduling.lastMaintenance")}</p>
            <p className="text-[0.8125rem] font-medium text-fg tabular-nums" dir="ltr">
              {lastMaint ? formatGregorianDate(lastMaint.scheduledDate) : t("scheduling.noLast")}
            </p>
          </div>
          <div className="bg-surface-subtle border border-line-subtle rounded-md p-3">
            <p className="text-2xs uppercase tracking-wide text-fg-muted mb-1">{t("scheduling.nextMaintenance")}</p>
            <p className="text-[0.8125rem] font-medium text-fg tabular-nums" dir="ltr">
              {nextMaintenance ? formatGregorianDate(nextMaintenance) : t("scheduling.noNext")}
            </p>
          </div>
        </div>

        {customer.previousServiceType && (
          <div className="bg-surface-subtle border border-line-subtle rounded-md p-3 space-y-1 text-[0.8125rem]">
            <p className="text-2xs uppercase tracking-wide text-fg-muted mb-1">{t("customers.previousService")}</p>
            <p>
              <span className="text-fg-muted">{t("customers.previousService")}: </span>
              {customer.previousServiceType === "INSTALLATION" ? t("customers.previousInstallation") : t("customers.previousMaintenance")}
            </p>
            <p>
              <span className="text-fg-muted">{t("customers.previousServiceDate")}: </span>
              <span dir="ltr" className="tabular-nums">{formatGregorianDate(customer.previousServiceDate)}</span>
            </p>
            {customer.previousServiceNote && (
              <p>
                <span className="text-fg-muted">{t("customers.previousServiceNote")}: </span>
                {customer.previousServiceNote}
              </p>
            )}
          </div>
        )}

        {isLoading ? (
          <Loading label={t("common.loading")} />
        ) : !appointments.length ? (
          <EmptyState icon={<Icon name="appointments" className="w-5 h-5" />} title={t("scheduling.noHistory")} />
        ) : (
          <div className="border border-line rounded-md overflow-hidden">
            <Table>
              <THead>
                <tr>
                  <TH width="6.5rem">{t("common.date")}</TH>
                  <TH>{t("appointments.type")}</TH>
                  <TH width="8rem">{t("common.status")}</TH>
                  <TH>{t("appointments.technician")}</TH>
                  <TH width="7rem">{t("common.actions")}</TH>
                </tr>
              </THead>
              <TBody>
                {appointments.map((a: any) => (
                  <React.Fragment key={a.id}>
                    <tr className="border-b border-line-subtle hover:bg-surface-hover transition-colors">
                      <TD className="tabular-nums whitespace-nowrap"><span dir="ltr">{formatGregorianDate(a.scheduledDate)}</span></TD>
                      <TD>
                        {a.isUrgent
                          ? `${t("urgentAppts.title")} — ${a.urgentVisitRecord?.serviceType === "INSTALLATION" ? t("appointments.installation") : a.urgentVisitRecord?.serviceType === "VISIT_ONLY" ? t("urgentAppts.visitOnly") : t("appointments.maintenance")}`
                          : a.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}
                      </TD>
                      <TD><Badge tone={apptStatusTone(a)} dot>{t(apptStatusKey(a))}</Badge></TD>
                      <TD className="text-fg-secondary">{a.urgentVisitRecord?.submittedBy?.name || a.technician?.name || "—"}</TD>
                      <TD>
                        {(a.status === "SCHEDULED" || a.status === "RESCHEDULED" || a.status === "PENDING") && (
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => cancelAppt.mutate(a.id)}
                            loading={cancelAppt.isPending}
                            className="text-danger-fg hover:bg-danger-bg"
                          >
                            {t("appointments.cancelled")}
                          </Button>
                        )}
                      </TD>
                    </tr>

                    {/* Detail rows hang off the appointment they belong to, tinted
                        by what they are: completion state, a forward-looking note,
                        or the urgent record. */}
                    {a.workStatus === "COMPLETED" && (
                      <tr className="border-b border-line-subtle bg-surface-subtle">
                        <td colSpan={5} className="px-3 py-1.5 text-2xs text-fg-secondary">
                          {a.actualCompletionDate && (
                            <span className="me-3">
                              <span className="font-medium">{t("tasks.completionDate")}:</span>{" "}
                              <span dir="ltr" className="tabular-nums">{formatGregorianDate(a.actualCompletionDate)}</span>
                            </span>
                          )}
                          <Badge tone={a.maintenanceConfirmed ? "success" : "pending"}>
                            {a.maintenanceConfirmed ? t("appointments.operationConfirmed") : t("appointments.awaitingMaintenanceConfirmation")}
                          </Badge>
                        </td>
                      </tr>
                    )}
                    {a.nextMaintenanceNote && (
                      <tr className="border-b border-line-subtle bg-info-bg">
                        <td colSpan={5} className="px-3 py-1.5 text-2xs text-info-fg">
                          <span className="font-medium">{t("tasks.nextMaintenanceNote")}:</span> {a.nextMaintenanceNote}
                        </td>
                      </tr>
                    )}
                    {a.isUrgent && a.urgentVisitRecord && (
                      <tr className="border-b border-line-subtle bg-urgent-bg">
                        <td colSpan={5} className="px-3 py-1.5 text-2xs text-urgent-fg">
                          <span className="font-medium">{t("urgentAppts.serviceDetails")}:</span> {a.urgentVisitRecord.serviceDetails || a.urgentVisitRecord.serviceNotes || a.urgentVisitRecord.notes || "—"}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function CustomerList() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const socket = useSocket();
  const [search, setSearch] = useState("");
  const [scheduleModal, setScheduleModal] = useState<any>(null);
  const [historyModal, setHistoryModal] = useState<any>(null);

  useEffect(() => {
    window.dispatchEvent(new Event("clear-badge-customers-sched"));
  }, []);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => qc.invalidateQueries({ queryKey: ["customers-sched"] });
    socket.on("customer:created", refresh);
    socket.on("customer:updated", refresh);
    socket.on("customer:deleted", refresh);
    return () => {
      socket.off("customer:created", refresh);
      socket.off("customer:updated", refresh);
      socket.off("customer:deleted", refresh);
    };
  }, [socket, qc]);

  const { data, isLoading } = useQuery({
    queryKey: ["customers-sched", search],
    queryFn: () => api.get("/customers", { params: { search, limit: 50, includeSchedule: true } }).then(r => r.data)
  });

  const customers: any[] = data?.data || [];

  return (
    <div className="space-y-4">
      <Toolbar>
        <div className="relative w-80 max-w-full">
          <Icon name="search" className="w-3.5 h-3.5 text-fg-muted absolute top-1/2 -translate-y-1/2 start-2.5 pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("common.search")}
            aria-label={t("common.search")}
            className="ps-8"
          />
        </div>
        <Button variant="primary" className="ms-auto" onClick={() => navigate("/scheduling/customers/add")}>
          <Icon name="add" className="w-3.5 h-3.5" />
          {t("customers.add")}
        </Button>
      </Toolbar>

      {isLoading ? (
        <Loading label={t("common.loading")} />
      ) : !customers.length ? (
        <div className="bg-surface border border-line rounded-md">
          <EmptyState icon={<Icon name="customers" className="w-5 h-5" />} title={t("common.noRecords")} />
        </div>
      ) : (
        <TableShell>
          <Table className="min-w-[900px]">
            <THead>
              <tr>
                <TH>{t("common.name")}</TH>
                <TH width="9rem">{t("common.phone")}</TH>
                <TH width="10rem">{t("customers.maintenanceCycle")}</TH>
                <TH width="12rem">{t("reports.nextMaintenance")}</TH>
                <TH width="9rem">{t("customers.district")}</TH>
                <TH width="12rem">{t("common.actions")}</TH>
              </tr>
            </THead>
            <TBody>
              {customers.map((c: any) => (
                <TR key={c.id} onClick={() => navigate(`/scheduling/customers/${c.id}`)}>
                  <TD className="font-medium">{c.name}</TD>
                  <TD className="text-fg-secondary"><span dir="ltr">{c.phone}</span></TD>
                  <TD className="text-fg-secondary text-2xs">{formatCycle(c.maintenanceCycle, c.maintenanceFrequency, t)}</TD>
                  <TD>
                    <div className="flex flex-col items-start gap-1">
                      <MaintenanceBadge c={c} t={t} />
                      {c.nextMaintenance && (
                        <span className="text-2xs text-fg-muted tabular-nums" dir="ltr">{formatGregorianDate(c.nextMaintenance)}</span>
                      )}
                    </div>
                  </TD>
                  <TD className="text-fg-secondary">{c.address?.district || "—"}</TD>
                  <TD>
                    {/* Scheduling is a booking desk, so the schedule action is the
                        one labelled button; the rest are icons to keep the row
                        readable at 1280 wide. */}
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm" variant="primary"
                        onClick={event => { event.stopPropagation(); setScheduleModal(c); }}
                      >
                        <Icon name="calendar" className="w-3.5 h-3.5" />
                        {t("scheduling.scheduleMaintenance")}
                      </Button>
                      <Button
                        size="sm" variant="ghost" iconOnly
                        onClick={event => { event.stopPropagation(); setHistoryModal(c); }}
                        title={t("scheduling.viewHistory")}
                        aria-label={t("scheduling.viewHistory")}
                      >
                        <Icon name="messages" className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" iconOnly
                        onClick={event => { event.stopPropagation(); navigate(`/scheduling/customers/${c.id}/edit`); }}
                        title={t("customers.edit")}
                        aria-label={t("customers.edit")}
                      >
                        <Icon name="edit" className="w-4 h-4" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableShell>
      )}

      {scheduleModal && (
        <ScheduleModal
          customer={scheduleModal}
          onClose={() => setScheduleModal(null)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ["customers-sched"] })}
        />
      )}
      {historyModal && (
        <HistoryModal customer={historyModal} onClose={() => setHistoryModal(null)} />
      )}
    </div>
  );
}
