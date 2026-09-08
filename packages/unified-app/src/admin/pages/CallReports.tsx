import React, { useState, useMemo, useEffect } from "react";
import type { AxiosResponse } from "axios";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";
import CallReportForm from "../components/CallReportForm";
import { formatGregorianDate } from "../../utils/dateTimeInput";
import { Button } from "../../ui/Button";
import { Input, Checkbox } from "../../ui/Field";
import { Badge } from "../../ui/Badge";
import { PageHeader, Toolbar } from "../../ui/Surface";
import { EmptyState, Loading } from "../../ui/Feedback";
import { TableShell, Table, THead, TH, TBody, TR, TD } from "../../ui/Table";
import { ConfirmDialog } from "../../ui/Modal";
import { Icon } from "../../ui/icons";

type ConfirmType = "single" | "selected" | "all";

export default function AdminCallReports() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const socket = useSocket();
  const [showForm, setShowForm] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ type: ConfirmType; ids?: string[] } | null>(null);

  useEffect(() => {
    window.dispatchEvent(new Event("clear-badge-callreports-admin"));
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onNew = () => qc.invalidateQueries({ queryKey: ["call-reports"] });
    const onDeleted = () => { qc.invalidateQueries({ queryKey: ["call-reports"] }); setSelected(new Set()); };
    socket.on("call_report:new", onNew);
    socket.on("call_report:deleted", onDeleted);
    return () => {
      socket.off("call_report:new", onNew);
      socket.off("call_report:deleted", onDeleted);
    };
  }, [socket, qc]);

  const { data: reportsResp, isLoading } = useQuery({
    queryKey: ["call-reports"],
    queryFn: () => api.get("/call-reports", { params: { limit: 200 } }).then(r => r.data),
  });
  const data: any[] = reportsResp?.data || [];
  const reportsTotal: number = reportsResp?.meta?.total ?? data.length;

  const deleteMutation = useMutation({
    mutationFn: ({ type, ids }: { type: ConfirmType; ids?: string[] }): Promise<AxiosResponse> => {
      if (type === "single" || type === "selected") {
        const uniqueIds = Array.from(new Set(ids || []));
        return api.delete("/call-reports/bulk", { data: { confirm: true, ids: uniqueIds, expectedCount: uniqueIds.length } });
      }
      return api.delete("/call-reports/all", { data: { confirm: true, expectedCount: reportsTotal } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["call-reports"] });
      setSelected(new Set());
      setConfirm(null);
      toast.success(t("callReports.deleted"));
    },
    onError: (err: any) => {
      if (err?.response?.status === 409) {
        qc.invalidateQueries({ queryKey: ["call-reports"] });
        setConfirm(null);
        toast.error(t("callReports.countChanged"));
      } else {
        toast.error(t("common.error"));
      }
    },
  });

  const reports: any[] = useMemo(() => {
    const all: any[] = data || [];
    if (!filterSearch.trim()) return all;
    const q = filterSearch.toLowerCase();
    return all.filter((r: any) =>
      r.customer?.name?.toLowerCase().includes(q) || r.customer?.phone?.includes(q) ||
      r.unregisteredName?.toLowerCase().includes(q) || r.unregisteredPhone?.includes(q)
    );
  }, [data, filterSearch]);

  const allIds = reports.map((r: any) => r.id);
  const allSelected = allIds.length > 0 && allIds.every((id: string) => selected.has(id));
  const someSelected = allIds.some((id: string) => selected.has(id));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function openConfirm(type: ConfirmType, ids?: string[]) {
    setConfirm({ type, ids });
  }

  function doDelete() {
    if (!confirm) return;
    const ids = confirm.type === "selected"
      ? Array.from(selected)
      : confirm.ids;
    deleteMutation.mutate({ type: confirm.type, ids });
  }

  const selectedCount = selected.size;

  const confirmMsg = confirm?.type === "all"
    ? t("callReports.confirmDeleteAllCount", { count: reportsTotal })
    : confirm?.type === "selected"
      ? t("callReports.confirmDeleteSelectedCount", { count: selectedCount })
      : t("callReports.deleteConfirm");

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("callReports.title")}
        subtitle={<span className="tabular-nums">{reports.length} / {reportsTotal}</span>}
        actions={
          <>
            {someSelected && (
              <Button variant="danger" size="sm" onClick={() => openConfirm("selected")}>
                <Icon name="trash" className="w-3.5 h-3.5" />
                {t("callReports.deleteSelected")} ({selectedCount})
              </Button>
            )}
            {reports.length > 0 && (
              <Button variant="secondary" size="sm" onClick={() => openConfirm("all")} className="text-danger-fg">
                {t("callReports.deleteAll")}
              </Button>
            )}
            <Button variant={showForm ? "secondary" : "primary"} onClick={() => setShowForm(v => !v)}>
              <Icon name={showForm ? "close" : "add"} className="w-3.5 h-3.5" />
              {showForm ? t("common.cancel") : t("callReports.newReport")}
            </Button>
          </>
        }
      />

      {showForm && (
        <div className="bg-surface border border-line rounded-md">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
            <h2 className="text-sm font-semibold text-fg">{t("callReports.newReport")}</h2>
            <HelpButton titleAr={HELP["form.callReport"].titleAr} contentAr={HELP["form.callReport"].contentAr} />
          </div>
          <div className="p-4">
            <CallReportForm onSaved={() => setShowForm(false)} onCancel={() => setShowForm(false)} />
          </div>
        </div>
      )}

      <Toolbar>
        <div className="relative w-72 max-w-full">
          <Icon name="search" className="w-3.5 h-3.5 text-fg-muted absolute top-1/2 -translate-y-1/2 start-2.5 pointer-events-none" />
          <Input
            value={filterSearch}
            onChange={e => setFilterSearch(e.target.value)}
            placeholder={isAr ? "ابحث عن عميل (اسم أو جوال)" : "Search customer (name or phone)"}
            aria-label={isAr ? "بحث عن عميل" : "Search customer"}
            className="ps-8"
          />
        </div>
      </Toolbar>

      {isLoading ? (
        <Loading label={t("common.loading")} />
      ) : !reports.length ? (
        <div className="bg-surface border border-line rounded-md">
          <EmptyState
            icon={<Icon name="callReports" className="w-5 h-5" />}
            title={t("callReports.noReports")}
          />
        </div>
      ) : (
        <TableShell>
          <Table className="min-w-[820px]">
            <THead>
              <tr>
                <TH width="2.5rem">
                  <Checkbox
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label={t("common.all")}
                  />
                </TH>
                <TH>{t("callReports.customer")}</TH>
                <TH width="9rem">{t("common.phone")}</TH>
                <TH width="10rem">{t("callReports.employeeName")}</TH>
                <TH width="7rem">{t("callReports.callDate")}</TH>
                <TH>{t("callReports.notes")}</TH>
                <TH width="4rem" />
              </tr>
            </THead>
            <TBody>
              {reports.map((r: any) => (
                <TR key={r.id} selected={selected.has(r.id)}>
                  <TD>
                    <Checkbox
                      checked={selected.has(r.id)}
                      onChange={() => toggleOne(r.id)}
                      aria-label={r.customer?.name || r.unregisteredName || ""}
                    />
                  </TD>
                  <TD className="font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {r.customer?.name || r.unregisteredName || "—"}
                      {!r.customerId && r.unregisteredName && <Badge tone="warning">{isAr ? "غير مسجل" : "Unregistered"}</Badge>}
                    </span>
                  </TD>
                  <TD className="text-fg-secondary"><span dir="ltr">{r.customer?.phone || r.unregisteredPhone || "—"}</span></TD>
                  <TD className="text-fg-secondary">{r.employeeName}</TD>
                  <TD className="text-fg-secondary tabular-nums whitespace-nowrap">
                    <span dir="ltr">{formatGregorianDate(r.callDate)}</span>
                  </TD>
                  <TD className="text-fg-secondary max-w-[320px] truncate" title={r.notes || undefined}>
                    {r.notes || "—"}
                  </TD>
                  <TD>
                    <Button
                      size="sm" variant="ghost" iconOnly
                      onClick={() => openConfirm("single", [r.id])}
                      title={t("common.delete")}
                      aria-label={t("common.delete")}
                      className="hover:text-danger-fg hover:bg-danger-bg"
                    >
                      <Icon name="trash" className="w-4 h-4" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableShell>
      )}

      <ConfirmDialog
        open={!!confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={doDelete}
        title={confirmMsg}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
