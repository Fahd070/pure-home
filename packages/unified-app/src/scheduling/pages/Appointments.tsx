import React, { useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";

const STATUS_COLORS: Record<string, string> = { SCHEDULED: "bg-blue-100 text-blue-700", RESCHEDULED: "bg-yellow-100 text-yellow-700", CANCELLED: "bg-red-100 text-red-700", PENDING: "bg-slate-100 text-slate-600" };

export default function Appointments() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const socket = useSocket();
  const { data, isLoading } = useQuery({ queryKey: ["appointments"], queryFn: () => api.get("/appointments").then(r => r.data.data) });

  const exportMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/appointments/${id}/export-to-technicians`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast.success(t("appointments.exportSuccess"));
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || t("appointments.exportError")),
  });

  // Modification #8: Scheduling reviews and explicitly confirms a Technician's
  // completion report. Never auto-approved.
  const confirmOperationMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/appointments/${id}/confirm-operation`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast.success(t("appointments.confirmOperationSuccess"));
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || t("appointments.confirmOperationError")),
  });

  useEffect(() => {
    if (!socket) return;
    const refresh = () => qc.invalidateQueries({ queryKey: ["appointments"] });
    socket.on("appointment:created", refresh);
    socket.on("appointment:status", refresh);
    socket.on("appointment:deleted", refresh);
    socket.on("customer:deleted", refresh);
    socket.on("customers:bulk-deleted", refresh);
    return () => {
      socket.off("appointment:created", refresh);
      socket.off("appointment:status", refresh);
      socket.off("appointment:deleted", refresh);
      socket.off("customer:deleted", refresh);
      socket.off("customers:bulk-deleted", refresh);
    };
  }, [socket, qc]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => navigate("/scheduling/appointments/new")} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 text-sm font-medium">
          + {t("appointments.new")}
        </button>
      </div>
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? <p className="text-center py-8 text-slate-400">{t("common.loading")}</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[600px]">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-start px-4 py-3">{t("appointments.customer")}</th>
                <th className="text-start px-4 py-3">{t("common.date")}</th>
                <th className="text-start px-4 py-3">{t("appointments.type")}</th>
                <th className="text-start px-4 py-3">{t("common.status")}</th>
                <th className="text-start px-4 py-3">{t("appointments.export")}</th>
                <th className="text-start px-4 py-3">{t("appointments.confirmOperation")}</th>
              </tr>
            </thead>
            <tbody>
              {(data || []).map((a: any) => {
                // State machine (visibleToTechnician, adminApproved): (true,false) =
                // never exported -- eligible to export. (false,false) = pending Admin
                // approval. (true,true) = exported and approved. Urgent appointments
                // never appear in this list (server already excludes them for
                // Scheduling), so the export action is always relevant here.
                const isPending = !a.visibleToTechnician && !a.adminApproved;
                const isApproved = a.visibleToTechnician && a.adminApproved;
                return (
                  <tr key={a.id} className="border-b hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/scheduling/appointments/${a.id}`)}>
                    <td className="px-4 py-3 font-medium">{a.customer?.name}</td>
                    <td className="px-4 py-3">{new Date(a.scheduledDate).toLocaleDateString()}</td>
                    <td className="px-4 py-3">{a.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[a.status] || ""}`}>{a.status}</span></td>
                    <td className="px-4 py-3">
                      {isPending ? (
                        <span className="text-xs px-2 py-1 rounded-full font-medium bg-orange-100 text-orange-700 whitespace-nowrap">
                          {t("appointments.exportPending")}
                        </span>
                      ) : isApproved ? (
                        <span className="text-xs px-2 py-1 rounded-full font-medium bg-green-100 text-green-700 whitespace-nowrap">
                          {t("appointments.exportApproved")}
                        </span>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); exportMutation.mutate(a.id); }}
                          disabled={exportMutation.isPending}
                          className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 whitespace-nowrap disabled:opacity-50 transition-colors">
                          {t("appointments.export")}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {a.workStatus !== "COMPLETED" ? (
                        <span className="text-slate-300 text-xs">—</span>
                      ) : a.maintenanceConfirmed ? (
                        <span className="text-xs px-2 py-1 rounded-full font-medium bg-green-100 text-green-700 whitespace-nowrap">
                          {t("appointments.operationConfirmed")}
                        </span>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); confirmOperationMutation.mutate(a.id); }}
                          disabled={confirmOperationMutation.isPending}
                          className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 whitespace-nowrap disabled:opacity-50 transition-colors">
                          {t("appointments.confirmOperation")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
