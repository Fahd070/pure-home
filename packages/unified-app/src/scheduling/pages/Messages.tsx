import React, { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSocket } from "../hooks/useSocket";
import { api } from "../api/client";
import { formatGregorianDate } from "../../utils/dateTimeInput";
import { Badge } from "../../ui/Badge";
import { PageHeader } from "../../ui/Surface";
import { EmptyState, Loading } from "../../ui/Feedback";
import { Icon, IconName } from "../../ui/icons";

const ENTITY_ICONS: Record<string, IconName> = {
  customer: "customers",
  appointment: "appointments",
  task: "technicians",
};

function formatTime(d: string, lang: string) {
  const date = new Date(d);
  const diff = Date.now() - date.getTime();
  const isAr = lang === "ar";
  if (diff < 60000) return isAr ? "الآن" : "Just now";
  const mins = Math.floor(diff / 60000);
  if (diff < 3600000) return isAr ? `${mins} د` : `${mins}m ago`;
  const hrs = Math.floor(diff / 3600000);
  if (diff < 86400000) return isAr ? `${hrs} س` : `${hrs}h ago`;
  return formatGregorianDate(date);
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
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title={t("messages.systemActivityLog")}
        actions={<span className="text-2xs text-fg-muted">{t("messages.liveUpdates")}</span>}
      />

      {isLoading ? (
        <Loading label={t("messages.loadingActivity")} />
      ) : !data?.length ? (
        <div className="bg-surface border border-line rounded-md">
          <EmptyState
            icon={<Icon name="messages" className="w-5 h-5" />}
            title={t("messages.noActivity")}
            description={t("messages.activityEvents")}
          />
        </div>
      ) : (
        // A log is read top-to-bottom, so it is one continuous list of rows
        // rather than a stack of separate cards with gaps between them.
        <ul className="bg-surface border border-line rounded-md divide-y divide-line-subtle overflow-hidden">
          {(data || []).map((log: any) => (
            <li key={log.id} className="px-3 py-2.5 flex items-start gap-3">
              <span
                className="w-7 h-7 rounded-md bg-surface-active text-fg-secondary text-2xs font-semibold flex items-center justify-center flex-shrink-0 mt-0.5"
                aria-hidden="true"
              >
                {log.user?.name?.[0] || "?"}
              </span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[0.8125rem] font-medium text-fg">{log.user?.name}</span>
                  <Badge tone="neutral">{t(`roles.${log.user?.role}`) || log.user?.role}</Badge>
                </div>
                <p className="text-[0.8125rem] text-fg-secondary mt-0.5">{(() => {
                  const [en, ar] = (log.action || '').split('|||');
                  return i18n.language === 'ar' ? (ar || en) : en;
                })()}</p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0 text-fg-muted">
                <Icon name={ENTITY_ICONS[log.entityType] || "info"} className="w-4 h-4" />
                <span className="text-2xs whitespace-nowrap">{formatTime(log.createdAt, i18n.language)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
