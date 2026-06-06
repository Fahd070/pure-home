import React, { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSocket } from "../hooks/useSocket";
import { api } from "../api/client";

export default function Notifications() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const socket = useSocket();
  const { data, isLoading } = useQuery({ queryKey: ["notifications-sched"], queryFn: () => api.get("/notifications").then(r => r.data.data) });
  const markAll = useMutation({ mutationFn: () => api.patch("/notifications/read-all"), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications-sched"] }) });
  const markOne = useMutation({ mutationFn: (id: string) => api.patch("/notifications/" + id + "/read"), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications-sched"] }) });
  useEffect(() => {
    if (!socket) return;
    socket.on("notification:new", () => qc.invalidateQueries({ queryKey: ["notifications-sched"] }));
    return () => { socket.off("notification:new"); };
  }, [socket, qc]);
  const unread = (data || []).filter((n: any) => !n.isRead).length;
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-700">{t("notifications.maintenanceReminders")}</h2>
          <p className="text-xs text-slate-400 mt-0.5">{t("notifications.upcomingNotice")}</p>
        </div>
        {unread > 0 && (
          <button onClick={() => markAll.mutate()} className="text-xs text-green-600 hover:underline border border-green-200 px-3 py-1 rounded-lg hover:bg-green-50">
            {t("notifications.markAllRead")}
          </button>
        )}
      </div>
      {isLoading ? (
        <p className="text-center py-12 text-slate-400">{t("common.loading")}</p>
      ) : !data?.length ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center text-slate-400">
          <p className="text-3xl mb-2">🔔</p>
          <p>{t("notifications.noReminders")}</p>
          <p className="text-xs mt-1">{t("notifications.remindersInfo")}</p>
        </div>
      ) : (data || []).map((n: any) => (
        <div key={n.id}
          className={"bg-white rounded-xl shadow-sm p-4 flex items-start gap-3 cursor-pointer hover:bg-slate-50 " + (!n.isRead ? "border-s-4 border-green-500" : "")}
          onClick={() => !n.isRead && markOne.mutate(n.id)}>
          <div className={"w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0 " + (n.isRead ? "bg-slate-100" : "bg-green-100")}>🔔</div>
          <div className="flex-1">
            <p className={"text-sm font-medium " + (n.isRead ? "text-slate-600" : "text-slate-900")}>{n.title}</p>
            <p className="text-sm text-slate-500 mt-0.5">{n.body}</p>
            <p className="text-xs text-slate-400 mt-1">{new Date(n.createdAt).toLocaleString()}</p>
          </div>
          {!n.isRead && <span className="w-2 h-2 rounded-full bg-green-500 mt-1.5 flex-shrink-0" />}
        </div>
      ))}
    </div>
  );
}