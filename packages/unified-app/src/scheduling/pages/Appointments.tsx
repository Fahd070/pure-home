import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";
import { formatGregorianDate } from "../../utils/dateTimeInput";
import { Button } from "../../ui/Button";
import { Badge, Tone } from "../../ui/Badge";
import { PageHeader } from "../../ui/Surface";
import { Loading } from "../../ui/Feedback";
import { TableShell, Table, THead, TH, TBody, TD } from "../../ui/Table";
import { Pagination } from "../../ui/Pagination";
import { Icon } from "../../ui/icons";

const STATUS_TONES: Record<string, Tone> = {
  SCHEDULED: "info",
  RESCHEDULED: "warning",
  CANCELLED: "danger",
  PENDING: "neutral",
};

export default function Appointments() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const socket = useSocket();
  const [page, setPage] = useState(1);
  // Perf fix: GET /appointments is now paginated (default 20/page, max 100)
  // instead of returning every matching row. This is a plain browsable list
  // (no filters here), so it uses the endpoint's own page/limit + meta
  // directly, matching the existing GET /customers pagination convention
  // used elsewhere in this app (see admin/pages/Customers.tsx).
  const { data, isLoading } = useQuery({
    queryKey: ["appointments", page],
    queryFn: () => api.get("/appointments", { params: { page, limit: 20 } }).then(r => r.data),
  });
  const appointments: any[] = data?.data || [];
  const meta = data?.meta;

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
      <PageHeader
        title={t("appointments.title")}
        actions={
          <Button variant="primary" onClick={() => navigate("/scheduling/appointments/new")}>
            <Icon name="add" className="w-3.5 h-3.5" />
            {t("appointments.new")}
          </Button>
        }
      />

      {isLoading ? (
        <Loading label={t("common.loading")} />
      ) : (
        <TableShell>
          <Table className="min-w-[720px]">
            <THead>
              <tr>
                <TH>{t("appointments.customer")}</TH>
                <TH width="7rem">{t("common.date")}</TH>
                <TH width="8rem">{t("appointments.type")}</TH>
                <TH width="8rem">{t("common.status")}</TH>
                <TH width="11rem">{t("appointments.export")}</TH>
                <TH width="12rem">{t("appointments.confirmOperation")}</TH>
              </tr>
            </THead>
            <TBody>
              {appointments.map((a: any) => {
                // State machine (visibleToTechnician, adminApproved): (true,false) =
                // never exported -- eligible to export. (false,false) = pending Admin
                // approval. (true,true) = exported and approved. Urgent appointments
                // never appear in this list (server already excludes them for
                // Scheduling), so the export action is always relevant here.
                const isPending = !a.visibleToTechnician && !a.adminApproved;
                const isApproved = a.visibleToTechnician && a.adminApproved;
                return (
                  <tr
                    key={a.id}
                    className="border-b border-line-subtle last:border-b-0 hover:bg-surface-hover transition-colors cursor-pointer"
                    onClick={() => navigate(`/scheduling/appointments/${a.id}`)}
                  >
                    <TD className="font-medium">{a.customer?.name}</TD>
                    <TD className="tabular-nums whitespace-nowrap"><span dir="ltr">{formatGregorianDate(a.scheduledDate)}</span></TD>
                    <TD>{a.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}</TD>
                    <TD><Badge tone={STATUS_TONES[a.status] ?? "neutral"} dot>{a.status}</Badge></TD>
                    <TD>
                      {isPending ? (
                        <Badge tone="pending" dot>{t("appointments.exportPending")}</Badge>
                      ) : isApproved ? (
                        <Badge tone="success" dot>{t("appointments.exportApproved")}</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={e => { e.stopPropagation(); exportMutation.mutate(a.id); }}
                          loading={exportMutation.isPending}
                        >
                          {t("appointments.export")}
                        </Button>
                      )}
                    </TD>
                    <TD>
                      {a.workStatus !== "COMPLETED" ? (
                        <span className="text-fg-muted text-2xs">—</span>
                      ) : a.maintenanceConfirmed ? (
                        <Badge tone="success" dot>{t("appointments.operationConfirmed")}</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={e => { e.stopPropagation(); confirmOperationMutation.mutate(a.id); }}
                          loading={confirmOperationMutation.isPending}
                        >
                          {t("appointments.confirmOperation")}
                        </Button>
                      )}
                    </TD>
                  </tr>
                );
              })}
            </TBody>
          </Table>
        </TableShell>
      )}

      {meta && (
        <Pagination
          page={meta.page}
          totalPages={meta.totalPages}
          total={meta.total}
          onPage={setPage}
        />
      )}
    </div>
  );
}
