import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";

const STATUS_COLORS: Record<string, string> = {
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-700", APPROVED: "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-indigo-100 text-indigo-700", COMPLETED: "bg-green-100 text-green-700", POSTPONED: "bg-orange-100 text-orange-700"
};

export default function Tasks() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const socket = useSocket();
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [techId, setTechId] = useState("");

  useEffect(() => {
    window.dispatchEvent(new Event("clear-badge-tasks-admin"));
  }, []);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      window.dispatchEvent(new Event("clear-badge-tasks-admin"));
    };
    socket.on("task:approved", refresh);
    socket.on("task:completed", refresh);
    socket.on("task:postponed", refresh);
    socket.on("appointment:created", refresh);
    return () => {
      socket.off("task:approved", refresh);
      socket.off("task:completed", refresh);
      socket.off("task:postponed", refresh);
      socket.off("appointment:created", refresh);
    };
  }, [socket, qc]);

  const { data } = useQuery({ queryKey: ["tasks"], queryFn: () => api.get("/tasks").then(r => r.data.data) });
  const { data: techs } = useQuery({ queryKey: ["technicians"], queryFn: () => api.get("/technicians").then(r => r.data.data) });

  const approve = useMutation({
    mutationFn: ({ id, technicianId }: { id: string; technicianId: string }) => api.patch(`/tasks/${id}/approve`, { technicianId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success(t("common.success")); setSelectedTask(null); setTechId(""); }
  });

  const statusLabel: Record<string, string> = {
    PENDING_APPROVAL: t("tasks.pendingApproval"), APPROVED: t("tasks.approved"),
    IN_PROGRESS: t("tasks.inProgress"), COMPLETED: t("tasks.completed"), POSTPONED: t("tasks.postponed"),
  };

  const pending = (data || []).filter((tk: any) => tk.status === "PENDING_APPROVAL");
  const others = (data || []).filter((tk: any) => tk.status !== "PENDING_APPROVAL");

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <h3 className="font-semibold text-yellow-800 mb-3">{t("tasks.pendingApproval")} ({pending.length})</h3>
          <div className="space-y-2">
            {pending.map((task: any) => (
              <div key={task.id} className="bg-white rounded-lg p-3 flex justify-between items-center">
                <div>
                  <p className="font-medium text-sm">{task.appointment?.customer?.name}</p>
                  <p className="text-xs text-slate-400">{new Date(task.appointment?.scheduledDate).toLocaleDateString()} — {task.appointment?.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}</p>
                </div>
                <button onClick={() => { setSelectedTask(task); setTechId(techs?.[0]?.id || ""); }}
                  className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-700">
                  {t("tasks.approve")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-start px-4 py-3">{t("appointments.customer")}</th>
              <th className="text-start px-4 py-3">{t("appointments.technician")}</th>
              <th className="text-start px-4 py-3">{t("common.date")}</th>
              <th className="text-start px-4 py-3">{t("common.status")}</th>
            </tr>
          </thead>
          <tbody>
            {others.map((task: any) => (
              <tr key={task.id} className="border-b hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{task.appointment?.customer?.name}</td>
                <td className="px-4 py-3">{task.technician?.name || "—"}</td>
                <td className="px-4 py-3">{new Date(task.appointment?.scheduledDate).toLocaleDateString()}</td>
                <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[task.status] || ""}`}>{statusLabel[task.status] || task.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedTask && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-80 shadow-xl">
            <h3 className="font-semibold mb-4">{t("tasks.approve")}</h3>
            <p className="text-sm text-slate-600 mb-3">{selectedTask.appointment?.customer?.name}</p>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">{t("tasks.selectTechnician")}</label>
              <select value={techId} onChange={e => setTechId(e.target.value)} className="w-full border rounded-lg px-3 py-2">
                {(techs || []).map((tk: any) => <option key={tk.id} value={tk.id}>{tk.name}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={() => approve.mutate({ id: selectedTask.id, technicianId: techId })} disabled={!techId || approve.isPending}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                {approve.isPending ? t("common.loading") : t("common.save")}
              </button>
              <button onClick={() => setSelectedTask(null)} className="flex-1 border py-2 rounded-lg text-sm hover:bg-slate-50">{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}