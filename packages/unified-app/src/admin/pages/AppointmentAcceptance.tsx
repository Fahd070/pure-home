import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";
import { formatGregorianDate } from "../../utils/dateTimeInput";
import { Button } from "../../ui/Button";
import { PageHeader } from "../../ui/Surface";
import { EmptyState, Loading, Callout } from "../../ui/Feedback";
import { TableShell, Table, THead, TH, TBody, TR, TD } from "../../ui/Table";
import { ConfirmDialog } from "../../ui/Modal";
import { Icon } from "../../ui/icons";

// Modification #10: dedicated Admin-only page for appointments Scheduling/
// Maintenance has exported (Modification #5) and that are still awaiting
// Admin approval. Reuses Modification #5's existing backend entirely -- the
// new GET /appointments/pending-export-approval query and the PATCH
// /appointments/:id/approve-export action are unchanged from Modification #5;
// this page is only a dedicated UI surface for them (previously, approval was
// only reachable from inside the general Admin Appointments table).
export default function AppointmentAcceptance() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const socket = useSocket();
  // Replaces window.confirm: the native dialog cannot be themed, ignores the
  // app language and looks like an OS error next to the redesigned UI.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["pending-export-approval"],
    queryFn: () => api.get("/appointments/pending-export-approval").then(r => r.data.data),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/appointments/${id}/approve-export`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-export-approval"] });
      toast.success(t("appointments.approveExportSuccess"));
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || t("appointments.approveExportError")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/appointments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-export-approval"] });
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast.success(t("dashboard.deleted"));
      setPendingDelete(null);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || t("common.error")),
  });

  // appointment:status: Modification #5's export-to-technicians/approve-export
  // actions on an existing appointment (still relevant for any legacy
  // appointment created before the approval-flow fix below). appointment:created:
  // a Scheduling-created normal appointment now starts directly in this pending
  // state at creation time (the approval-flow fix), so this list must also pick
  // up a brand-new appointment live, not just a status change on an existing one.
  useEffect(() => {
    if (!socket) return;
    const refresh = () => qc.invalidateQueries({ queryKey: ["pending-export-approval"] });
    socket.on("appointment:status", refresh);
    socket.on("appointment:created", refresh);
    socket.on("appointment:deleted", refresh);
    return () => { socket.off("appointment:status", refresh); socket.off("appointment:created", refresh); socket.off("appointment:deleted", refresh); };
  }, [socket, qc]);

  const appointments: any[] = data || [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("nav.appointmentAcceptance")}
        subtitle={
          appointments.length > 0
            ? <span className="tabular-nums">{appointments.length}</span>
            : undefined
        }
      />

      {isLoading ? (
        <Loading label={t("common.loading")} />
      ) : isError ? (
        <Callout tone="danger">{t("common.error")}</Callout>
      ) : appointments.length === 0 ? (
        <div className="bg-surface border border-line rounded-md">
          <EmptyState
            icon={<Icon name="acceptance" className="w-5 h-5" />}
            title={t("appointments.noAppointmentsAwaitingApproval")}
          />
        </div>
      ) : (
        <TableShell>
          <Table className="min-w-[900px]">
            <THead>
              <tr>
                <TH>{t("appointments.customer")}</TH>
                <TH width="7rem">{t("appointments.type")}</TH>
                <TH width="7rem">{t("common.date")}</TH>
                <TH width="10rem">{isAr ? "الموقع" : "Location"}</TH>
                <TH width="9rem">{t("appointments.technician")}</TH>
                <TH>{t("common.notes")}</TH>
                <TH width="10rem">{t("appointments.approveExport")}</TH>
                <TH width="4rem">{t("common.actions")}</TH>
              </tr>
            </THead>
            <TBody>
              {appointments.map((a: any) => {
                const addr = a.customer?.address;
                const approving = approveMutation.isPending && approveMutation.variables === a.id;
                const deleting = deleteMutation.isPending && deleteMutation.variables === a.id;
                return (
                  <TR key={a.id}>
                    <TD>
                      <p className="font-medium text-fg truncate">{a.customer?.name || "—"}</p>
                      <p className="text-2xs text-fg-muted" dir="ltr">{a.customer?.phone}</p>
                    </TD>
                    <TD className="text-fg-secondary text-2xs">
                      {a.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}
                    </TD>
                    <TD className="tabular-nums whitespace-nowrap"><span dir="ltr">{formatGregorianDate(a.scheduledDate)}</span></TD>
                    <TD className="text-fg-secondary text-2xs">
                      {addr ? [addr.city, addr.district].filter(Boolean).join("، ") : "—"}
                    </TD>
                    <TD className="text-fg-secondary text-2xs">{a.technician?.name || "—"}</TD>
                    <TD className="text-fg-secondary text-2xs max-w-[220px] truncate" title={a.notes || undefined}>
                      {a.notes || "—"}
                    </TD>
                    <TD>
                      <Button size="sm" variant="primary" loading={approving} onClick={() => approveMutation.mutate(a.id)}>
                        <Icon name="check" className="w-3.5 h-3.5" />
                        {t("appointments.approveExport")}
                      </Button>
                    </TD>
                    <TD>
                      <Button
                        size="sm" variant="ghost" iconOnly
                        loading={deleting}
                        onClick={() => setPendingDelete(a.id)}
                        title={t("dashboard.deleteRecord")}
                        aria-label={t("dashboard.deleteRecord")}
                        className="hover:text-danger-fg hover:bg-danger-bg"
                      >
                        <Icon name="trash" className="w-4 h-4" />
                      </Button>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableShell>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete)}
        title={t("dashboard.deleteConfirm")}
        confirmLabel={t("dashboard.deleteRecord")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
