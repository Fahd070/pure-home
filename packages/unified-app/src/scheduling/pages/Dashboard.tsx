import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";
import RowActionButton from "../../components/RowActionButton";
import PreviousMaintenanceNoteBox from "../../components/PreviousMaintenanceNoteBox";
import CallReportModal from "../components/CallReportModal";
import { toDateInputValue, dateOnlyToApiDate, formatGregorianDate } from "../../utils/dateTimeInput";
import { Button } from "../../ui/Button";
import { Input, Select, Textarea, Field } from "../../ui/Field";
import { Badge, Tone } from "../../ui/Badge";
import { StatTile } from "../../ui/Surface";
import { EmptyState, Loading } from "../../ui/Feedback";
import { Table, THead, TH, TBody, TR, TD } from "../../ui/Table";
import { Modal } from "../../ui/Modal";
import { MaintenanceBadge, maintenanceRowClass } from "../../components/MaintenancePriority";
import { Icon, IconName } from "../../ui/icons";

const APPT_ENDPOINTS = ["completed-maintenance","this-month","next-month","postponed","overdue","today","urgent"];
// The maintenance buckets return CUSTOMERS, not appointments (v4 Requirement #4):
// a customer is due whether or not a visit exists, so booking one from here is
// the action the list exists to enable.
const MAINTENANCE_ENDPOINTS = ["maintenance-overdue","maintenance-this-month","maintenance-next-month"];
const CUSTOMER_ENDPOINTS = ["customers-list", ...MAINTENANCE_ENDPOINTS];

