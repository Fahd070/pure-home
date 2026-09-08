import React, { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import { formatGregorianDate } from "../../utils/dateTimeInput";
import { fetchAllPages } from "../../utils/fetchAllPages";
import { Badge, Tone } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { EmptyState, Loading } from "../../ui/Feedback";
import { Icon } from "../../ui/icons";
import { cx } from "../../ui/cx";

const STATUS_TONE: Record<string, Tone> = {
  WAITING: "pending",
  IN_PROGRESS: "progress",
};

/**
 * The date key a job is grouped under MUST match the date printed on its row.
 * formatGregorianDate extracts UTC parts by default, so grouping compares UTC
 * date strings too -- deriving "today" from the local calendar day instead
 * would put a job under "Today" while its own row showed yesterday.
 */
function utcDayKey(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function addressLine(addr: any): string {
  if (!addr) return "";
  return [addr.city, addr.district, addr.street, addr.buildingNo].filter(Boolean).join(" · ");
}

export default function WorkQueue() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const socket = useSocket();

  // Perf fix: GET /appointments is now paginated (default 20/page, max 100).
  // This is the technician's own active work queue -- a job silently missing
  // because it landed on page 2 would be a real operational problem, so this
  // fetches every page explicitly (fetchAllPages) rather than adding
  // paginated browsing UI to what must always be a complete list.
  const { data, isLoading } = useQuery({
    queryKey: ["work-queue"],
    queryFn: () => fetchAllPages(api, "/appointments", { workStatus: "WAITING,IN_PROGRESS" })
  });

  // Read-on-open fix: the sidebar's "queue" badge (badge-queue-tech) increments
  // on every appointment:created socket event but had no corresponding clear
  // site anywhere -- unlike every other local sidebar badge in this app, it
  // never cleared once the Technician actually opened this section. "Opening
  // the section" = this component mounting, i.e. the user navigating here --
  // not app start or sidebar render. (The urgent badge used to follow this
  // same localStorage clear-on-open pattern too, but is now derived directly
  // from unresolved DB state instead -- see components/Sidebar.tsx.)
  useEffect(() => {
    window.dispatchEvent(new Event("clear-badge-queue-tech"));
  }, []);

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

  const active = useMemo(
    () =>
      ((data || []) as any[]).filter((appt: any) =>
        ["WAITING", "IN_PROGRESS"].includes(appt.workStatus) && !appt.isUrgent
      ),
    [data]
  );

  // Presentation-only ordering and grouping of the list already fetched above:
  // work already started comes first, then the earliest scheduled job. The
  // technician brief is "what do I do next", and an unsorted grid answered it
  // only by accident.
  const { nextJob, today, later } = useMemo(() => {
    const sorted = [...active].sort((a, b) => {
      const started = (x: any) => (x.workStatus === "IN_PROGRESS" ? 0 : 1);
      if (started(a) !== started(b)) return started(a) - started(b);
      return new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime();
    });
    const head = sorted[0] ?? null;
    const rest = sorted.slice(1);
    const todayKey = utcDayKey(new Date());
    return {
      nextJob: head,
      today: rest.filter(a => utcDayKey(a.scheduledDate) === todayKey),
      later: rest.filter(a => utcDayKey(a.scheduledDate) !== todayKey),
    };
  }, [active]);

  if (isLoading) return <Loading label={t("common.loading")} />;

  if (active.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="check" className="w-5 h-5" />}
        title={t("tasks.allCompleted")}
        description={isAr ? "لا توجد مهام في قائمة العمل حالياً." : "Nothing is waiting in your queue right now."}
      />
    );
  }

  const typeLabel = (appt: any) =>
    appt.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance");

  return (
    <div className="space-y-5">
      {/* ── Next job ─────────────────────────────────────────────────────────
          The one job the technician acts on now, given the room to be read
          across a van window: name, where, what, and a single primary action. */}
      {nextJob && (
        <section aria-label={isAr ? "المهمة التالية" : "Next job"}>
          <h2 className="text-2xs font-semibold uppercase tracking-wide text-fg-muted mb-2">
            {isAr ? "المهمة التالية" : "Next job"}
          </h2>

          <div key={nextJob.id} className="ph-panel-enter relative overflow-hidden bg-surface border border-line rounded-md">
            <span className="absolute inset-y-0 start-0 w-0.5 bg-accent" aria-hidden="true" />

            <div className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-fg truncate">{nextJob.customer?.name}</p>
                  <p className="text-xs text-fg-muted mt-0.5" dir="ltr">{nextJob.customer?.phone}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <Badge tone={STATUS_TONE[nextJob.workStatus] ?? "neutral"} dot>
                    {statusLabel[nextJob.workStatus] || nextJob.workStatus}
                  </Badge>
                  {!nextJob.technicianId && <Badge tone="neutral">{t("tasks.unassigned")}</Badge>}
                </div>
              </div>

              {/* A flowing row, not a 2-column grid: with only two short facts
                  the grid stranded "type" in the middle of the panel with a
                  wide gap in front of it. */}
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[0.8125rem]">
                {nextJob.customer?.address && (
                  <div className="flex items-start gap-2 min-w-0 basis-full">
                    <Icon name="location" className="w-4 h-4 text-fg-muted flex-shrink-0 mt-0.5" />
                    <dd className="text-fg min-w-0">{addressLine(nextJob.customer.address)}</dd>
                  </div>
                )}
                <div className="flex items-center gap-2 min-w-0">
                  <Icon name="calendar" className="w-4 h-4 text-fg-muted flex-shrink-0" />
                  <dd className="text-fg tabular-nums" dir="ltr">
                    {formatGregorianDate(nextJob.scheduledDate)}
                  </dd>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <Icon name="technicians" className="w-4 h-4 text-fg-muted flex-shrink-0" />
                  <dd className="text-fg truncate">{typeLabel(nextJob)}</dd>
                </div>
              </dl>

              {nextJob.notes && (
                <p className="mt-3 text-xs text-fg-secondary bg-surface-subtle border border-line-subtle rounded px-2.5 py-2">
                  <span className="text-fg-muted">{t("common.notes")}: </span>
                  {nextJob.notes}
                </p>
              )}
            </div>

            <div className="px-4 py-2.5 border-t border-line bg-surface-subtle flex justify-end">
              <Button variant="primary" onClick={() => navigate(`/technician/queue/${nextJob.id}`)}>
                {t("tasks.viewDetails")}
                <Icon name="chevronEnd" className="w-3.5 h-3.5 rtl:rotate-180" />
              </Button>
            </div>
          </div>
        </section>
      )}

      {today.length > 0 && (
        <QueueGroup
          title={isAr ? "بقية اليوم" : "Rest of today"}
          count={today.length}
          items={today}
          statusLabel={statusLabel}
          typeLabel={typeLabel}
          onOpen={id => navigate(`/technician/queue/${id}`)}
          unassignedLabel={t("tasks.unassigned")}
        />
      )}

      {later.length > 0 && (
        <QueueGroup
          title={isAr ? "لاحقاً" : "Later"}
          count={later.length}
          items={later}
          statusLabel={statusLabel}
          typeLabel={typeLabel}
          onOpen={id => navigate(`/technician/queue/${id}`)}
          unassignedLabel={t("tasks.unassigned")}
        />
      )}
    </div>
  );
}

