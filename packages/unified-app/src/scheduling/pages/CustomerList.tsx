import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";
import PreviousMaintenanceNoteBox from "../../components/PreviousMaintenanceNoteBox";
import { dateOnlyToApiDate, formatGregorianDate } from "../../utils/dateTimeInput";

function formatCycle(cycle: string, freq: number, t: any) {
  const n = Number(freq) || 1;
  if (cycle === "DAILY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.day") : t("customers.days")}`;
  if (cycle === "WEEKLY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.week") : t("customers.weeks")}`;
  if (cycle === "MONTHLY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.month") : t("customers.months")}`;
  return cycle;
}

function MaintenanceBadge({ c, t }: { c: any; t: any }) {
  if (c.alertLevel === "overdue") return (
    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
      🔴 {t("countdown.overdueBy", { days: c.overdueCount })}
    </span>
  );
  if (c.alertLevel === "soon") {
    const label = c.daysUntil === 0 ? t("countdown.dueToday") : c.daysUntil === 1 ? t("countdown.dueTomorrow") : t("countdown.dueIn", { days: c.daysUntil });
    return (
      <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
        🟡 {label}
      </span>
    );
  }
  if (c.daysUntil !== null) return (
    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full whitespace-nowrap">
      🟢 {t("countdown.dueIn", { days: c.daysUntil })}
    </span>
  );
  return null;
}

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-700",
  RESCHEDULED: "bg-yellow-100 text-yellow-700",
  CANCELLED: "bg-red-100 text-red-700",
  PENDING: "bg-slate-100 text-slate-600",
  COMPLETED: "bg-green-100 text-green-700",
  IN_PROGRESS: "bg-orange-100 text-orange-700",
  POSTPONED: "bg-purple-100 text-purple-700",
  APPROVED: "bg-teal-100 text-teal-700",
  PENDING_APPROVAL: "bg-slate-100 text-slate-600",
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl space-y-4">
        <h3 className="font-semibold text-slate-800">
          {t("scheduling.scheduleMaintenance")} — {customer.name}
        </h3>
        <PreviousMaintenanceNoteBox note={prevNote} />
        <div>
          <label className="block text-sm font-medium mb-1">{t("appointments.type")}</label>
          <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 text-sm">
            <option value="MAINTENANCE">{t("appointments.maintenance")}</option>
            <option value="INSTALLATION">{t("appointments.installation")}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("common.date")} *</label>
          <input type="date" lang="en-GB" dir="ltr" value={form.date}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("common.notes")}</label>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 text-sm resize-none" />
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={() => schedule.mutate()} disabled={!scheduledDate || schedule.isPending}
            style={{ backgroundColor: "#008000" }}
            className="flex-1 text-white py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {schedule.isPending ? t("common.loading") : t("scheduling.scheduleMaintenance")}
          </button>
          <button onClick={onClose} className="flex-1 border py-2 rounded-lg text-sm hover:bg-slate-50">
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
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

  function apptStatusColor(a: any) {
    if (a.isUrgent && a.urgentVisitRecord) return STATUS_COLORS.COMPLETED;
    return STATUS_COLORS[a.workStatus || a.status] || "bg-slate-100 text-slate-600";
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">
              {t("scheduling.maintenanceHistory")} — {customer.name}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {customer.secondaryPhone ? `${t("customers.primaryPhone")}: ${customer.phone}` : customer.phone}
              {customer.secondaryPhone && <span className="ms-2">{t("customers.secondaryPhone")}: {customer.secondaryPhone}</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-500 mb-1">{t("scheduling.lastMaintenance")}</p>
            <p className="text-sm font-medium">
              {lastMaint
                ? formatGregorianDate(lastMaint.scheduledDate)
                : t("scheduling.noLast")}
            </p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-500 mb-1">{t("scheduling.nextMaintenance")}</p>
            <p className="text-sm font-medium">
              {nextMaintenance
                ? formatGregorianDate(nextMaintenance)
                : t("scheduling.noNext")}
            </p>
          </div>
        </div>

        {customer.previousServiceType && (
          <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
            <p className="text-xs text-slate-500 mb-1 font-medium">{t("customers.previousService")}</p>
            <p>
              <span className="text-slate-400">{t("customers.previousService")}: </span>
              {customer.previousServiceType === "INSTALLATION" ? t("customers.previousInstallation") : t("customers.previousMaintenance")}
            </p>
            <p>
              <span className="text-slate-400">{t("customers.previousServiceDate")}: </span>
              <span dir="ltr">{formatGregorianDate(customer.previousServiceDate)}</span>
            </p>
            {customer.previousServiceNote && (
              <p>
                <span className="text-slate-400">{t("customers.previousServiceNote")}: </span>
                {customer.previousServiceNote}
              </p>
            )}
          </div>
        )}

        {isLoading ? (
          <p className="text-center py-6 text-slate-400">{t("common.loading")}</p>
        ) : !appointments.length ? (
          <p className="text-center py-6 text-slate-400">{t("scheduling.noHistory")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-start px-3 py-2">{t("common.date")}</th>
                  <th className="text-start px-3 py-2">{t("appointments.type")}</th>
                  <th className="text-start px-3 py-2">{t("common.status")}</th>
                  <th className="text-start px-3 py-2">{t("appointments.technician")}</th>
                  <th className="text-start px-3 py-2">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((a: any) => (
                  <React.Fragment key={a.id}>
                    <tr className="border-b hover:bg-slate-50">
                      <td className="px-3 py-2 whitespace-nowrap" dir="ltr">
                        {formatGregorianDate(a.scheduledDate)}
                      </td>
                      <td className="px-3 py-2">
                        {a.isUrgent
                          ? `${t("urgentAppts.title")} — ${a.urgentVisitRecord?.serviceType === "INSTALLATION" ? t("appointments.installation") : a.urgentVisitRecord?.serviceType === "VISIT_ONLY" ? t("urgentAppts.visitOnly") : t("appointments.maintenance")}`
                          : a.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}
                      </td>
                      <td className="px-3 py-2">
                        <span className={"text-xs px-2 py-0.5 rounded font-medium " + apptStatusColor(a)}>
                          {t(apptStatusKey(a))}
                        </span>
                      </td>
                      <td className="px-3 py-2">{a.urgentVisitRecord?.submittedBy?.name || a.technician?.name || "—"}</td>
                      <td className="px-3 py-2">
                        {(a.status === "SCHEDULED" || a.status === "RESCHEDULED" || a.status === "PENDING") && (
                          <button onClick={() => cancelAppt.mutate(a.id)} disabled={cancelAppt.isPending}
                            className="text-xs text-red-600 hover:underline disabled:opacity-50">
                            {t("appointments.cancelled")}
                          </button>
                        )}
                      </td>
                    </tr>
                    {a.workStatus === "COMPLETED" && (
                      <tr className="border-b bg-slate-50/70">
                        <td colSpan={5} className="px-3 py-1.5 text-xs text-slate-600">
                          {a.actualCompletionDate && (
                            <span className="me-3"><span className="font-medium">{t("tasks.completionDate")}:</span> <span dir="ltr">{formatGregorianDate(a.actualCompletionDate)}</span></span>
                          )}
                          <span className={`px-2 py-0.5 rounded-full font-medium ${a.maintenanceConfirmed ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"}`}>
                            {a.maintenanceConfirmed ? t("appointments.operationConfirmed") : t("appointments.awaitingMaintenanceConfirmation")}
                          </span>
                        </td>
                      </tr>
                    )}
                    {a.nextMaintenanceNote && (
                      <tr className="border-b bg-blue-50/50">
                        <td colSpan={5} className="px-3 py-1.5 text-xs text-blue-700">
                          <span className="font-medium">{t("tasks.nextMaintenanceNote")}:</span> {a.nextMaintenanceNote}
                        </td>
                      </tr>
                    )}
                    {a.isUrgent && a.urgentVisitRecord && (
                      <tr className="border-b bg-rose-50/50">
                        <td colSpan={5} className="px-3 py-1.5 text-xs text-rose-700">
                          <span className="font-medium">{t("urgentAppts.serviceDetails")}:</span> {a.urgentVisitRecord.serviceDetails || a.urgentVisitRecord.serviceNotes || a.urgentVisitRecord.notes || "—"}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
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

  return (
    <div className="space-y-4">
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("common.search")}
        className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <p className="text-center py-8 text-slate-400">{t("common.loading")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-start px-4 py-3">{t("common.name")}</th>
                <th className="text-start px-4 py-3">{t("common.phone")}</th>
                <th className="text-start px-4 py-3">{t("customers.maintenanceCycle")}</th>
                <th className="text-start px-4 py-3">{t("reports.nextMaintenance")}</th>
                <th className="text-start px-4 py-3">{t("customers.city")}</th>
                <th className="text-start px-4 py-3">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.data || []).map((c: any) => (
                <tr key={c.id} onClick={() => navigate(`/scheduling/customers/${c.id}`)} className="border-b hover:bg-slate-50 cursor-pointer">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3">{c.phone}</td>
                  <td className="px-4 py-3 text-green-700 font-medium text-xs">
                    {formatCycle(c.maintenanceCycle, c.maintenanceFrequency, t)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <MaintenanceBadge c={c} t={t} />
                      {c.nextMaintenance && (
                        <p className="text-xs text-slate-400" dir="ltr">{formatGregorianDate(c.nextMaintenance)}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">{c.address?.city || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={event => { event.stopPropagation(); setScheduleModal(c); }}
                        style={{ backgroundColor: "#008000" }}
                        className="text-white text-xs px-3 py-1.5 rounded-lg hover:opacity-90 font-medium whitespace-nowrap">
                        📅 {t("scheduling.scheduleMaintenance")}
                      </button>
                      <button onClick={event => { event.stopPropagation(); setHistoryModal(c); }}
                        className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 whitespace-nowrap">
                        📋 {t("scheduling.viewHistory")}
                      </button>
                      <button onClick={event => { event.stopPropagation(); navigate(`/scheduling/customers/${c.id}/edit`); }}
                        className="text-xs px-3 py-1.5 rounded-lg border border-green-200 text-green-700 hover:bg-green-50 whitespace-nowrap">
                        {t("customers.edit")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
