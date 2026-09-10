import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";
import { useTechnicianEmployees } from "../hooks/useTechnicianEmployees";
import { dateOnlyToApiDate, formatGregorianDate, formatGregorianTime } from "../../utils/dateTimeInput";
import { isValidPrimaryPhone } from "../../utils/phone";
import { fetchAllPages } from "../../utils/fetchAllPages";
import { Button } from "../../ui/Button";
import { Input, Field } from "../../ui/Field";
import { Badge } from "../../ui/Badge";
import { PageHeader } from "../../ui/Surface";
import { EmptyState, Loading } from "../../ui/Feedback";
import { TableShell, Table, THead, TH, TBody, TR, TD } from "../../ui/Table";
import { Modal, ConfirmDialog } from "../../ui/Modal";
import { Segmented } from "../../ui/Segmented";
import { Icon } from "../../ui/icons";
import { cx } from "../../ui/cx";

type Tab = "list" | "records";

const EMPTY_FORM = {
  date: "", customerName: "", customerPhone: "", city: "", district: "", street: "",
  postalCode: "", buildingNo: "", floorNo: "", apartmentNo: "", notes: "",
  // Optional assignee. An urgent appointment left unassigned stays shared-pool
  // work visible to every technician, exactly as before -- naming a technician
  // is what makes it THEIRS, and what triggers their urgent alert (Phase 2
  // Event A). The server re-validates the id against role and active state.
  technicianId: "",
};

