import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";
import { formatGregorianDate } from "../../utils/dateTimeInput";
import { useAuthStore } from "../store/authStore";
// Reuses Modification #13's exact first-name rule/extraction (Part B of this
// batch) rather than duplicating a second validator -- same file family
// (technician/pages), same production logic.
import { FIRST_NAME_RE, firstNameOf } from "./TaskDetail";
import { fetchAllPages } from "../../utils/fetchAllPages";
import { Button } from "../../ui/Button";
import { Input, Textarea, Field, Label } from "../../ui/Field";
import { Badge } from "../../ui/Badge";
import { PageHeader } from "../../ui/Surface";
import { EmptyState, Loading, Callout } from "../../ui/Feedback";
import { TableShell, Table, THead, TH, TBody, TR, TD } from "../../ui/Table";
import { Modal } from "../../ui/Modal";
import { Segmented } from "../../ui/Segmented";
import { Icon } from "../../ui/icons";

type PaymentMethod = "CASH" | "BANK_TRANSFER_COMMERCIAL" | "BANK_TRANSFER_PERSONAL";
type PaymentGroup = "" | "CASH" | "BANK_TRANSFER";
type TransferType = "" | "COMMERCIAL" | "PERSONAL";
type ServiceType = "INSTALLATION" | "MAINTENANCE" | "VISIT_ONLY";

// Visit Only / Bank Transfer subtype fix: paymentGroup is the top-level
// Cash/Bank Transfer choice; transferType only matters (and is only shown)
// when paymentGroup is Bank Transfer, resolving to one of the two required
// subtypes. Visit Only needs neither -- see resolvePaymentMethod() below.
const EMPTY_RECORD = {
  customerDetails: "", serviceNotes: "",
  serviceType: "MAINTENANCE" as ServiceType,
  paymentGroup: "CASH" as PaymentGroup,
  transferType: "" as TransferType,
  amount: "",
  technicianName: "",
};

const FORM_ID = "urgent-visit-record-form";

