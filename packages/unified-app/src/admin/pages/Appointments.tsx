import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import toast from "react-hot-toast";

const STATUS_COLORS: Record<string, string> = { SCHEDULED: "bg-blue-100 text-blue-700", RESCHEDULED: "bg-yellow-100 text-yellow-700", CANCELLED: "bg-red-100 text-red-700", PENDING: "bg-slate-100 text-slate-600" };

export default function Appointments() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["appointments", filter],
    queryFn: () => api.get("/appointments", { params: filter ? { status: filter } : {} }).then(r => r.data.data)
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/appointments/${id}/status`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["appointments"] }); toast.success(t("common.success")); }
  });

  const statusKey: Record<string, string> = { SCHEDULED: t("appointments.scheduled"), RESCHEDULED: t("appointments.rescheduled"), CANCELLED: t("appointments.cancelled"), PENDING: t("appointments.pending") };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {["", "SCHEDULED", "RESCHEDULED", "CANCELLED", "PENDING"].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm border ${filter === s ? "bg-blue-600 text-white border-blue-600" : "hover:bg-slate-50"}`}>
            {s ? (statusKey[s] || s) : t("common.all")}
          </button>
        ))}
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
                <th className="text-start px-4 py-3">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {(data || []).map((a: any) => (
                <tr key={a.id} className="border-b hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{a.customer?.name}</td>
                  <td className="px-4 py-3">{new Date(a.scheduledDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3">{a.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[a.status] || ""}`}>{statusKey[a.status] || a.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <select className="text-xs border rounded px-1 py-0.5" value={a.status} onChange={e => changeStatus.mutate({ id: a.id, status: e.target.value })}>
                      {["SCHEDULED","RESCHEDULED","CANCELLED","PENDING"].map(s => (
                        <option key={s} value={s}>{statusKey[s] || s}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}