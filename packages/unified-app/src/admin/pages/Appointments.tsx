import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";
import PreviousMaintenanceNoteBox from "../../components/PreviousMaintenanceNoteBox";
import { toDateInputValue, dateOnlyToApiDate, formatGregorianDate } from "../../utils/dateTimeInput";
import { Button } from "../../ui/Button";
import { Input, Select, Textarea, Field } from "../../ui/Field";
import { Badge, Tone } from "../../ui/Badge";
import { PageHeader, Toolbar } from "../../ui/Surface";
import { EmptyState, Loading, Callout } from "../../ui/Feedback";
import { TableShell, Table, THead, TH, TBody, TD } from "../../ui/Table";
import { Pagination } from "../../ui/Pagination";
import { ConfirmDialog } from "../../ui/Modal";
import { Segmented } from "../../ui/Segmented";
import { Icon } from "../../ui/icons";

const STATUS_TONES: Record<string, Tone> = {
  SCHEDULED:   "info",
  RESCHEDULED: "warning",
  CANCELLED:   "danger",
  PENDING:     "neutral",
};

const EMPTY_FORM = { customerId: "", customerSearch: "", date: "", type: "MAINTENANCE", notes: "" };

export default function Appointments() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const socket = useSocket();
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editAppt, setEditAppt] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  // Replaces confirm(): the native dialog cannot be themed or translated.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // Perf fix: GET /appointments is now paginated (default 20/page, max 100)
  // instead of returning every matching row. Uses the endpoint's own
  // page/limit + meta directly (matching admin/pages/Customers.tsx's existing
  // pagination convention). `page` resets to 1 whenever the status filter
  // changes (see the filter buttons below).
  const { data, isLoading } = useQuery({
    queryKey: ["appointments", filter, page],
    queryFn: () => api.get("/appointments", { params: { ...(filter ? { status: filter } : {}), page, limit: 20 } }).then(r => r.data),
  });
  const appointments: any[] = data?.data || [];
  const meta = data?.meta;

  // Perf fix: these banners must reflect the TRUE total across every matching
  // appointment, not just whatever happens to be on the currently-loaded page
  // -- computing them from `appointments` (now paginated) would silently miss
  // items awaiting approval that aren't on page 1. `pendingExportAppts` reuses
  // the existing dedicated (and already unbounded-by-design) endpoint
  // AppointmentAcceptance.tsx already relies on; `pendingSchedulingApproval`
  // is a small additive filter on the same GET /appointments route, read via
  // its `meta.total` (limit:1 -- only the count is needed here).
  const { data: pendingSchedTotal } = useQuery({
    queryKey: ["appointments-pending-scheduling-approval"],
    queryFn: () => api.get("/appointments", { params: { pendingSchedulingApproval: "true", limit: 1 } }).then(r => r.data.meta?.total ?? 0),
  });
  const { data: pendingExportTotal } = useQuery({
    queryKey: ["appointments-pending-export-approval"],
    queryFn: () => api.get("/appointments/pending-export-approval").then(r => (r.data.data || []).length),
  });

  const { data: customersData } = useQuery({
    queryKey: ["customers-select"],
    queryFn: () => api.get("/customers", { params: { limit: 500 } }).then(r => r.data.data || []),
  });

  // Modification #7: keyed on the selected customer, so react-query's own cache
  // identity (not a manual AbortController) guarantees a stale response for a
  // previously-selected customer can never render under a newly-selected one.
  const { data: prevNote } = useQuery({
    queryKey: ["latest-maintenance-note", form.customerId],
    queryFn: () => api.get(`/customers/${form.customerId}/latest-maintenance-note`).then(r => r.data.data.nextMaintenanceNote),
    enabled: !!form.customerId,
  });

  // The two banner query keys are invalidated alongside ["appointments"]
  // everywhere below -- any create/edit/status/approval/delete action can
  // change which appointments are pending Scheduling/export approval.
  function invalidateAppointmentQueries() {
    qc.invalidateQueries({ queryKey: ["appointments"] });
    qc.invalidateQueries({ queryKey: ["appointments-pending-scheduling-approval"] });
    qc.invalidateQueries({ queryKey: ["appointments-pending-export-approval"] });
  }

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post("/appointments", body),
    onSuccess: () => {
      invalidateAppointmentQueries();
      toast.success(t("common.success"));
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
    },
    onError: () => toast.error(t("common.error")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.put(`/appointments/${id}`, body),
    onSuccess: () => {
      invalidateAppointmentQueries();
      toast.success(t("common.success"));
      setEditAppt(null);
    },
    onError: () => toast.error(t("common.error")),
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status, notes }: { id: string; status: string; notes?: string }) =>
      api.patch(`/appointments/${id}/status`, { status, notes }),
    onSuccess: () => { invalidateAppointmentQueries(); toast.success(t("common.success")); },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/appointments/${id}/approve-visibility`),
    onSuccess: () => {
      invalidateAppointmentQueries();
      toast.success(isAr ? "تم إظهار الموعد للجدولة" : "Appointment visible to Scheduling");
    },
    onError: () => toast.error(t("common.error")),
  });

  const approveExportMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/appointments/${id}/approve-export`),
    onSuccess: () => {
      invalidateAppointmentQueries();
      toast.success(t("appointments.approveExportSuccess"));
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || t("appointments.approveExportError")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/appointments/${id}`),
    onSuccess: () => {
      invalidateAppointmentQueries();
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success(isAr ? "تم حذف الموعد" : "Appointment deleted");
    },
    onError: () => toast.error(t("common.error")),
  });

  useEffect(() => {
    if (!socket) return;
    const refresh = () => {
      invalidateAppointmentQueries();
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    };
    socket.on("appointment:deleted", refresh);
    socket.on("customer:deleted", refresh);
    socket.on("customers:bulk-deleted", refresh);
    return () => {
      socket.off("appointment:deleted", refresh);
      socket.off("customer:deleted", refresh);
      socket.off("customers:bulk-deleted", refresh);
    };
  }, [socket, qc]);

  const statusKey: Record<string, string> = {
    SCHEDULED:   t("appointments.scheduled"),
    RESCHEDULED: t("appointments.rescheduled"),
    CANCELLED:   t("appointments.cancelled"),
    PENDING:     t("appointments.pending"),
  };

  const allCustomers: any[] = customersData || [];
  const filteredCustomers = useMemo(() => {
    if (!form.customerSearch.trim()) return allCustomers;
    const q = form.customerSearch.toLowerCase();
    return allCustomers.filter((c: any) => c.name?.toLowerCase().includes(q) || c.phone?.includes(q) || c.secondaryPhone?.includes(q));
  }, [allCustomers, form.customerSearch]);

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setEditAppt(null);
    setShowForm(true);
  }

  function openEdit(a: any) {
    const cust = allCustomers.find((c: any) => c.id === (a.customerId || a.customer?.id));
    setForm({
      customerId: a.customerId || a.customer?.id || "",
      customerSearch: cust ? `${cust.name} — ${cust.phone}` : "",
      date: toDateInputValue(a.scheduledDate),
      type: a.type || "MAINTENANCE",
      notes: a.notes || "",
    });
    setEditAppt(a);
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const scheduledDate = dateOnlyToApiDate(form.date);
    if (!form.customerId || !scheduledDate) return;
    const body = {
      customerId: form.customerId,
      scheduledDate,
      type: form.type,
      notes: form.notes || undefined,
      visibleToScheduling: true,
      createdByRole: "ADMIN",
    };
    if (editAppt) {
      updateMutation.mutate({ id: editAppt.id, body });
    } else {
      createMutation.mutate(body);
    }
  }

  const STATUS_FILTERS = ["", "SCHEDULED", "RESCHEDULED", "CANCELLED", "PENDING"];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("appointments.title")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Icon name="add" className="w-3.5 h-3.5" />
            {t("appointments.new")}
          </Button>
        }
      />

      {!!pendingSchedTotal && pendingSchedTotal > 0 && (
        <Callout tone="pending">
          {isAr
            ? `${pendingSchedTotal} موعد من الجدولة بانتظار الإظهار — استخدم "إظهار للجدولة"`
            : `${pendingSchedTotal} scheduling appointment(s) pending — use "Show to Scheduling" to approve`}
        </Callout>
      )}

      {!!pendingExportTotal && pendingExportTotal > 0 && (
        <Callout tone="pending">
          {isAr
            ? `${pendingExportTotal} موعد مصدّر من الجدولة بانتظار اعتماد الإدارة — استخدم "اعتماد الموعد"`
            : `${pendingExportTotal} exported appointment(s) pending Admin approval — use "Approve Appointment"`}
        </Callout>
      )}

      <Toolbar>
        <Segmented
          fullWidth={false}
          value={filter}
          options={STATUS_FILTERS}
          labels={Object.fromEntries(STATUS_FILTERS.map(sv => [sv, sv ? (statusKey[sv] || sv) : t("common.all")]))}
          onChange={sv => { setFilter(sv); setPage(1); }}
          ariaLabel={t("common.status")}
        />
      </Toolbar>

      {showForm && (
        <div className="bg-surface border border-line rounded-md">
          <h2 className="text-sm font-semibold text-fg px-4 py-2.5 border-b border-line">
            {editAppt ? t("common.edit") : t("appointments.new")}
          </h2>

          <form onSubmit={handleSubmit}>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <span className="block text-xs font-medium text-fg-secondary mb-1.5">{t("appointments.customer")}</span>
                <div className="relative">
                  <Icon name="search" className="w-3.5 h-3.5 text-fg-muted absolute top-1/2 -translate-y-1/2 start-2.5 pointer-events-none" />
                  <Input
                    value={form.customerSearch}
                    onChange={e => setForm(f => ({ ...f, customerSearch: e.target.value, customerId: "" }))}
                    placeholder={isAr ? "ابحث بالاسم أو الجوال..." : "Search by name or phone..."}
                    aria-label={t("appointments.customer")}
                    className="ps-8"
                  />
                </div>

                {form.customerSearch && !form.customerId && (
                  <div className="mt-1 border border-line rounded max-h-44 overflow-y-auto bg-surface shadow-md">
                    {filteredCustomers.length === 0 ? (
                      <p className="text-2xs text-fg-muted px-2.5 py-2">{t("common.noRecords")}</p>
                    ) : filteredCustomers.slice(0, 8).map((c: any) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, customerId: c.id, customerSearch: `${c.name} — ${c.phone}` }))}
                        className="w-full text-start px-2.5 py-2 text-[0.8125rem] hover:bg-surface-hover border-b border-line-subtle last:border-b-0 flex items-center gap-2"
                      >
                        <span className="font-medium text-fg truncate">{c.name}</span>
                        <span className="text-fg-muted text-2xs" dir="ltr">{c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}

                {form.customerId && (
                  <p className="text-2xs text-success-fg mt-1 flex items-center gap-1">
                    <Icon name="check" className="w-3 h-3" />
                    {isAr ? "تم اختيار العميل" : "Customer selected"}
                  </p>
                )}
              </div>

              {form.customerId && (
                <div className="sm:col-span-2">
                  <PreviousMaintenanceNoteBox note={prevNote} />
                </div>
              )}

              <Field label={t("common.date")} htmlFor="appt-date">
                <Input
                  id="appt-date" type="date" lang="en-GB" dir="ltr" required
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                />
              </Field>

              <Field label={t("appointments.type")} htmlFor="appt-type">
                <Select id="appt-type" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  <option value="MAINTENANCE">{t("appointments.maintenance")}</option>
                  <option value="INSTALLATION">{t("appointments.installation")}</option>
                </Select>
              </Field>

              <Field className="sm:col-span-2" label={t("common.notes")} htmlFor="appt-notes">
                <Textarea
                  id="appt-notes" rows={3}
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                />
              </Field>
            </div>

            <div className="px-4 py-2.5 border-t border-line bg-surface-subtle flex gap-2 justify-end">
              <Button type="button" variant="secondary" onClick={() => { setShowForm(false); setEditAppt(null); }}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!form.customerId}
                loading={createMutation.isPending || updateMutation.isPending}
              >
                {t("common.save")}
              </Button>
            </div>
          </form>
        </div>
      )}

      {isLoading ? (
        <Loading label={t("common.loading")} />
      ) : !appointments.length ? (
        <div className="bg-surface border border-line rounded-md">
          <EmptyState icon={<Icon name="appointments" className="w-5 h-5" />} title={t("common.noRecords")} />
        </div>
      ) : (
        <TableShell>
          <Table className="min-w-[1120px]">
            <THead>
              <tr>
                <TH>{t("appointments.customer")}</TH>
                <TH width="7rem">{t("common.date")}</TH>
                <TH width="9rem">{t("appointments.type")}</TH>
                <TH width="8rem">{t("common.status")}</TH>
                <TH width="7rem">{isAr ? "المصدر" : "Source"}</TH>
                <TH width="26rem">{t("common.actions")}</TH>
              </tr>
            </THead>
            <TBody>
              {appointments.map((a: any) => (
                <tr key={a.id} className="border-b border-line-subtle last:border-b-0 hover:bg-surface-hover transition-colors">
                  <TD className="font-medium">
                    {a.customer?.name || (a.isUrgent
                      ? <span className="text-urgent-fg">{isAr ? "زيارة عاجلة" : "Urgent Visit"}</span>
                      : "—")}
                  </TD>
                  <TD className="tabular-nums whitespace-nowrap"><span dir="ltr">{formatGregorianDate(a.scheduledDate)}</span></TD>
                  <TD className="text-fg-secondary text-2xs">
                    <span className="inline-flex items-center gap-1.5">
                      {a.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}
                      {a.isUrgent && <Badge tone="urgent">{isAr ? "عاجل" : "Urgent"}</Badge>}
                    </span>
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONES[a.status] ?? "neutral"} dot>
                      {statusKey[a.status] || a.status}
                    </Badge>
                  </TD>
                  <TD className="text-fg-secondary text-2xs">
                    {a.createdByRole === 'ADMIN'
                      ? (isAr ? "الإدارة" : "Admin")
                      : a.createdByRole === 'SCHEDULING'
                        ? (isAr ? "الجدولة" : "Scheduling")
                        : "—"}
                  </TD>
                  <TD>
                    {/* One non-wrapping row: four controls stacked onto three
                        lines made every row ~100px tall and impossible to scan.
                        Edit and delete are icons (their labels are in title/
                        aria-label); the two approval actions keep their text,
                        because those are the decisions this page exists for. */}
                    <div className="flex gap-1 items-center flex-nowrap">
                      <Button
                        size="sm" variant="ghost" iconOnly
                        onClick={() => openEdit(a)}
                        title={t("common.edit")}
                        aria-label={t("common.edit")}
                      >
                        <Icon name="edit" className="w-4 h-4" />
                      </Button>

                      {/* Inline status change stays a select: it is a direct
                          edit of one field, not a navigation choice. */}
                      <Select
                        fullWidth={false}
                        className="w-[8.5rem] flex-shrink-0"
                        aria-label={t("common.status")}
                        value={a.status}
                        onChange={e => changeStatus.mutate({ id: a.id, status: e.target.value })}
                      >
                        {["SCHEDULED","RESCHEDULED","CANCELLED","PENDING"].map(sv => (
                          <option key={sv} value={sv}>{statusKey[sv] || sv}</option>
                        ))}
                      </Select>

                      {/* Only show "Show to Scheduling" for Scheduling-created hidden appointments */}
                      {!a.visibleToScheduling && a.createdByRole === 'SCHEDULING' && (
                        <Button size="sm" variant="primary" className="flex-shrink-0" loading={approveMutation.isPending} onClick={() => approveMutation.mutate(a.id)}>
                          {isAr ? "إظهار للجدولة" : "Show to Scheduling"}
                        </Button>
                      )}

                      {/* Export-to-Technician approval: only for appointments exported by Scheduling and still pending */}
                      {!a.visibleToTechnician && !a.adminApproved && (
                        <Button size="sm" variant="primary" className="flex-shrink-0" loading={approveExportMutation.isPending} onClick={() => approveExportMutation.mutate(a.id)}>
                          {t("appointments.approveExport")}
                        </Button>
                      )}

                      <Button
                        size="sm" variant="ghost" iconOnly
                        onClick={() => setPendingDelete(a.id)}
                        title={isAr ? "حذف" : "Delete"}
                        aria-label={isAr ? "حذف" : "Delete"}
                        className="hover:text-danger-fg hover:bg-danger-bg"
                      >
                        <Icon name="trash" className="w-4 h-4" />
                      </Button>
                    </div>
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        </TableShell>
      )}

      {meta && (
        <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete);
          setPendingDelete(null);
        }}
        title={isAr ? "حذف هذا الموعد نهائياً؟" : "Permanently delete this appointment?"}
        confirmLabel={isAr ? "حذف" : "Delete"}
        cancelLabel={t("common.cancel")}
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