export default function UrgentAppointments() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const socket = useSocket();
  const [tab, setTab] = useState<Tab>("list");
  const [showForm, setShowForm] = useState(false);
  // Replaces window.confirm(): the native dialog cannot be themed or
  // translated, and this one deletes related records with it.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  // The same roster Employees and Access Codes read, through the same hook and
  // the same cache entry -- so this list can never disagree with them.
  const technicians = useTechnicianEmployees();
  const [visitDetail, setVisitDetail] = useState<any | null>(null);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["urgent-appointments"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    };
    socket.on("appointment:deleted", refresh);
    socket.on("appointment:created", refresh);
    return () => {
      socket.off("appointment:deleted", refresh);
      socket.off("appointment:created", refresh);
    };
  }, [socket, qc]);

  // Perf fix: GET /appointments is now paginated (default 20/page, max 100).
  // This is an action-required list of every unresolved urgent appointment --
  // silently showing only page 1 could hide a real urgent job, so this fetches
  // every page explicitly (fetchAllPages) rather than adding paginated
  // browsing UI to what must always be a complete list.
  const { data: apptData, isLoading: apptLoading } = useQuery({
    queryKey: ["urgent-appointments"],
    queryFn: () => fetchAllPages(api, "/appointments", { urgent: "true" })
      .then(rows => rows.filter((a: any) => a.createdByRole === 'ADMIN' || !a.createdByRole)),
  });

  const { data: visitData, isLoading: visitLoading } = useQuery({
    queryKey: ["urgent-visit-records"],
    queryFn: () => api.get("/urgent-visits").then(r => r.data.data || []),
    enabled: tab === "records",
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post("/appointments", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["urgent-appointments"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success(isAr ? "تم إنشاء الموعد العاجل" : "Urgent appointment created");
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || t("common.error")),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/appointments/${id}/approve-visibility`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["urgent-appointments"] });
      toast.success(isAr ? "تم إظهار الموعد للجدولة" : "Appointment visible to Scheduling");
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || t("common.error")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/appointments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["urgent-appointments"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success(isAr ? "تم حذف الموعد العاجل" : "Urgent appointment deleted");
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || t("common.error")),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const scheduledDate = dateOnlyToApiDate(form.date);
    const customerName = form.customerName.trim();
    const customerPhone = form.customerPhone.trim();
    if (!scheduledDate || !form.city || !form.district || !form.street) {
      toast.error(isAr ? "الحقول المطلوبة: المدينة، الحي، الشارع، التاريخ" : "Required: City, District, Street, Date");
      return;
    }
    if (!customerName) {
      toast.error(isAr ? "اسم العميل مطلوب" : "Customer name is required");
      return;
    }
    if (!isValidPrimaryPhone(customerPhone)) {
      toast.error(t("customers.phoneInvalid"));
      return;
    }
    const urgentLocation = JSON.stringify({
      city: form.city, district: form.district, street: form.street,
      postalCode: form.postalCode, buildingNo: form.buildingNo,
      floorNo: form.floorNo, apartmentNo: form.apartmentNo,
    });
    createMutation.mutate({
      scheduledDate,
      type: "MAINTENANCE",
      notes: form.notes || undefined,
      urgentLocation,
      isUrgent: true,
      visibleToScheduling: false,
      customerName,
      customerPhone,
      technicianId: form.technicianId || undefined,
    });
  }

  function parseLocation(locStr: string | null | undefined) {
    if (!locStr) return null;
    try { return JSON.parse(locStr); } catch { return { city: locStr }; }
  }

  function locationText(a: any) {
    const loc = parseLocation(a.urgentLocation);
    if (!loc) return a.notes || "—";
    return [loc.city, loc.district, loc.street, loc.buildingNo].filter(Boolean).join("، ");
  }

  const PAYMENT_LABELS: Record<string, string> = {
    CASH: isAr ? "نقداً" : "Cash",
    BANK_TRANSFER_COMMERCIAL: isAr ? "تحويل بنكي (تجاري)" : "Bank Transfer (Commercial)",
    BANK_TRANSFER_PERSONAL: isAr ? "تحويل بنكي (خاص)" : "Bank Transfer (Personal)",
  };

  const SERVICE_LABELS: Record<string, string> = {
    INSTALLATION: isAr ? "تركيب" : "Installation",
    MAINTENANCE: isAr ? "صيانة" : "Maintenance",
    VISIT_ONLY: isAr ? "زيارة فقط" : "Visit Only",
  };

  // Outstanding = unresolved urgent appointments (isUrgent, no urgentVisitRecord
  // submitted yet) -- state/data-driven, matches the badge in the sidebar (see
  // components/Sidebar.tsx), never a localStorage-only counter.
  const outstandingCount = (apptData || []).filter((a: any) => !a.urgentVisitRecord).length;

  /** Label/value row inside the visit-record detail. */
  const fact = (label: React.ReactNode, value: React.ReactNode) => (
    <div className="flex gap-2">
      <span className="text-fg-muted min-w-[120px] flex-shrink-0 text-2xs">{label}:</span>
      <span className="text-fg-secondary text-2xs break-words min-w-0">{value}</span>
    </div>
  );

  const factGroup = (title: React.ReactNode, children: React.ReactNode, className?: string) => (
    <section>
      <p className="text-2xs font-semibold uppercase tracking-wide text-fg-muted mb-2">{title}</p>
      <div className={cx("rounded-md p-3 space-y-2 border", className || "bg-surface-subtle border-line-subtle")}>
        {children}
      </div>
    </section>
  );

  const urgentInput = (
    id: string,
    label: string,
    key: string,
    required = false,
    dir?: "ltr",
  ) => (
    <Field label={label} htmlFor={id} required={required}>
      <Input
        id={id}
        required={required}
        dir={dir}
        value={(form as any)[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
      />
    </Field>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("urgentAppts.title")}
        subtitle={
          outstandingCount > 0
            ? <Badge tone="urgent" dot>{isAr ? `${outstandingCount} بانتظار الفني` : `${outstandingCount} awaiting technician`}</Badge>
            : undefined
        }
        actions={
          <Button variant={showForm ? "secondary" : "primary"} onClick={() => setShowForm(v => !v)}>
            <Icon name={showForm ? "close" : "add"} className="w-3.5 h-3.5" />
            {showForm ? t("common.cancel") : t("urgentAppts.newUrgent")}
          </Button>
        }
      />

      {showForm && (
        <div className="bg-surface border border-line rounded-md">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
            <h2 className="text-sm font-semibold text-fg">{t("urgentAppts.newUrgent")}</h2>
            <HelpButton titleAr={HELP["admin.urgentAppointments"].titleAr} contentAr={HELP["admin.urgentAppointments"].contentAr} />
          </div>

          <form onSubmit={handleSubmit}>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={t("common.date")} htmlFor="urgent-date" required>
                  <Input
                    id="urgent-date" type="date" lang="en-GB" dir="ltr" required
                    value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  />
                </Field>
                {/* Optional assignee. Leaving it unset keeps the appointment in
                    the shared urgent pool every technician can see -- the
                    pre-existing behaviour. Choosing a technician assigns it to
                    them and is what sends them the urgent alert. */}
                <Field label={t("alerts.assignTechnician")} htmlFor="urgent-technician">
                  <select
                    id="urgent-technician"
                    className="w-full h-9 rounded-md border border-line bg-surface px-2.5 text-[0.8125rem] text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                    value={form.technicianId}
                    onChange={e => setForm(f => ({ ...f, technicianId: e.target.value }))}
                  >
                    <option value="">{t("alerts.unassigned")}</option>
                    {(technicians.list.data || [])
                      .filter(techRow => techRow.isActive)
                      .map(techRow => (
                        <option key={techRow.id} value={techRow.id}>{techRow.name}</option>
                      ))}
                  </select>
                </Field>
              </div>

              <div>
                <h3 className="text-2xs font-semibold uppercase tracking-wide text-fg-muted mb-2">
                  {t("urgentAppts.customerInfo")}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {urgentInput("urgent-cust-name", t("urgentAppts.customerName"), "customerName", true)}
                  {urgentInput("urgent-cust-phone", t("urgentAppts.customerPhone"), "customerPhone", true, "ltr")}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <h3 className="text-2xs font-semibold uppercase tracking-wide text-fg-muted">
                    {t("urgentAppts.locationInfo")}
                  </h3>
                  <HelpButton titleAr={HELP["form.urgentLocation"].titleAr} contentAr={HELP["form.urgentLocation"].contentAr} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {urgentInput("urgent-city", t("urgentAppts.city"), "city", true)}
                  {urgentInput("urgent-district", t("urgentAppts.district"), "district", true)}
                  {urgentInput("urgent-street", t("urgentAppts.street"), "street", true)}
                  {urgentInput("urgent-postal", t("urgentAppts.postalCode"), "postalCode")}
                  {urgentInput("urgent-building", t("urgentAppts.buildingNo"), "buildingNo")}
                  {urgentInput("urgent-floor", t("urgentAppts.floorNo"), "floorNo")}
                  {urgentInput("urgent-apartment", t("urgentAppts.apartmentNo"), "apartmentNo")}
                  {urgentInput("urgent-notes", t("common.notes"), "notes")}
                </div>
              </div>
            </div>

            <div className="px-4 py-2.5 border-t border-line bg-surface-subtle flex gap-2 justify-end">
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>{t("common.cancel")}</Button>
              <Button type="submit" variant="primary" loading={createMutation.isPending}>
                {t("urgentAppts.sendToTech")}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Explicit generic: without it T widens to string (the labels record is
          keyed by string), so onChange could not be handed setTab. */}
      <Segmented<Tab>
        fullWidth={false}
        value={tab}
        options={["list", "records"]}
        labels={{
          list: isAr ? "المواعيد العاجلة" : "Urgent Appointments",
          records: isAr ? "سجلات الزيارات" : "Visit Records",
        }}
        onChange={setTab}
        ariaLabel={t("urgentAppts.title")}
      />

      {tab === "list" && (
        apptLoading ? (
          <Loading label={t("common.loading")} />
        ) : !(apptData?.length) ? (
          <div className="bg-surface border border-line rounded-md">
            <EmptyState icon={<Icon name="urgent" className="w-5 h-5" />} title={t("urgentAppts.noRecords")} />
          </div>
        ) : (
          <TableShell>
            <Table className="min-w-[760px]">
              <THead>
                <tr>
                  <TH>{isAr ? "الموقع" : "Location"}</TH>
                  <TH width="7rem">{t("common.date")}</TH>
                  <TH>{t("common.notes")}</TH>
                  <TH width="8rem">{isAr ? "الرؤية" : "Visibility"}</TH>
                  <TH width="12rem">{t("common.actions")}</TH>
                </tr>
              </THead>
              <TBody>
                {apptData.map((a: any) => (
                  <TR key={a.id}>
                    <TD>
                      <div className="font-medium text-fg">{locationText(a)}</div>
                      {a.urgentLocation && (() => {
                        const loc = parseLocation(a.urgentLocation);
                        if (!loc) return null;
                        const parts = [
                          loc.buildingNo && `${isAr ? "م" : "B"}${loc.buildingNo}`,
                          loc.floorNo && `${isAr ? "ط" : "F"}${loc.floorNo}`,
                          loc.apartmentNo && `${isAr ? "ش" : "A"}${loc.apartmentNo}`,
                        ].filter(Boolean).join(" | ");
                        return parts ? <div className="text-2xs text-fg-muted mt-0.5">{parts}</div> : null;
                      })()}
                    </TD>
                    <TD className="tabular-nums whitespace-nowrap"><span dir="ltr">{formatGregorianDate(a.scheduledDate)}</span></TD>
                    <TD className="text-fg-secondary text-2xs max-w-[220px] truncate" title={a.notes || undefined}>
                      {a.notes || "—"}
                    </TD>
                    <TD>
                      <Badge tone={a.visibleToScheduling ? "success" : "pending"} dot>
                        {a.visibleToScheduling ? t("urgentAppts.approved") : t("urgentAppts.hidden")}
                      </Badge>
                    </TD>
                    <TD>
                      <div className="flex gap-1 items-center">
                        {!a.visibleToScheduling && (
                          <Button size="sm" variant="primary" loading={approveMutation.isPending} onClick={() => approveMutation.mutate(a.id)}>
                            {t("urgentAppts.approve")}
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
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableShell>
        )
      )}

      {tab === "records" && (
        visitLoading ? (
          <Loading label={t("common.loading")} />
        ) : !(visitData?.length) ? (
          <div className="bg-surface border border-line rounded-md">
            <EmptyState icon={<Icon name="queue" className="w-5 h-5" />} title={t("urgentAppts.noRecords")} />
          </div>
        ) : (
          <TableShell>
            <Table className="min-w-[860px]">
              <THead>
                <tr>
                  <TH>{t("urgentAppts.customerName")}</TH>
                  <TH width="9rem">{t("urgentAppts.customerPhone")}</TH>
                  <TH width="8rem">{t("urgentAppts.serviceType")}</TH>
                  <TH width="11rem">{t("urgentAppts.paymentMethod")}</TH>
                  <TH width="7rem" align="end">{t("urgentAppts.amount")}</TH>
                  <TH width="9rem">{isAr ? "الفني" : "Technician"}</TH>
                  <TH width="7rem">{t("common.date")}</TH>
                </tr>
              </THead>
              <TBody>
                {visitData.map((v: any) => (
                  <TR key={v.id} onClick={() => setVisitDetail(v)}>
                    <TD className="font-medium">{v.customerName || v.appointment?.customer?.name || "—"}</TD>
                    <TD className="text-fg-secondary"><span dir="ltr">{v.customerPhone || "—"}</span></TD>
                    <TD className="text-fg-secondary text-2xs">
                      {v.serviceType ? (SERVICE_LABELS[v.serviceType] || v.serviceType) : "—"}
                    </TD>
                    <TD>
                      {v.paymentMethod ? (
                        <Badge tone={v.paymentMethod === "CASH" ? "success" : "info"}>
                          {PAYMENT_LABELS[v.paymentMethod] || v.paymentMethod}
                        </Badge>
                      ) : (
                        <span className="text-2xs text-fg-muted">—</span>
                      )}
                    </TD>
                    <TD align="end" className="font-semibold tabular-nums">
                      {v.amount != null ? v.amount.toFixed(2) : "—"}
                    </TD>
                    <TD className="text-fg-secondary">{v.submittedBy?.name || "—"}</TD>
                    <TD className="text-fg-secondary text-2xs tabular-nums whitespace-nowrap">
                      <span dir="ltr">{formatGregorianDate(v.createdAt)}</span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableShell>
        )
      )}

      {visitDetail && (
        <Modal
          open
          onClose={() => setVisitDetail(null)}
          size="md"
          className="max-h-[88vh]"
          title={isAr ? "تفاصيل الزيارة العاجلة" : "Urgent Visit Details"}
          footer={
            <div className="flex items-center justify-between w-full gap-3">
              <span className="text-2xs text-fg-muted tabular-nums" dir="ltr">
                {isAr ? "أُرسلت في: " : "Submitted: "}{formatGregorianDate(visitDetail.createdAt)} {formatGregorianTime(visitDetail.createdAt)}
              </span>
              <Button variant="secondary" onClick={() => setVisitDetail(null)}>{isAr ? "إغلاق" : "Close"}</Button>
            </div>
          }
        >
          <div className="space-y-4">
            {factGroup(isAr ? "معلومات الزيارة" : "Visit Information", (
              <>
                {fact(isAr ? "اسم الفني" : "Technician", <span className="font-semibold text-fg">{visitDetail.submittedBy?.name || "—"}</span>)}
                {fact(isAr ? "اسم العميل" : "Customer", visitDetail.customerName || visitDetail.appointment?.customer?.name || "—")}
                {fact(isAr ? "رقم الجوال" : "Phone", <span dir="ltr">{visitDetail.customerPhone || "—"}</span>)}
                {fact(isAr ? "الموقع" : "Location", visitDetail.appointment ? locationText(visitDetail.appointment) : "—")}
                {fact(isAr ? "نوع الخدمة" : "Service Type", visitDetail.serviceType ? (SERVICE_LABELS[visitDetail.serviceType] || visitDetail.serviceType) : "—")}
                {visitDetail.appointment?.scheduledDate && fact(
                  isAr ? "تاريخ الموعد" : "Appointment Date",
                  <span dir="ltr" className="tabular-nums">{formatGregorianDate(visitDetail.appointment.scheduledDate)}</span>
                )}
              </>
            ))}

            {/* Details (only when present -- customerDetails/serviceNotes are the
                only two free-text fields the active technician form populates) */}
            {(visitDetail.customerDetails || visitDetail.serviceNotes) && factGroup(isAr ? "التفاصيل" : "Details", (
              <>
                {visitDetail.customerDetails && fact(isAr ? "تفاصيل العميل" : "Customer Details", visitDetail.customerDetails)}
                {visitDetail.serviceNotes && fact(isAr ? "ملاحظات الخدمة" : "Service Notes", visitDetail.serviceNotes)}
              </>
            ))}

            {/* Payment (Admin-only page -- API already returns raw values, no Scheduling exposure here) */}
            {factGroup(isAr ? "معلومات الدفع" : "Payment Information", (
              <>
                {fact(
                  isAr ? "المبلغ" : "Amount",
                  <span className="font-semibold text-fg text-sm tabular-nums">
                    {visitDetail.amount != null ? visitDetail.amount.toFixed(2) : "0.00"} {isAr ? "ريال" : "SAR"}
                  </span>
                )}
                {fact(
                  isAr ? "طريقة الدفع" : "Payment Method",
                  visitDetail.serviceType === "VISIT_ONLY"
                    ? (isAr ? "غير مطلوب (زيارة فقط)" : "N/A (Visit Only)")
                    : (PAYMENT_LABELS[visitDetail.paymentMethod] || visitDetail.paymentMethod || "—")
                )}
              </>
            ), "bg-success-bg border-success-border")}
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete);
          setPendingDelete(null);
        }}
        title={isAr ? "حذف هذا الموعد العاجل؟" : "Delete this urgent appointment?"}
        message={isAr ? "سيتم حذف جميع السجلات المرتبطة به." : "All related records will be removed."}
        confirmLabel={isAr ? "حذف" : "Delete"}
        cancelLabel={t("common.cancel")}
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
