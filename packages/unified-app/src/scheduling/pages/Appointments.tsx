import React, { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";

const STATUS_COLORS: Record<string, string> = { SCHEDULED: "bg-blue-100 text-blue-700", RESCHEDULED: "bg-yellow-100 text-yellow-700", CANCELLED: "bg-red-100 text-red-700", PENDING: "bg-slate-100 text-slate-600" };

export default function Appointments() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const socket = useSocket();
  const { data, isLoading } = useQuery({ queryKey: ["appointments"], queryFn: () => api.get("/appointments").then(r => r.data.data) });

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
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-start px-4 py-3">{t("appointments.customer")}</th>
                <th className="text-start px-4 py-3">{t("common.date")}</th>
                <th className="text-start px-4 py-3">{t("appointments.type")}</th>
                <th className="text-start px-4 py-3">{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {(data || []).map((a: any) => (
                <tr key={a.id} className="border-b hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/scheduling/appointments/${a.id}`)}>
                  <td className="px-4 py-3 font-medium">{a.customer?.name}</td>
                  <td className="px-4 py-3">{new Date(a.scheduledDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3">{a.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[a.status] || ""}`}>{a.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}