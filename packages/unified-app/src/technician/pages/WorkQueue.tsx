import React, { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";

const STATUS_COLORS: Record<string, string> = {
  WAITING: "bg-yellow-100 text-yellow-700",
  IN_PROGRESS: "bg-orange-100 text-orange-700",
};

export default function WorkQueue() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const socket = useSocket();

  const { data, isLoading } = useQuery({
    queryKey: ["work-queue"],
    queryFn: () => api.get("/appointments?workStatus=WAITING,IN_PROGRESS").then(r => r.data.data)
  });

  useEffect(() => {
    if (!socket) return;
    const refresh = () => qc.invalidateQueries({ queryKey: ["work-queue"] });
    socket.on("appointment:created", refresh);
    socket.on("appointment:started", refresh);
    socket.on("appointment:completed", refresh);
    socket.on("appointment:postponed", refresh);
    socket.on("appointment:deleted", refresh);
    socket.on("customer:deleted", refresh);
    socket.on("customers:bulk-deleted", refresh);
    return () => {
      socket.off("appointment:created", refresh);
      socket.off("appointment:started", refresh);
      socket.off("appointment:completed", refresh);
      socket.off("appointment:postponed", refresh);
      socket.off("appointment:deleted", refresh);
      socket.off("customer:deleted", refresh);
      socket.off("customers:bulk-deleted", refresh);
    };
  }, [socket, qc]);

  const statusLabel: Record<string, string> = {
    WAITING: t("tasks.waiting") || "Waiting",
    IN_PROGRESS: t("tasks.inProgress"),
  };

  const active = (data || []).filter((appt: any) =>
    ["WAITING", "IN_PROGRESS"].includes(appt.workStatus) && !appt.isUrgent
  );

  if (isLoading) return <p className="text-center py-12">{t("common.loading")}</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t("nav.workQueue")} ({active.length})</h2>
      {active.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center text-slate-400">
          <p className="text-4xl mb-3">✓</p>
          <p>{t("tasks.allCompleted")}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {active.map((appt: any) => {
            const customer = appt.customer;
            const addr = customer?.address;
            return (
              <div key={appt.id} className="bg-white rounded-xl shadow-sm p-4 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/technician/queue/${appt.id}`)}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="font-bold text-base">{customer?.name}</p>
                    <p className="text-slate-500 text-sm">{customer?.phone}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[appt.workStatus] || ""}`}>
                    {statusLabel[appt.workStatus] || appt.workStatus}
                  </span>
                </div>
                {addr && (
                  <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
                    <p><span className="text-slate-400">{t("customers.city")}: </span>{addr.city}</p>
                    <p><span className="text-slate-400">{t("customers.district")}: </span>{addr.district}</p>
                    <p><span className="text-slate-400">{t("customers.street")}: </span>{addr.street}</p>
                    {addr.buildingNo && <p><span className="text-slate-400">{t("customers.buildingNo")}: </span>{addr.buildingNo}</p>}
                  </div>
                )}
                <div className="mt-3 flex justify-between text-xs text-slate-400">
                  <span>{appt.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}</span>
                  <span>{new Date(appt.scheduledDate).toLocaleDateString()}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