export default function TechUrgentAppointments() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const socket = useSocket();
  const { user } = useAuthStore();
  const [submitModal, setSubmitModal] = useState<{ appt: any } | null>(null);
  const [record, setRecord] = useState({ ...EMPTY_RECORD });

  useEffect(() => {
    if (!socket) return;
    const refresh = () => qc.invalidateQueries({ queryKey: ["tech-urgent-appointments"] });
    socket.on("appointment:created", refresh);
    socket.on("appointment:deleted", refresh);
    socket.on("customer:deleted", refresh);
    return () => {
      socket.off("appointment:created", refresh);
      socket.off("appointment:deleted", refresh);
      socket.off("customer:deleted", refresh);
    };
  }, [socket, qc]);

  // Perf fix: GET /appointments is now paginated (default 20/page, max 100).
  // This is an action-required list of every unresolved urgent appointment --
  // silently showing only page 1 could hide a real urgent job, so this fetches
  // every page explicitly (fetchAllPages) rather than adding paginated
  // browsing UI to what must always be a complete list.
  const { data, isLoading } = useQuery({
    queryKey: ["tech-urgent-appointments"],
    queryFn: () => fetchAllPages(api, "/appointments", { urgent: "true" }),
  });

  const submitMutation = useMutation({
    mutationFn: (body: any) => api.post("/urgent-visits", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tech-urgent-appointments"] });
      // This technician's own completion resolves one unresolved urgent item --
      // refresh the sidebar badge immediately rather than waiting for its 30s poll.
      qc.invalidateQueries({ queryKey: ["urgent-unresolved-tech"] });
      toast.success(t("urgentAppts.recordSaved"));
      setSubmitModal(null);
      setRecord({ ...EMPTY_RECORD });
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || t("common.error")),
  });

  const isVisitOnly = record.serviceType === "VISIT_ONLY";

  // Resolves the final 3-way value the backend accepts, or null when no
  // payment method applies (Visit Only) -- never trusts a stale
  // paymentGroup/transferType combination left over from switching modes.
  function resolvePaymentMethod(): PaymentMethod | null {
    if (isVisitOnly) return null;
    if (record.paymentGroup === "CASH") return "CASH";
    if (record.paymentGroup === "BANK_TRANSFER" && record.transferType === "COMMERCIAL") return "BANK_TRANSFER_COMMERCIAL";
    if (record.paymentGroup === "BANK_TRANSFER" && record.transferType === "PERSONAL") return "BANK_TRANSFER_PERSONAL";
    return null;
  }

  // Visit Only: payment method/amount are not required at all. Otherwise:
  // a payment group must be chosen, and Bank Transfer additionally requires
  // its subtype -- both enforced again server-side (never trust the client).
  const paymentValid = isVisitOnly || resolvePaymentMethod() !== null;
  const amountValid = isVisitOnly || (!!record.amount.trim() && !isNaN(parseFloat(record.amount)) && parseFloat(record.amount) >= 0);
  const trimmedTechnicianName = record.technicianName.trim();
  const technicianNameValid = !!trimmedTechnicianName && FIRST_NAME_RE.test(trimmedTechnicianName);
  const technicianNameError = trimmedTechnicianName && !technicianNameValid
    ? t("tasks.technicianNameFirstOnly")
    : null;
  const isRecordValid = paymentValid && amountValid && technicianNameValid;

  function selectServiceType(st: ServiceType) {
    setRecord(r => {
      if (st === "VISIT_ONLY") {
        // Amount automatically becomes 0; any previously-selected payment
        // method/transfer subtype is cleared, not just hidden.
        return { ...r, serviceType: st, amount: "0", paymentGroup: "", transferType: "" };
      }
      if (r.serviceType === "VISIT_ONLY") {
        // Coming back from Visit Only: normal validation resumes. Nothing
        // stale to restore -- the user re-enters amount/payment fresh.
        return { ...r, serviceType: st, amount: "", paymentGroup: "", transferType: "" };
      }
      return { ...r, serviceType: st };
    });
  }

  function selectPaymentGroup(pg: PaymentGroup) {
    // Always clears transferType, whether entering or leaving Bank Transfer --
    // a subtype must be re-selected every time Bank Transfer is (re)chosen.
    setRecord(r => ({ ...r, paymentGroup: pg, transferType: "" }));
  }

  function handleSubmitRecord(e: React.FormEvent) {
    e.preventDefault();
    if (!submitModal) return;
    if (!isRecordValid) {
      toast.error(t("urgentAppts.requiredFieldsMissing"));
      return;
    }
    const paymentMethod = resolvePaymentMethod();
    if (!isVisitOnly) {
      const amount = parseFloat(record.amount);
      if (isNaN(amount) || amount < 0) {
        toast.error(isAr ? "المبلغ غير صحيح" : "Invalid amount");
        return;
      }
    }
    submitMutation.mutate({
      appointmentId: submitModal.appt.id,
      customerDetails: record.customerDetails || undefined,
      serviceNotes: record.serviceNotes || undefined,
      serviceType: record.serviceType,
      ...(paymentMethod ? { paymentMethod } : {}),
      amount: isVisitOnly ? 0 : parseFloat(record.amount),
      technicianName: trimmedTechnicianName,
    });
  }

  const PAYMENT_LABELS: Record<string, string> = {
    CASH: isAr ? "نقداً" : "Cash",
    BANK_TRANSFER: isAr ? "تحويل بنكي" : "Bank Transfer",
  };

  const TRANSFER_TYPE_LABELS: Record<string, string> = {
    COMMERCIAL: t("urgentAppts.commercialTransfer"),
    PERSONAL: t("urgentAppts.personalTransfer"),
  };

  const SERVICE_TYPE_LABELS: Record<string, string> = {
    INSTALLATION: isAr ? "تركيب" : "Installation",
    MAINTENANCE: isAr ? "صيانة" : "Maintenance",
    VISIT_ONLY: isAr ? "زيارة فقط" : "Visit Only",
  };

  function parseLocation(locStr: string | null | undefined) {
    if (!locStr) return null;
    try { return JSON.parse(locStr); } catch { return { city: locStr }; }
  }

  function locationText(a: any) {
    const loc = parseLocation(a.urgentLocation);
    if (!loc && a.notes) return a.notes;
    if (!loc) return isAr ? "موقع عاجل" : "Urgent Location";
    return [loc.city, loc.district, loc.street].filter(Boolean).join("، ");
  }

  const appointments: any[] = data || [];
  const outstanding = appointments.filter((a: any) => !a.urgentVisitRecord).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("urgentAppts.title")}
        subtitle={
          <span className="tabular-nums">
            {isAr
              ? `${appointments.length} موعد · ${outstanding} بانتظار التسليم`
              : `${appointments.length} appointments · ${outstanding} awaiting a record`}
          </span>
        }
      />

      {isLoading ? (
        <Loading label={t("common.loading")} />
      ) : !appointments.length ? (
        <div className="bg-surface border border-line rounded-md">
          <EmptyState
            icon={<Icon name="urgent" className="w-5 h-5" />}
            title={t("urgentAppts.noRecords")}
          />
        </div>
      ) : (
        <TableShell>
          <Table>
            <THead>
              <tr>
                <TH>{isAr ? "الموقع" : "Location"}</TH>
                <TH width="7rem">{t("common.date")}</TH>
                <TH>{t("common.notes")}</TH>
                <TH width="8rem">{t("common.status")}</TH>
                <TH width="11rem">{t("common.actions")}</TH>
              </tr>
            </THead>
            <TBody>
              {appointments.map((a: any) => (
                <TR key={a.id}>
                  <TD className="font-medium">{locationText(a)}</TD>
                  <TD className="tabular-nums whitespace-nowrap text-fg-secondary">
                    <span dir="ltr">{formatGregorianDate(a.scheduledDate)}</span>
                  </TD>
                  <TD className="text-fg-secondary max-w-[220px] truncate" title={a.notes || undefined}>
                    {a.notes || "—"}
                  </TD>
                  <TD>
                    <Badge tone="urgent" dot>{isAr ? "عاجل" : "Urgent"}</Badge>
                  </TD>
                  <TD>
                    {!a.urgentVisitRecord ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setSubmitModal({ appt: a });
                          setRecord({ ...EMPTY_RECORD, technicianName: firstNameOf(user?.name) });
                        }}
                      >
                        {t("urgentAppts.submitRecord")}
                      </Button>
                    ) : (
                      <Badge tone="success" dot>{isAr ? "تم التسليم" : "Submitted"}</Badge>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableShell>
      )}

      <Modal
        open={!!submitModal}
        onClose={() => setSubmitModal(null)}
        closeOnBackdrop={false}
        size="lg"
        title={
          <span className="flex items-center gap-2">
            {t("urgentAppts.visitRecord")}
            <HelpButton titleAr={HELP["form.visitRecord"].titleAr} contentAr={HELP["form.visitRecord"].contentAr} />
          </span>
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setSubmitModal(null)}>{t("common.cancel")}</Button>
            {/* The form lives in the body, so the footer submit reaches it by id. */}
            <Button
              type="submit"
              form={FORM_ID}
              variant="primary"
              disabled={!isRecordValid}
              loading={submitMutation.isPending}
            >
              {t("urgentAppts.submitRecord")}
            </Button>
          </>
        }
      >
        {submitModal && (
          <form id={FORM_ID} onSubmit={handleSubmitRecord} className="space-y-3">
            <Callout tone="urgent">{locationText(submitModal.appt)}</Callout>

            {/* Part B: customer identity is Admin's responsibility, entered at
                urgent-appointment creation time -- read-only here, never
                editable by the Technician. */}
            <div className="bg-surface-subtle border border-line-subtle rounded-md p-3 grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <p className="text-2xs uppercase tracking-wide text-fg-muted mb-0.5">{t("urgentAppts.customerName")}</p>
                <p className="text-[0.8125rem] font-medium text-fg truncate">{submitModal.appt.customer?.name || "—"}</p>
              </div>
              <div className="min-w-0">
                <p className="text-2xs uppercase tracking-wide text-fg-muted mb-0.5">{t("urgentAppts.customerPhone")}</p>
                <p className="text-[0.8125rem] font-medium text-fg truncate" dir="ltr">{submitModal.appt.customer?.phone || "—"}</p>
              </div>
            </div>

            <Field label={t("tasks.technicianName")} htmlFor="urgent-tech-name" required error={technicianNameError}>
              <Input
                id="urgent-tech-name" type="text" required
                value={record.technicianName}
                onChange={e => setRecord(r => ({ ...r, technicianName: e.target.value }))}
                placeholder={isAr ? "مثال: أحمد" : "e.g. Ahmed"}
                invalid={!!technicianNameError}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("urgentAppts.customerDetails")} htmlFor="urgent-cust-details">
                <Textarea
                  id="urgent-cust-details" rows={2}
                  value={record.customerDetails}
                  onChange={e => setRecord(r => ({ ...r, customerDetails: e.target.value }))}
                />
              </Field>
              <Field label={t("urgentAppts.serviceNotes")} htmlFor="urgent-service-notes">
                <Textarea
                  id="urgent-service-notes" rows={2}
                  value={record.serviceNotes}
                  onChange={e => setRecord(r => ({ ...r, serviceNotes: e.target.value }))}
                />
              </Field>
            </div>

            <div>
              <Label required>{t("urgentAppts.serviceType")}</Label>
              <Segmented<ServiceType>
                value={record.serviceType}
                options={["INSTALLATION", "MAINTENANCE", "VISIT_ONLY"]}
                labels={SERVICE_TYPE_LABELS}
                onChange={selectServiceType}
                ariaLabel={t("urgentAppts.serviceType")}
              />
            </div>

            {!isVisitOnly && (
              <div>
                <Label required>{t("urgentAppts.paymentMethod")}</Label>
                <Segmented<"CASH" | "BANK_TRANSFER">
                  value={record.paymentGroup as "CASH" | "BANK_TRANSFER" | ""}
                  options={["CASH", "BANK_TRANSFER"]}
                  labels={PAYMENT_LABELS}
                  onChange={selectPaymentGroup}
                  ariaLabel={t("urgentAppts.paymentMethod")}
                />
              </div>
            )}

            {!isVisitOnly && record.paymentGroup === "BANK_TRANSFER" && (
              <div>
                <Label required>{t("urgentAppts.transferType")}</Label>
                <Segmented<"COMMERCIAL" | "PERSONAL">
                  value={record.transferType as "COMMERCIAL" | "PERSONAL" | ""}
                  options={["COMMERCIAL", "PERSONAL"]}
                  labels={TRANSFER_TYPE_LABELS}
                  onChange={tt => setRecord(r => ({ ...r, transferType: tt }))}
                  ariaLabel={t("urgentAppts.transferType")}
                />
              </div>
            )}

            <Field
              label={`${t("urgentAppts.amount")} (SAR)`}
              htmlFor="urgent-amount"
              required
              hint={isVisitOnly ? (isAr ? "زيارة فقط — المبلغ صفر" : "Visit only — amount is zero") : undefined}
            >
              <Input
                id="urgent-amount" type="number" step="0.01" min="0" required dir="ltr"
                className="tabular-nums"
                value={record.amount}
                disabled={isVisitOnly}
                onChange={e => setRecord(r => ({ ...r, amount: e.target.value }))}
              />
            </Field>
          </form>
        )}
      </Modal>
    </div>
  );
}