/** Compact one-line-per-job list: scan many, open one. */
function QueueGroup({
  title, count, items, statusLabel, typeLabel, onOpen, unassignedLabel,
}: {
  title: string;
  count: number;
  items: any[];
  statusLabel: Record<string, string>;
  typeLabel: (appt: any) => string;
  onOpen: (id: string) => void;
  unassignedLabel: string;
}) {
  return (
    <section>
      <h2 className="text-2xs font-semibold uppercase tracking-wide text-fg-muted mb-2">
        {title} <span className="text-fg-muted tabular-nums">({count})</span>
      </h2>

      <ul className="bg-surface border border-line rounded-md divide-y divide-line-subtle overflow-hidden">
        {items.map(appt => (
          <li key={appt.id}>
            <button
              type="button"
              onClick={() => onOpen(appt.id)}
              className={cx(
                "w-full text-start px-3 py-2.5 flex items-center gap-3",
                "hover:bg-surface-hover active:bg-surface-active transition-colors"
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[0.8125rem] font-medium text-fg truncate">{appt.customer?.name}</span>
                  {!appt.technicianId && <Badge tone="neutral">{unassignedLabel}</Badge>}
                </div>
                <p className="text-2xs text-fg-muted truncate mt-0.5">
                  {addressLine(appt.customer?.address) || appt.customer?.phone}
                </p>
              </div>

              <span className="text-2xs text-fg-muted whitespace-nowrap hidden md:inline">{typeLabel(appt)}</span>

              <span className="text-2xs text-fg-secondary tabular-nums whitespace-nowrap" dir="ltr">
                {formatGregorianDate(appt.scheduledDate)}
              </span>

              <Badge tone={STATUS_TONE[appt.workStatus] ?? "neutral"} dot>
                {statusLabel[appt.workStatus] || appt.workStatus}
              </Badge>

              <Icon name="chevronEnd" className="w-3.5 h-3.5 text-fg-muted flex-shrink-0 rtl:rotate-180" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
