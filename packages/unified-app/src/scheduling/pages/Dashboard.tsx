import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";

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

function DrillModal({ title, endpoint, onClose }: { title: string; endpoint: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => { const tm = setTimeout(() => setDebouncedSearch(search), 300); return () => clearTimeout(tm); }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ["sched-drill", endpoint, debouncedSearch, page],
    queryFn: () => api.get(`/dashboard/${endpoint}`, { params: { search: debouncedSearch, page, limit: 15 } }).then(r => r.data),
  });

  const items = data?.data || [];
  const total = data?.meta?.total || 0;
  const pages = Math.ceil(total / 15) || 1;
  const isApptList = ["this-month","next-month","overdue","today","urgent"].includes(endpoint);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-bold text-lg text-slate-800">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center">✕</button>
        </div>
        <div className="p-4 border-b">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("dashboard.search")}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? <p className="text-center py-8 text-slate-400 text-sm">{t("dashboard.loading")}</p>
            : items.length === 0 ? <p className="text-center py-8 text-slate-400 text-sm">{t("dashboard.noRecords")}</p>
            : isApptList ? (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0"><tr>
                  <th className="text-start px-4 py-2">{t("appointments.customer")}</th>
                  <th className="text-start px-4 py-2">{t("common.phone")}</th>
                  <th className="text-start px-4 py-2">{t("common.date")}</th>
                  <th className="text-start px-4 py-2">{t("common.status")}</th>
                </tr></thead>
                <tbody>{items.map((a: any) => {
                  let loc: any = {};
                  try { loc = a.urgentLocation ? JSON.parse(a.urgentLocation) : {}; } catch {}
                  const displayName = a.customer?.name || [loc.city, loc.district].filter(Boolean).join("، ") || "زيارة عاجلة";
                  const displayPhone = a.customer?.phone || "—";
                  return (
                    <tr key={a.id} className="border-b hover:bg-slate-50">
                      <td className="px-4 py-2">{displayName}</td>
                      <td className="px-4 py-2 text-slate-500">{displayPhone}</td>
                      <td className="px-4 py-2">{new Date(a.scheduledDate).toLocaleDateString()}</td>
                      <td className="px-4 py-2 text-xs">{a.task?.status || a.status}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0"><tr>
                  <th className="text-start px-4 py-2">{t("common.name")}</th>
                  <th className="text-start px-4 py-2">{t("common.phone")}</th>
                  <th className="text-start px-4 py-2">{t("customers.city")}</th>
                </tr></thead>
                <tbody>{items.map((c: any) => (
                  <tr key={c.id} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium">{c.name}</td>
                    <td className="px-4 py-2 text-slate-500">{c.phone}</td>
                    <td className="px-4 py-2 text-slate-500">{c.address?.city || "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
        </div>
        {total > 15 && (
          <div className="flex items-center justify-between p-3 border-t text-sm">
            <span className="text-slate-500">{total} {t("common.total")}</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p-1)} className="px-3 py-1 border rounded disabled:opacity-40">‹</button>
              <span className="px-2 py-1">{page}/{pages}</span>
              <button disabled={page >= pages} onClick={() => setPage(p => p+1)} className="px-3 py-1 border rounded disabled:opacity-40">›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SchedDashboard() {
  const { t } = useTranslation();
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
    };
    socket.on("task:completed", refresh); socket.on("appointment:created", refresh); socket.on("appointment:deleted", refresh);
    socket.on("appointment:status", refresh);
    socket.on("customer:created", refresh); socket.on("customer:deleted", refresh); socket.on("customers:bulk-deleted", refresh);
    return () => {
      socket.off("task:completed", refresh); socket.off("appointment:created", refresh); socket.off("appointment:deleted", refresh);
      socket.off("appointment:status", refresh);
      socket.off("customer:created", refresh); socket.off("customer:deleted", refresh); socket.off("customers:bulk-deleted", refresh);
    };
  }, [socket, qc]);

  const statusColor: Record<string, string> = {
    COMPLETED: "text-green-600 bg-green-50", IN_PROGRESS: "text-blue-600 bg-blue-50",
    POSTPONED: "text-orange-600 bg-orange-50", PENDING_APPROVAL: "text-yellow-600 bg-yellow-50",
    APPROVED: "text-purple-600 bg-purple-50", NO_TASK: "text-slate-400 bg-slate-50"
  };
  const statusLabel: Record<string, string> = {
    COMPLETED: t("tasks.completed"), IN_PROGRESS: t("tasks.inProgress"),
    POSTPONED: t("tasks.postponed"), PENDING_APPROVAL: t("tasks.pendingApproval"),
    APPROVED: t("tasks.approved"), NO_TASK: "—"
  };

  const cards = [
    { label: t("dashboard.customers"),           key: "total",          endpoint: "customers-list",        color: "border-blue-500" },
    { label: t("dashboard.completedMaintenance"), key: "completed",      endpoint: "completed-maintenance", color: "border-green-500" },
    { label: t("dashboard.thisMonth"),            key: "thisMonth",      endpoint: "this-month",            color: "border-indigo-500" },
    { label: t("dashboard.nextMonth"),            key: "nextMonth",      endpoint: "next-month",            color: "border-purple-500" },
    { label: t("dashboard.dueToday"),             key: "todayCount",     endpoint: "today",                 color: "border-orange-500" },
    { label: t("dashboard.overdueMaintenance"),   key: "pendingApproval",endpoint: "overdue",               color: "border-red-500" },
    { label: t("dashboard.suspendedPostponed"),   key: "pending",        endpoint: "postponed",             color: "border-yellow-500" },
    { label: t("dashboard.urgentAppointments"),   key: "urgentCount",    endpoint: "urgent",                color: "border-rose-500" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {cards.map(c => (
          <StatCard key={c.key} label={c.label} value={stats?.[c.key]} color={c.color}
            onClick={() => setModal({ title: c.label, endpoint: c.endpoint })} />
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-4">
        <h3 className="font-semibold text-slate-800 mb-3">{t("dashboard.recentActivity")}</h3>
        <div className="space-y-1">
          {!(activity?.length) ? (
            <p className="text-center text-slate-400 text-sm py-6">{t("dashboard.noRecentActivity")}</p>
          ) : (activity || []).map((a: any) => (
            <div key={a.customerId} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center text-green-700 font-bold text-sm">
                  {a.customerName?.[0]}
                </div>
                <div>
                  <p className="font-medium text-sm text-slate-800">{a.customerName}</p>
                  <p className="text-xs text-slate-400">{a.phone}</p>
                </div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColor[a.status] || ""}`}>
                {statusLabel[a.status] || a.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {modal && <DrillModal title={modal.title} endpoint={modal.endpoint} onClose={() => setModal(null)} />}
    </div>
  );
}
