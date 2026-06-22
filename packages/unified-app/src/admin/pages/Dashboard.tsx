import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";

const APPT_ENDPOINTS = ["this-month","next-month","overdue","today","urgent"];
const CUSTOMER_ENDPOINTS = ["customers-list","completed-maintenance","postponed"];

// ── Edit Appointment Sub-modal ──────────────────────────────────────────────
function EditApptModal({ appt, onSave, onClose }: { appt: any; onSave: (id: string, data: any) => void; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const [form, setForm] = useState({
    scheduledDate: appt.scheduledDate ? new Date(appt.scheduledDate).toISOString().slice(0,16) : "",
    type: appt.type || "MAINTENANCE",
    status: appt.status || "SCHEDULED",
    notes: appt.notes || "",
  });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-bold text-slate-800">{t("dashboard.editApptTitle")}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500">✕</button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t("common.date")}</label>
            <input type="datetime-local" value={form.scheduledDate} onChange={e => set("scheduledDate", e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t("appointments.type")}</label>
            <select value={form.type} onChange={e => set("type", e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="MAINTENANCE">{t("appointments.maintenance")}</option>
              <option value="INSTALLATION">{t("appointments.installation")}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t("common.status")}</label>
            <select value={form.status} onChange={e => set("status", e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="SCHEDULED">{t("appointments.scheduled")}</option>
              <option value="RESCHEDULED">{t("appointments.rescheduled")}</option>
              <option value="CANCELLED">{t("appointments.cancelled")}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t("common.notes")}</label>
            <textarea rows={3} value={form.notes} onChange={e => set("notes", e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50">{t("common.cancel")}</button>
          <button onClick={() => onSave(appt.id, form)} className="px-4 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800">
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Quick Schedule Sub-modal ─────────────────────────────────────────────────
function QuickScheduleModal({ customer, onClose, onSaved }: { customer: { id: string; name: string }; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [scheduledDate, setScheduledDate] = useState("");
  const [type, setType] = useState("MAINTENANCE");
  const [loading, setLoading] = useState(false);

  async function handleSave() {
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[75] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-bold text-slate-800">📅 {customer.name}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500">✕</button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t("common.date")}</label>
            <input type="datetime-local" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t("appointments.type")}</label>
            <select value={type} onChange={e => setType(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="MAINTENANCE">{t("appointments.maintenance")}</option>
              <option value="INSTALLATION">{t("appointments.installation")}</option>
            </select>
          </div>
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50">{t("common.cancel")}</button>
          <button onClick={handleSave} disabled={loading}
            className="px-4 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50">
            {loading ? "..." : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Drill-down modal ──────────────────────────────────────────────────────
function DrillModal({ title, endpoint, onClose }: { title: string; endpoint: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; type: "customer" | "appointment" } | null>(null);
  const [editingAppt, setEditingAppt] = useState<any | null>(null);
  const [schedulingCustomer, setSchedulingCustomer] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => { const tm = setTimeout(() => setDebouncedSearch(search), 300); return () => clearTimeout(tm); }, [search]);
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const { data, isLoading } = useQuery({
    queryKey: [endpoint, debouncedSearch, page],
    queryFn: () => api.get(`/dashboard/${endpoint}`, { params: { search: debouncedSearch, page, limit: 15 } }).then(r => r.data)
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, type }: { id: string; type: "customer" | "appointment" }) =>
      api.delete(`/dashboard/${type}/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [endpoint] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success(t("dashboard.deleted"));
      setConfirmDelete(null);
    },
    onError: () => toast.error(t("common.error")),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/dashboard/appointment/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [endpoint] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success(t("dashboard.saved"));
      setEditingAppt(null);
    },
    onError: () => toast.error(t("common.error")),
  });

  const items = data?.data || [];
  const total = data?.meta?.total || 0;
  const pages = Math.ceil(total / 15) || 1;
  const isAppointmentList = APPT_ENDPOINTS.includes(endpoint);
  const isCustomerList = CUSTOMER_ENDPOINTS.includes(endpoint);

  const taskColors: Record<string, string> = {
    WAITING: "bg-yellow-100 text-yellow-700",
    IN_PROGRESS: "bg-indigo-100 text-indigo-700",
    COMPLETED: "bg-green-100 text-green-700",
    POSTPONED: "bg-orange-100 text-orange-700",
  };

  return (
    <>
      {schedulingCustomer && (
        <QuickScheduleModal
          customer={schedulingCustomer}
          onClose={() => setSchedulingCustomer(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: [endpoint] }); qc.invalidateQueries({ queryKey: ["dashboard-stats"] }); }}
        />
      )}

      {editingAppt && (
        <EditApptModal
          appt={editingAppt}
          onSave={(id, data) => editMutation.mutate({ id, data })}
          onClose={() => setEditingAppt(null)}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 z-[65] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
            <p className="text-sm font-medium text-slate-700 text-center mb-4">{t("dashboard.deleteConfirm")}</p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50">{t("common.cancel")}</button>
              <button onClick={() => deleteMutation.mutate(confirmDelete)} disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                {deleteMutation.isPending ? "..." : t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="font-bold text-lg text-slate-800">{title}</h3>
            <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500">✕</button>
          </div>
          <div className="p-4 border-b">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("dashboard.search")}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? <p className="text-center py-8 text-slate-400 text-sm">{t("dashboard.loading")}</p>
              : items.length === 0 ? <p className="text-center py-8 text-slate-400 text-sm">{t("dashboard.noRecords")}</p>
              : isAppointmentList ? (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0"><tr>
                    <th className="text-start px-4 py-2 font-medium text-slate-600">{t("appointments.customer")}</th>
                    <th className="text-start px-4 py-2 font-medium text-slate-600">{t("common.phone")}</th>
                    <th className="text-start px-4 py-2 font-medium text-slate-600">{t("common.date")}</th>
                    <th className="text-start px-4 py-2 font-medium text-slate-600">{t("appointments.type")}</th>
                    <th className="text-start px-4 py-2 font-medium text-slate-600">{t("common.status")}</th>
                    <th className="px-4 py-2 w-20"></th>
                  </tr></thead>
                  <tbody>{items.map((a: any) => {
                    let loc: any = {};
                    try { loc = a.urgentLocation ? JSON.parse(a.urgentLocation) : {}; } catch {}
                    const displayName = a.customer?.name || [loc.city, loc.district].filter(Boolean).join("، ") || "Urgent Visit";
                    const displayPhone = a.customer?.phone || "—";
                    return (
                      <tr key={a.id} className="border-b hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium">{displayName}</td>
                        <td className="px-4 py-2.5 text-slate-500">{displayPhone}</td>
                        <td className="px-4 py-2.5">{new Date(a.scheduledDate).toLocaleDateString()}</td>
                        <td className="px-4 py-2.5 text-xs font-medium text-slate-600">{a.type}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${taskColors[a.workStatus] || "bg-slate-100 text-slate-600"}`}>
                            {a.workStatus || a.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <button onClick={() => setEditingAppt(a)} title={t("dashboard.editAppt")}
                              className="w-6 h-6 flex items-center justify-center rounded hover:bg-blue-100 text-blue-600 text-xs">✏️</button>
                            <button onClick={() => setConfirmDelete({ id: a.id, type: "appointment" })} title={t("dashboard.deleteRecord")}
                              className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-100 text-red-500 text-xs">🗑</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0"><tr>
                    <th className="text-start px-4 py-2 font-medium text-slate-600">{t("common.name")}</th>
                    <th className="text-start px-4 py-2 font-medium text-slate-600">{t("common.phone")}</th>
                    <th className="text-start px-4 py-2 font-medium text-slate-600">{t("customers.maintenanceCycle")}</th>
                    <th className="text-start px-4 py-2 font-medium text-slate-600">{t("customers.city")}</th>
                    <th className="px-4 py-2 w-20"></th>
                  </tr></thead>
                  <tbody>{items.map((c: any) => (
                    <tr key={c.id} className="border-b hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium">{c.name}</td>
                      <td className="px-4 py-2.5 text-slate-500">{c.phone}</td>
                      <td className="px-4 py-2.5 text-xs">{c.maintenanceCycle}</td>
                      <td className="px-4 py-2.5 text-slate-500">{c.address?.city || "—"}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <button onClick={() => setSchedulingCustomer({ id: c.id, name: c.name })} title="Schedule"
                            className="w-6 h-6 flex items-center justify-center rounded hover:bg-blue-100 text-blue-600 text-xs">📅</button>
                          <button onClick={() => setConfirmDelete({ id: c.id, type: "customer" })} title={t("dashboard.deleteRecord")}
                            className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-100 text-red-500 text-xs">🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
          </div>
          {total > 15 && (
            <div className="flex items-center justify-between p-3 border-t text-sm">
              <span className="text-slate-500">{total} {t("common.total")}</span>
              <div className="flex gap-2">
                <button disabled={page === 1} onClick={() => setPage(p => p-1)} className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-slate-50">‹</button>
                <span className="px-2 py-1">{page}/{pages}</span>
                <button disabled={page >= pages} onClick={() => setPage(p => p+1)} className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-slate-50">›</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, color, onClick }: { label: string; value: number; color: string; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button onClick={onClick} className={`bg-white rounded-xl p-4 border-s-4 shadow-sm text-start hover:shadow-md hover:-translate-y-0.5 transition-all w-full ${color}`}>
      <p className="text-2xl font-bold text-slate-800">{value ?? "—"}</p>
      <p className="text-slate-500 text-sm mt-1">{label}</p>
      <p className="text-xs text-blue-500 mt-2">{t("dashboard.clickToView")}</p>
    </button>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const socket = useSocket();
  const [modal, setModal] = useState<{ title: string; endpoint: string } | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const { data: stats } = useQuery({ queryKey: ["dashboard-stats"], queryFn: () => api.get("/dashboard/stats").then(r => r.data.data) });
  const { data: activity } = useQuery({ queryKey: ["dashboard-activity"], queryFn: () => api.get("/dashboard/activity").then(r => r.data.data) });

  useEffect(() => {
    if (!socket) return;
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      qc.invalidateQueries({ queryKey: ["dashboard-activity"] });
    };
    socket.on("appointment:created", refresh); socket.on("appointment:deleted", refresh); socket.on("appointment:status", refresh);
    socket.on("appointment:completed", refresh); socket.on("appointment:postponed", refresh);
    socket.on("customer:created", refresh); socket.on("customer:deleted", refresh); socket.on("customers:bulk-deleted", refresh);
    return () => {
      socket.off("appointment:created", refresh); socket.off("appointment:deleted", refresh); socket.off("appointment:status", refresh);
      socket.off("appointment:completed", refresh); socket.off("appointment:postponed", refresh);
      socket.off("customer:created", refresh); socket.off("customer:deleted", refresh); socket.off("customers:bulk-deleted", refresh);
    };
  }, [socket, qc]);

  const deleteActivity = useMutation({
    mutationFn: (customerId: string) => api.delete(`/dashboard/activity/${customerId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard-activity"] })
  });

  const clearAllActivity = useMutation({
    mutationFn: () => api.delete("/dashboard/activity"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dashboard-activity"] }); setConfirmClearAll(false); toast.success(t("dashboard.cleared")); }
  });

  const statusColor: Record<string, string> = {
    COMPLETED: "text-green-600 bg-green-50", IN_PROGRESS: "text-blue-600 bg-blue-50",
    POSTPONED: "text-orange-600 bg-orange-50", WAITING: "text-yellow-600 bg-yellow-50",
    NO_APPOINTMENT: "text-slate-400 bg-slate-50"
  };
  const statusLabel: Record<string, string> = {
    COMPLETED: t("tasks.completed"), IN_PROGRESS: t("tasks.inProgress"),
    POSTPONED: t("tasks.postponed"), WAITING: t("tasks.waiting") || "Waiting",
    NO_APPOINTMENT: "—"
  };

  const cards = [
    { label: t("dashboard.customers"),            key: "total",          endpoint: "customers-list",          color: "border-blue-500" },
    { label: t("dashboard.completedMaintenance"),  key: "completed",      endpoint: "completed-maintenance",   color: "border-green-500" },
    { label: t("dashboard.thisMonth"),             key: "thisMonth",      endpoint: "this-month",              color: "border-indigo-500" },
    { label: t("dashboard.nextMonth"),             key: "nextMonth",      endpoint: "next-month",              color: "border-purple-500" },
    { label: t("dashboard.dueToday"),              key: "todayCount",     endpoint: "today",                   color: "border-orange-500" },
    { label: t("dashboard.suspendedPostponed"),    key: "pending",        endpoint: "postponed",               color: "border-yellow-500" },
    { label: t("dashboard.overdueMaintenance"),    key: "pendingApproval",endpoint: "overdue",                 color: "border-red-500" },
    { label: t("dashboard.urgentAppointments"),    key: "urgentCount",    endpoint: "urgent",                  color: "border-rose-500" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {cards.map(c => (
          <StatCard key={c.key} label={c.label} value={stats?.[c.key]} color={c.color}
            onClick={() => setModal({ title: c.label, endpoint: c.endpoint })} />
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-800">{t("dashboard.recentActivity")}</h3>
          {(activity || []).length > 0 && (
            <button onClick={() => setConfirmClearAll(true)} className="text-xs text-red-500 hover:text-red-700 border border-red-200 px-3 py-1 rounded-lg hover:bg-red-50 transition-colors">
              {t("dashboard.clearAll")}
            </button>
          )}
        </div>
        <div className="space-y-1">
          {(activity || []).length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-6">{t("dashboard.noRecentActivity")}</p>
          ) : (activity || []).map((a: any) => (
            <div key={a.customerId} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-slate-50 group">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-sm flex-shrink-0">
                  {a.customerName?.[0]}
                </div>
                <div>
                  <p className="font-medium text-sm text-slate-800">{a.customerName}</p>
                  <p className="text-xs text-slate-400">{a.phone}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColor[a.status] || ""}`}>
                  {statusLabel[a.status] || a.status.replace(/_/g, " ")}
                </span>
                <button onClick={() => deleteActivity.mutate(a.customerId)}
                  className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded hover:bg-red-100 text-red-400 hover:text-red-600 text-xs flex items-center justify-center transition-all">
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {modal && <DrillModal title={modal.title} endpoint={modal.endpoint} onClose={() => setModal(null)} />}

      {confirmClearAll && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-semibold mb-2">{t("dashboard.clearAllConfirm")}</h3>
            <p className="text-sm text-slate-500 mb-4">{t("dashboard.clearAllDesc")}</p>
            <div className="flex gap-2">
              <button onClick={() => clearAllActivity.mutate()} disabled={clearAllActivity.isPending}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">
                {clearAllActivity.isPending ? t("common.loading") : t("dashboard.clearAll")}
              </button>
              <button onClick={() => setConfirmClearAll(false)} className="flex-1 border py-2 rounded-lg text-sm hover:bg-slate-50">{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
