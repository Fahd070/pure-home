import React, { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSocket } from "../hooks/useSocket";
import { api } from "../api/client";

const ROLE_BG: Record<string, string> = { ADMIN: "bg-blue-700", SCHEDULING: "bg-green-700", TECHNICIAN: "bg-orange-700" };
const ROLE_BADGE: Record<string, string> = { ADMIN: "bg-blue-100 text-blue-700", SCHEDULING: "bg-green-100 text-green-700", TECHNICIAN: "bg-orange-100 text-orange-700" };
const ENTITY_ICONS: Record<string, string> = { customer: "👤", appointment: "📅", task: "🔧" };

function formatTime(d: string, lang: string) {
  const date = new Date(d);
  const diff = Date.now() - date.getTime();
  const isAr = lang === "ar";
  if (diff < 60000) return isAr ? "الآن" : "Just now";
  const mins = Math.floor(diff / 60000);
  if (diff < 3600000) return isAr ? `${mins} د` : `${mins}m ago`;
  const hrs = Math.floor(diff / 3600000);
  if (diff < 86400000) return isAr ? `${hrs} س` : `${hrs}h ago`;
  return date.toLocaleDateString(isAr ? "ar-SA" : undefined);
}

export default function Messages() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const socket = useSocket();

  const { data, isLoading } = useQuery({
    queryKey: ["activity-feed-sched"],
    queryFn: () => api.get("/messages").then(r => r.data.data)
  });

  useEffect(() => {
    if (!socket) return;
    socket.on("audit:new", () => qc.invalidateQueries({ queryKey: ["activity-feed-sched"] }));
    socket.on("audit:deleted", (data: any) => {
      if (data.all) {
        qc.setQueryData(["activity-feed-sched"], []);
      } else {
        qc.setQueryData(["activity-feed-sched"], (old: any[]) => (old || []).filter((item: any) => item.id !== data.id));
      }
    });
    return () => { socket.off("audit:new"); socket.off("audit:deleted"); };
  }, [socket, qc]);

  useEffect(() => {
    localStorage.setItem("msg-last-seen-sched", Date.now().toString());
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-700">{t("messages.systemActivityLog")}</h2>
        <span className="text-xs text-slate-400">{t("messages.liveUpdates")}</span>
      </div>

      {isLoading ? (
        <p className="text-center py-12 text-slate-400">{t("messages.loadingActivity")}</p>
      ) : !data?.length ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center text-slate-400">
          <p className="text-3xl mb-2">📋</p>
          <p>{t("messages.noActivity")}</p>
          <p className="text-xs mt-1">{t("messages.activityEvents")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(data || []).map((log: any) => (
            <div key={log.id} className="bg-white rounded-xl shadow-sm p-4 flex items-start gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${ROLE_BG[log.user?.role] || "bg-slate-400"}`}>
                {log.user?.name?.[0] || "?"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="font-medium text-sm text-slate-800">{log.user?.name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ROLE_BADGE[log.user?.role] || "bg-slate-100 text-slate-600"}`}>
                    {t(`roles.${log.user?.role}`) || log.user?.role}
                  </span>
                </div>
                <p className="text-sm text-slate-700">{log.action}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-lg">{ENTITY_ICONS[log.entityType] || "📌"}</span>
                <span className="text-xs text-slate-400 whitespace-nowrap">{formatTime(log.createdAt, i18n.language)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
