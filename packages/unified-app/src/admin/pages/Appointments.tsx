import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED:   "bg-blue-100 text-blue-700",
  RESCHEDULED: "bg-yellow-100 text-yellow-700",
  CANCELLED:   "bg-red-100 text-red-700",
  PENDING:     "bg-slate-100 text-slate-600",
};

const EMPTY_FORM = { customerId: "", customerSearch: "", scheduledDate: "", type: "MAINTENANCE", notes: "" };

export default function Appointments() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const socket = useSocket();
  const [filter, setFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editAppt, setEditAppt] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const { data, isLoading } = useQuery({
    queryKey: ["appointments", filter],
    queryFn: () => api.get("/appointments", { params: filter ? { status: filter } : {} }).then(r => r.data.data || []),
  });

  const { data: customersData } = useQuery({
    queryKey: ["customers-select"],
    queryFn: () => api.get("/customers", { params: { limit: 500 } }).then(r => r.data.data || []),
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post("/appointments", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast.success(t("common.success"));
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
    },
    onError: () => toast.error(t("common.error")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.put(`/appointments/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast.success(t("common.success"));
      setEditAppt(null);
    },
    onError: () => toast.error(t("common.error")),
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status, notes }: { id: string; status: string; notes?: string }) =>
      api.patch(`/appointments/${id}/status`, { status, notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["appointments"] }); toast.success(t("common.success")); },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/appointments/${id}/approve-visibility`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast.success(isAr ? "تم إظهار الموعد للجدولة" : "Appointment visible to Scheduling");
    },
    onError: () => toast.error(t("common.error")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/appointments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success(isAr ? "تم حذف الموعد" : "Appointment deleted");
    },
    onError: () => toast.error(t("common.error")),
  });

  useEffect(() => {
    if (!socket) return;
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    };
    socket.on("appointment:deleted", refresh);
    socket.on("customer:deleted", refresh);
    socket.on("customers:bulk-deleted", refresh);
    return () => {
      socket.off("appointment:deleted", refresh);
      socket.off("customer:deleted", refresh);
      socket.off("customers:bulk-deleted", refresh);
    };
  }, [socket, qc]);

  const statusKey: Record<string, string> = {
    SCHEDULED:   t("appointments.scheduled"),
    RESCHEDULED: t("appointments.rescheduled"),
    CANCELLED:   t("appointments.cancelled"),
    PENDING:     t("appointments.pending"),
  };

  const allCustomers: any[] = customersData || [];
  const filteredCustomers = useMemo(() => {
    if (!form.customerSearch.trim()) return allCustomers;
    const q = form.customerSearch.toLowerCase();
    return allCustomers.filter((c: any) => c.name?.toLowerCase().includes(q) || c.phone?.includes(q));
  }, [allCustomers, form.customerSearch]);

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setEditAppt(null);
    setShowForm(true);
  }

  function openEdit(a: any) {
    const cust = allCustomers.find((c: any) => c.id === (a.customerId || a.customer?.id));
    setForm({
      customerId: a.customerId || a.customer?.id || "",
      customerSearch: cust ? `${cust.name} — ${cust.phone}` : "",
      scheduledDate: a.scheduledDate ? a.scheduledDate.slice(0, 16) : "",
      type: a.type || "MAINTENANCE",
      notes: a.notes || "",
    });
    setEditAppt(a);
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customerId || !form.scheduledDate) return;
    const body = {
      customerId: form.customerId,
      scheduledDate: form.scheduledDate,
      type: form.type,
      notes: form.notes || undefined,
      visibleToScheduling: true,
      createdByRole: "ADMIN",
    };
    if (editAppt) {
      updateMutation.mutate({ id: editAppt.id, body });
    } else {
      createMutation.mutate(body);
    }
  }

  const appointments: any[] = data || [];
  // Only show pending-approval banner for Scheduling-created appointments
  const pendingSchedulingAppts = appointments.filter(a => !a.visibleToScheduling && a.createdByRole === 'SCHEDULING');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-slate-800">{t("appointments.title")}</h1>
        <button onClick={openCreate} style={{ backgroundColor: "#000080" }}
          className="text-white text-sm px-4 py-2 rounded-lg hover:opacity-90">
          + {t("appointments.new")}
        </button>
      </div>

      {pendingSchedulingAppts.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-2 text-sm text-orange-700">
          {isAr
            ? `${pendingSchedulingAppts.length} موعد من الجدولة بانتظار الإظهار — استخدم "إظهار للجدولة"`
            : `${pendingSchedulingAppts.length} scheduling appointment(s) pending — use "Show to Scheduling" to approve`}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {["", "SCHEDULED", "RESCHEDULED", "CANCELLED", "PENDING"].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm border ${filter === s ? "bg-blue-600 text-white border-blue-600" : "hover:bg-slate-50"}`}>
            {s ? (statusKey[s] || s) : t("common.all")}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold text-slate-700 mb-4">
            {editAppt ? t("common.edit") : t("appointments.new")}
          </h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("appointments.customer")}</label>
              <input
                value={form.customerSearch}
                onChange={e => setForm(f => ({ ...f, customerSearch: e.target.value, customerId: "" }))}
                placeholder={isAr ? "ابحث بالاسم أو الجوال..." : "Search by name or phone..."}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-1" />
              {form.customerSearch && !form.customerId && (
                <div className="border rounded-lg max-h-40 overflow-y-auto bg-white shadow-sm z-10">
                  {filteredCustomers.length === 0 ? (
                    <p className="text-xs text-slate-400 px-3 py-2">{t("common.noRecords")}</p>
                  ) : filteredCustomers.slice(0, 8).map((c: any) => (
                    <button key={c.id} type="button"
                      onClick={() => setForm(f => ({ ...f, customerId: c.id, customerSearch: `${c.name} — ${c.phone}` }))}
                      className="w-full text-start px-3 py-2 text-sm hover:bg-blue-50 border-b last:border-b-0">
                      <span className="font-medium">{c.name}</span> <span className="text-slate-400">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
              {form.customerId && <p className="text-xs text-blue-600">✓ {isAr ? "تم اختيار العميل" : "Customer selected"}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("common.date")}</label>
              <input type="datetime-local" required value={form.scheduledDate}
                onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("appointments.type")}</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="MAINTENANCE">{t("appointments.maintenance")}</option>
                <option value="INSTALLATION">{t("appointments.installation")}</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("common.notes")}</label>
              <textarea rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>
            <div className="col-span-2 flex gap-2 justify-end">
              <button type="button" onClick={() => { setShowForm(false); setEditAppt(null); }}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50">{t("common.cancel")}</button>
              <button type="submit" disabled={createMutation.isPending || updateMutation.isPending || !form.customerId}
                style={{ backgroundColor: "#000080" }}
                className="text-white text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50">
                {(createMutation.isPending || updateMutation.isPending) ? "..." : t("common.save")}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? <p className="text-center py-8 text-slate-400">{t("common.loading")}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-start px-4 py-3">{t("appointments.customer")}</th>
                  <th className="text-start px-4 py-3">{t("common.date")}</th>
                  <th className="text-start px-4 py-3">{t("appointments.type")}</th>
                  <th className="text-start px-4 py-3">{t("common.status")}</th>
                  <th className="text-start px-4 py-3">{isAr ? "المصدر" : "Source"}</th>
                  <th className="text-start px-4 py-3">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((a: any) => (
                  <tr key={a.id} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">
                      {a.customer?.name || (a.isUrgent ? <span className="text-red-600">🚨 {isAr ? "زيارة عاجلة" : "Urgent Visit"}</span> : "—")}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {new Date(a.scheduledDate).toLocaleDateString(isAr ? "ar-SA" : undefined)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {a.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}
                      {a.isUrgent && <span className="ms-1 bg-red-100 text-red-600 px-1 rounded">🚨</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[a.status] || ""}`}>
                        {statusKey[a.status] || a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {a.createdByRole === 'ADMIN'
                        ? (isAr ? "الإدارة" : "Admin")
                        : a.createdByRole === 'SCHEDULING'
                          ? (isAr ? "الجدولة" : "Scheduling")
                          : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 items-center">
                        <button onClick={() => openEdit(a)}
                          className="text-xs border px-2 py-1 rounded hover:bg-slate-50 text-slate-600">
                          {t("common.edit")}
                        </button>
                        <select className="text-xs border rounded px-1 py-0.5" value={a.status}
                          onChange={e => changeStatus.mutate({ id: a.id, status: e.target.value })}>
                          {["SCHEDULED","RESCHEDULED","CANCELLED","PENDING"].map(s => (
                            <option key={s} value={s}>{statusKey[s] || s}</option>
                          ))}
                        </select>
                        {/* Only show "Show to Scheduling" for Scheduling-created hidden appointments */}
                        {!a.visibleToScheduling && a.createdByRole === 'SCHEDULING' && (
                          <button onClick={() => approveMutation.mutate(a.id)} disabled={approveMutation.isPending}
                            className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 whitespace-nowrap disabled:opacity-50">
                            {isAr ? "إظهار للجدولة" : "Show to Scheduling"}
                          </button>
                        )}
                        <button
                          onClick={() => { if (confirm(isAr ? "حذف هذا الموعد نهائياً؟" : "Permanently delete this appointment?")) deleteMutation.mutate(a.id); }}
                          disabled={deleteMutation.isPending}
                          className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 disabled:opacity-50">
                          {isAr ? "حذف" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
