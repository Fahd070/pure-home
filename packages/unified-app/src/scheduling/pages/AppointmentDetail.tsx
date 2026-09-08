import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import toast from "react-hot-toast";
import { formatGregorianDate } from "../../utils/dateTimeInput";
import { Button } from "../../ui/Button";
import { Badge } from "../../ui/Badge";
import { Callout, Loading } from "../../ui/Feedback";
import { Segmented } from "../../ui/Segmented";
import { Icon } from "../../ui/icons";

/** One label/value pair in the appointment summary grid. */
function Detail({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs uppercase tracking-wide text-fg-muted">{label}</dt>
      <dd className="text-[0.8125rem] text-fg mt-0.5 truncate">{children}</dd>
    </div>
  );
}

export default function AppointmentDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["appointment", id], queryFn: () => api.get(`/appointments/${id}`).then(r => r.data.data) });

  const changeStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/appointments/${id}/status`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["appointment", id] }); qc.invalidateQueries({ queryKey: ["appointments"] }); toast.success(t("common.success")); }
  });

  // Modification #8: Scheduling reviews and explicitly confirms a Technician's
  // completion report. Never auto-approved by viewing this page.
  const confirmOperation = useMutation({
    mutationFn: () => api.patch(`/appointments/${id}/confirm-operation`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointment", id] });
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast.success(t("appointments.confirmOperationSuccess"));
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || t("appointments.confirmOperationError")),
  });

  if (isLoading) return <Loading label={t("common.loading")} />;
  if (!data) return <Callout tone="danger">{t("common.error")}</Callout>;

  const a = data;
  const STATUSES = ["SCHEDULED", "RESCHEDULED", "CANCELLED", "PENDING"];

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="text-fg-muted hover:text-fg text-2xs inline-flex items-center gap-1.5 transition-colors"
      >
        <Icon name="chevronStart" className="w-3.5 h-3.5 rtl:rotate-180" />
        {t("common.back")}
      </button>

      <div className="bg-surface border border-line rounded-md">
        <div className="p-4 border-b border-line">
          <h2 className="text-base font-semibold text-fg">{a.customer?.name}</h2>
          <p className="text-xs text-fg-secondary mt-1">
            {a.customer?.secondaryPhone ? `${t("customers.primaryPhone")}: ${a.customer.phone}` : a.customer?.phone}
          </p>
          {a.customer?.secondaryPhone && (
            <p className="text-xs text-fg-secondary">{t("customers.secondaryPhone")}: {a.customer.secondaryPhone}</p>
          )}
        </div>

        <div className="p-4 space-y-4">
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Detail label={t("common.date")}>
              <span dir="ltr" className="tabular-nums">{formatGregorianDate(a.scheduledDate)}</span>
            </Detail>
            <Detail label={t("appointments.type")}>{a.type}</Detail>
            <Detail label={t("common.status")}>{a.status}</Detail>
            <Detail label={t("appointments.technician")}>{a.task?.technician?.name || "—"}</Detail>
          </dl>

          {a.notes && (
            <div className="bg-surface-subtle border border-line-subtle rounded-md p-3">
              <p className="text-2xs uppercase tracking-wide text-fg-muted mb-1.5">{t("common.notes")}</p>
              <p className="text-[0.8125rem] text-fg whitespace-pre-wrap">{a.notes}</p>
            </div>
          )}

          {a.nextMaintenanceNote && (
            <Callout tone="info" title={t("tasks.nextMaintenanceNote")}>
              <p className="whitespace-pre-wrap">{a.nextMaintenanceNote}</p>
            </Callout>
          )}

          {a.workStatus === "COMPLETED" && (
            <section className="border border-line rounded-md overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-line bg-surface-subtle">
                <p className="text-[0.8125rem] font-semibold text-fg">{t("appointments.completionReport")}</p>
                <Badge tone={a.maintenanceConfirmed ? "success" : "pending"} dot>
                  {a.maintenanceConfirmed ? t("appointments.operationConfirmed") : t("appointments.awaitingMaintenanceConfirmation")}
                </Badge>
              </div>

              <dl className="p-3 space-y-2.5">
                {a.actualCompletionDate && (
                  <Detail label={t("tasks.completionDate")}>
                    <span dir="ltr" className="tabular-nums">{formatGregorianDate(a.actualCompletionDate)}</span>
                  </Detail>
                )}
                {a.serviceDetails && (
                  <div className="min-w-0">
                    <dt className="text-2xs uppercase tracking-wide text-fg-muted">{t("tasks.serviceDetails")}</dt>
                    <dd className="text-[0.8125rem] text-fg mt-0.5 whitespace-pre-wrap">{a.serviceDetails}</dd>
                  </div>
                )}
                {a.completionImage && (
                  <div>
                    <dt className="text-2xs uppercase tracking-wide text-fg-muted mb-1.5">{t("tasks.completionPhoto")}</dt>
                    <dd>
                      <img src={a.completionImage} alt="" className="w-24 h-24 object-cover rounded-md border border-line" />
                    </dd>
                  </div>
                )}
              </dl>

              {!a.maintenanceConfirmed && (
                <div className="px-3 py-2.5 border-t border-line bg-surface-subtle flex justify-end">
                  <Button variant="primary" loading={confirmOperation.isPending} onClick={() => confirmOperation.mutate()}>
                    <Icon name="check" className="w-3.5 h-3.5" />
                    {t("appointments.confirmOperation")}
                  </Button>
                </div>
              )}
            </section>
          )}

          <div className="border-t border-line-subtle pt-4">
            <p className="text-2xs uppercase tracking-wide text-fg-muted mb-2">{t("common.status")}</p>
            <Segmented
              value={a.status}
              options={STATUSES}
              labels={Object.fromEntries(STATUSES.map(s => [s, s]))}
              // Re-selecting the current status used to be impossible (that
              // button was disabled); keep it a no-op rather than a redundant PATCH.
              onChange={(s) => { if (s !== a.status) changeStatus.mutate(s); }}
              disabled={changeStatus.isPending}
              ariaLabel={t("common.status")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