export function EditApptModal({ appt, onSave, onClose }: { appt: any; onSave: (id: string, data: any) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    date: toDateInputValue(appt.scheduledDate),
    type: appt.type || "MAINTENANCE",
    status: appt.status || "SCHEDULED",
    notes: appt.notes || "",
  });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  function handleSave() {
    const scheduledDate = dateOnlyToApiDate(form.date);
    if (!scheduledDate) { toast.error(t("common.required")); return; }
    onSave(appt.id, { scheduledDate, type: form.type, status: form.status, notes: form.notes });
  }

  return (
    <Modal
      open
      onClose={onClose}
      closeOnBackdrop={false}
      size="sm"
      title={t("dashboard.editApptTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={handleSave}>{t("common.save")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t("common.date")} htmlFor="edit-appt-date">
          <Input id="edit-appt-date" type="date" lang="en-GB" dir="ltr" value={form.date} onChange={e => set("date", e.target.value)} />
        </Field>
        <Field label={t("appointments.type")} htmlFor="edit-appt-type">
          <Select id="edit-appt-type" value={form.type} onChange={e => set("type", e.target.value)}>
            <option value="MAINTENANCE">{t("appointments.maintenance")}</option>
            <option value="INSTALLATION">{t("appointments.installation")}</option>
          </Select>
        </Field>
        <Field label={t("common.status")} htmlFor="edit-appt-status">
          <Select id="edit-appt-status" value={form.status} onChange={e => set("status", e.target.value)}>
            <option value="SCHEDULED">{t("appointments.scheduled")}</option>
            <option value="RESCHEDULED">{t("appointments.rescheduled")}</option>
            <option value="CANCELLED">{t("appointments.cancelled")}</option>
          </Select>
        </Field>
        <Field label={t("common.notes")} htmlFor="edit-appt-notes">
          <Textarea id="edit-appt-notes" rows={3} value={form.notes} onChange={e => set("notes", e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function QuickScheduleModal({ customer, onClose, onSaved }: { customer: { id: string; name: string }; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [date, setDate] = useState("");
  const [type, setType] = useState("MAINTENANCE");
  const [loading, setLoading] = useState(false);

  // Modification #7: keyed on customer.id -- this modal is always opened for one
  // fixed customer, but keeping the id in the query key keeps this consistent
  // with the other forms and cache-safe if that ever changes.
  const { data: prevNote } = useQuery({
    queryKey: ["latest-maintenance-note", customer.id],
    queryFn: () => api.get(`/customers/${customer.id}/latest-maintenance-note`).then(r => r.data.data.nextMaintenanceNote),
  });

  async function handleSave() {
    const scheduledDate = dateOnlyToApiDate(date);
    if (!scheduledDate) { toast.error(t("common.required")); return; }
    setLoading(true);
    try {
      await api.post("/appointments", { customerId: customer.id, scheduledDate, type });
      toast.success(t("appointments.created"));
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || t("common.error"));
    } finally { setLoading(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      closeOnBackdrop={false}
      size="sm"
      title={customer.name}
      description={t("appointments.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={loading} onClick={handleSave}>{t("common.save")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <PreviousMaintenanceNoteBox note={prevNote} />
        <Field label={t("common.date")} htmlFor="quick-date">
          <Input id="quick-date" type="date" lang="en-GB" dir="ltr" value={date} onChange={e => setDate(e.target.value)} />
        </Field>
        <Field label={t("appointments.type")} htmlFor="quick-type">
          <Select id="quick-type" value={type} onChange={e => setType(e.target.value)}>
            <option value="MAINTENANCE">{t("appointments.maintenance")}</option>
            <option value="INSTALLATION">{t("appointments.installation")}</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function DrillModal({ title, endpoint, onClose }: { title: string; endpoint: string; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [editingAppt, setEditingAppt] = useState<any | null>(null);
  const [schedulingCustomer, setSchedulingCustomer] = useState<{ id: string; name: string } | null>(null);
  // Modification #11: the customer a Call Report is being started for. Always
  // fully replaced (never merged) on open, and cleared on close, so a stale
  // previous row's context can never bleed into a newly-opened modal.
  const [callReportCustomer, setCallReportCustomer] = useState<{ id: string; name: string; phone: string } | null>(null);

  useEffect(() => { const tm = setTimeout(() => setDebouncedSearch(search), 300); return () => clearTimeout(tm); }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ["sched-drill", endpoint, debouncedSearch, page],
    queryFn: () => api.get(`/dashboard/${endpoint}`, { params: { search: debouncedSearch, page, limit: 15 } }).then(r => r.data),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/dashboard/appointment/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sched-drill", endpoint] });
      qc.invalidateQueries({ queryKey: ["sched-dashboard-stats"] });
      toast.success(t("dashboard.saved"));
      setEditingAppt(null);
    },
    onError: () => toast.error(t("common.error")),
  });

  const items = data?.data || [];
  const total = data?.meta?.total || 0;
  const pages = Math.ceil(total / 15) || 1;
  const isApptList = APPT_ENDPOINTS.includes(endpoint);
  const isCustomerList = CUSTOMER_ENDPOINTS.includes(endpoint);

  // Dashboard parity fix: matches the Admin Dashboard's DrillModal exactly.
  const taskTones: Record<string, Tone> = {
    WAITING: "pending",
    IN_PROGRESS: "progress",
    COMPLETED: "success",
    POSTPONED: "warning",
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="lg"
        title={title}
        className="max-h-[85vh]"
        footer={
          total > 15 ? (
            <div className="flex items-center justify-between w-full">
              <span className="text-2xs text-fg-muted tabular-nums">{total} {t("common.total")}</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" iconOnly disabled={page === 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page">
                  <Icon name="chevronStart" className="w-3.5 h-3.5 rtl:rotate-180" />
                </Button>
                <span className="text-2xs text-fg-secondary tabular-nums px-1">{page}/{pages}</span>
                <Button size="sm" variant="secondary" iconOnly disabled={page >= pages} onClick={() => setPage(p => p + 1)} aria-label="Next page">
                  <Icon name="chevronEnd" className="w-3.5 h-3.5 rtl:rotate-180" />
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        <div className="relative mb-3">
          <Icon name="search" className="w-3.5 h-3.5 text-fg-muted absolute top-1/2 -translate-y-1/2 start-2.5 pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("dashboard.search")}
            aria-label={t("dashboard.search")}
            className="ps-8"
          />
        </div>

        <div className="border border-line rounded-md overflow-hidden">
          {isLoading ? <Loading label={t("dashboard.loading")} />
            : items.length === 0 ? <EmptyState icon={<Icon name="search" className="w-5 h-5" />} title={t("dashboard.noRecords")} />
            : isApptList ? (
              <Table>
                <THead>
                  <tr>
                    <TH>{t("appointments.customer")}</TH>
                    <TH>{t("common.phone")}</TH>
                    <TH width="6.5rem">{t("common.date")}</TH>
                    <TH width="7rem">{t("appointments.type")}</TH>
                    <TH width="8rem">{t("common.status")}</TH>
                    <TH width="6rem" />
                  </tr>
                </THead>
                <TBody>
                  {items.map((a: any) => {
                    let loc: any = {};
                    try { loc = a.urgentLocation ? JSON.parse(a.urgentLocation) : {}; } catch {}
                    const displayName = a.customer?.name || [loc.city, loc.district].filter(Boolean).join("، ") || "زيارة عاجلة";
                    const displayPhone = a.customer?.phone || "—";
                    return (
                      <tr
                        key={a.id}
                        onClick={a.customer ? () => navigate(`/scheduling/customers/${a.customer.id}`) : undefined}
                        onKeyDown={a.customer ? event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); navigate(`/scheduling/customers/${a.customer.id}`); } } : undefined}
                        tabIndex={a.customer ? 0 : undefined}
                        className={`border-b border-line-subtle last:border-b-0 hover:bg-surface-hover transition-colors ${a.customer ? "cursor-pointer" : ""}`}
                      >
                        <TD className="font-medium">{displayName}</TD>
                        <TD className="text-fg-secondary"><span dir="ltr">{displayPhone}</span></TD>
                        <TD className="tabular-nums whitespace-nowrap"><span dir="ltr">{formatGregorianDate(a.scheduledDate)}</span></TD>
                        <TD className="text-fg-secondary text-2xs">{a.type}</TD>
                        <TD>
                          <Badge tone={taskTones[a.workStatus] ?? "neutral"} dot>{a.workStatus || a.status}</Badge>
                        </TD>
                        <TD>
                          <div className="flex gap-1 items-center">
                            <RowActionButton variant="edit" onClick={() => setEditingAppt(a)} title={t("dashboard.editAppt")} />
                            {/* Modification #11: only for a real, registered customer -- an
                                urgent row with no linked customer has no customerId to attach
                                a call report to (the existing subsystem requires one or an
                                unregistered name, which this shortcut deliberately doesn't invent). */}
                            {a.customer && (
                              <RowActionButton variant="call" onClick={() => setCallReportCustomer({ id: a.customer.id, name: a.customer.name, phone: a.customer.phone })} title={t("callReports.action")} />
                            )}
                          </div>
                        </TD>
                      </tr>
                    );
                  })}
                </TBody>
              </Table>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>{t("common.name")}</TH>
                    <TH>{t("common.phone")}</TH>
                    <TH width="12rem">{t("reports.nextMaintenance")}</TH>
                    <TH>{t("customers.city")}</TH>
                    <TH width="4rem" />
                  </tr>
                </THead>
                <TBody>
                  {items.map((c: any) => (
                    <TR
                      key={c.id}
                      emphasis={maintenanceRowClass(c.maintenancePriority)}
                      onClick={() => navigate(`/scheduling/customers/${c.id}`)}
                    >
                      <TD className="font-medium">{c.name}</TD>
                      <TD className="text-fg-secondary"><span dir="ltr">{c.phone}</span></TD>
                      <TD>
                        {/* Only the maintenance drill-downs carry these fields; the
                            plain customer list leaves the cell empty rather than
                            inventing a priority it was not given. */}
                        {c.maintenancePriority ? (
                          <div className="flex flex-col items-start gap-1">
                            <MaintenanceBadge due={c} />
                            {c.nextMaintenanceDueAt && (
                              <span className="text-2xs text-fg-muted tabular-nums" dir="ltr">{formatGregorianDate(c.nextMaintenanceDueAt)}</span>
                            )}
                          </div>
                        ) : "—"}
                      </TD>
                      <TD className="text-fg-secondary">{c.address?.city || "—"}</TD>
                      <TD>
                        {isCustomerList && (
                          <Button
                            size="sm" variant="ghost" iconOnly
                            onClick={event => { event.stopPropagation(); setSchedulingCustomer({ id: c.id, name: c.name }); }}
                            title={t("appointments.new")}
                            aria-label={t("appointments.new")}
                          >
                            <Icon name="calendar" className="w-4 h-4" />
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
        </div>
      </Modal>

      {/* Rendered AFTER the drill modal: every dialog shares the same z-layer,
          so DOM order is what puts a nested dialog on top of the one that
          opened it. */}
      {schedulingCustomer && (
        <QuickScheduleModal
          customer={schedulingCustomer}
          onClose={() => setSchedulingCustomer(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["sched-drill", endpoint] }); qc.invalidateQueries({ queryKey: ["sched-dashboard-stats"] }); }}
        />
      )}

      {editingAppt && (
        <EditApptModal
          appt={editingAppt}
          onSave={(id, data) => editMutation.mutate({ id, data })}
          onClose={() => setEditingAppt(null)}
        />
      )}

      {callReportCustomer && (
        <CallReportModal
          customer={callReportCustomer}
          onClose={() => setCallReportCustomer(null)}
        />
      )}
    </>
  );
}

export default function SchedDashboard() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const socket = useSocket();
  const [modal, setModal] = useState<{ title: string; endpoint: string } | null>(null);

  const { data: stats } = useQuery({
    queryKey: ["sched-dashboard-stats"],
    queryFn: () => api.get("/dashboard/stats").then(r => r.data.data),
  });

  const { data: activity } = useQuery({
    queryKey: ["sched-dashboard-activity"],
    queryFn: () => api.get("/dashboard/activity").then(r => r.data.data),
  });

  useEffect(() => {
    if (!socket) return;
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["sched-dashboard-stats"] });
      qc.invalidateQueries({ queryKey: ["sched-dashboard-activity"] });
      qc.invalidateQueries({ queryKey: ["sched-drill"] });
    };
    socket.on("appointment:created", refresh); socket.on("appointment:deleted", refresh);
    socket.on("appointment:status", refresh); socket.on("appointment:completed", refresh); socket.on("appointment:postponed", refresh);
    // customer:updated matters here now that the counters are driven by the
    // customer's own due date: editing a maintenance cycle moves a bucket with no
    // appointment involved at all.
    socket.on("customer:created", refresh); socket.on("customer:updated", refresh); socket.on("customer:deleted", refresh); socket.on("customers:bulk-deleted", refresh);
    return () => {
      socket.off("appointment:created", refresh); socket.off("appointment:deleted", refresh);
      socket.off("appointment:status", refresh); socket.off("appointment:completed", refresh); socket.off("appointment:postponed", refresh);
      socket.off("customer:created", refresh); socket.off("customer:updated", refresh); socket.off("customer:deleted", refresh); socket.off("customers:bulk-deleted", refresh);
    };
  }, [socket, qc]);

  const statusTone: Record<string, Tone> = {
    COMPLETED: "success", IN_PROGRESS: "progress",
    POSTPONED: "warning", WAITING: "pending",
    NO_APPOINTMENT: "neutral",
  };
  const statusLabel: Record<string, string> = {
    COMPLETED: t("tasks.completed"), IN_PROGRESS: t("tasks.inProgress"),
    POSTPONED: t("tasks.postponed"), WAITING: t("tasks.waiting") || "Waiting",
    NO_APPOINTMENT: "—"
  };

  // Dashboard parity fix: same card set and same GET /dashboard/stats the Admin
  // Dashboard consumes -- but Scheduling reads them in the order its own job
  // runs in. Time-critical work that someone has to act on today comes first;
  // the forward-looking pipeline sits below it.
  type StatCardDef = { label: string; key: string; endpoint: string; tone: Tone; icon: IconName };

  const attention: StatCardDef[] = [
  // v4 Requirement #4: these three counters are CUSTOMER counts over the stored
  // next-maintenance due date, not appointment counts. A customer whose filter is
  // due is due whether or not anyone has booked a visit yet -- under the previous
  // appointment-derived counters those customers were the ones that never
  // appeared anywhere, which is precisely backwards.
    { label: t("dashboard.overdueMaintenance"), key: "maintenanceOverdue", endpoint: "maintenance-overdue",   tone: "danger",  icon: "urgent" },
    { label: t("dashboard.urgentAppointments"), key: "urgentCount",     endpoint: "urgent",    tone: "urgent",  icon: "urgent" },
    { label: t("dashboard.dueToday"),           key: "todayCount",      endpoint: "today",     tone: "warning", icon: "clock" },
    { label: t("dashboard.suspendedPostponed"), key: "pending",         endpoint: "postponed", tone: "pending", icon: "clock" },
  ];
  const pipeline: StatCardDef[] = [
    { label: t("dashboard.maintenanceThisMonth"), key: "maintenanceThisMonth", endpoint: "maintenance-this-month", tone: "info", icon: "calendar" },
    { label: t("dashboard.maintenanceNextMonth"), key: "maintenanceNextMonth", endpoint: "maintenance-next-month", tone: "progress", icon: "appointments" },
    { label: t("dashboard.completedMaintenance"), key: "completed", endpoint: "completed-maintenance", tone: "success", icon: "check" },
    { label: t("dashboard.customers"),            key: "total",     endpoint: "customers-list",        tone: "neutral", icon: "customers" },
  ];

  const renderGroup = (heading: string, cards: StatCardDef[]) => (
    <section>
      <h2 className="text-2xs font-semibold uppercase tracking-wide text-fg-muted mb-2">{heading}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map(c => (
          <StatTile
            key={c.key}
            label={c.label}
            value={stats?.[c.key] ?? "—"}
            tone={c.tone}
            icon={<Icon name={c.icon} className="w-4 h-4" />}
            hint={t("dashboard.clickToView")}
            onClick={() => setModal({ title: c.label, endpoint: c.endpoint })}
          />
        ))}
      </div>
    </section>
  );

  return (
    <div className="space-y-5">
      {/* Group headings must NOT reuse a card's own label -- "Due Today" as a
          heading above a "Due Today" card read like a duplicate rather than a
          grouping. These name what the group is for. */}
      {renderGroup(isAr ? "يحتاج إلى إجراء" : "Needs attention", attention)}
      {renderGroup(isAr ? "الأعمال القادمة" : "Pipeline", pipeline)}

      <section className="bg-surface border border-line rounded-md">
        <h3 className="text-sm font-semibold text-fg px-4 py-3 border-b border-line">{t("dashboard.recentActivity")}</h3>
        {!(activity?.length) ? (
          <EmptyState icon={<Icon name="clock" className="w-5 h-5" />} title={t("dashboard.noRecentActivity")} />
        ) : (
          <ul className="divide-y divide-line-subtle">
            {(activity || []).map((a: any) => (
              <li key={a.customerId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="w-7 h-7 rounded-md bg-surface-active text-fg-secondary text-2xs font-semibold flex items-center justify-center flex-shrink-0"
                    aria-hidden="true"
                  >
                    {a.customerName?.[0]}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[0.8125rem] font-medium text-fg truncate">{a.customerName}</p>
                    <p className="text-2xs text-fg-muted" dir="ltr">{a.phone}</p>
                  </div>
                </div>
                <Badge tone={statusTone[a.status] ?? "neutral"} dot>
                  {statusLabel[a.status] || a.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {modal && <DrillModal title={modal.title} endpoint={modal.endpoint} onClose={() => setModal(null)} />}
    </div>
  );
}
