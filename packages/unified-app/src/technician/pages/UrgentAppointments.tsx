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

  const { data, isLoading } = useQuery({
    queryKey: ["tech-urgent-appointments"],
    queryFn: () => api.get("/appointments", { params: { urgent: "true", limit: 100 } }).then(r => r.data.data || []),
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">{t("urgentAppts.title")}</h1>
        <span className="text-sm text-slate-400">{isAr ? `${appointments.length} موعد` : `${appointments.length} appointments`}</span>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <p className="text-center py-10 text-slate-400">{t("common.loading")}</p>
        ) : !appointments.length ? (
          <p className="text-center py-10 text-slate-400">{t("urgentAppts.noRecords")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{isAr ? "الموقع" : "Location"}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.date")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.notes")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.status")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((a: any) => (
                  <tr key={a.id} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{locationText(a)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm" dir="ltr">
                      {formatGregorianDate(a.scheduledDate)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-[160px] truncate">{a.notes || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                        🚨 {isAr ? "عاجل" : "Urgent"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {!a.urgentVisitRecord ? (
                        <button onClick={() => { setSubmitModal({ appt: a }); setRecord({ ...EMPTY_RECORD, technicianName: firstNameOf(user?.name) }); }}
                          className="text-xs bg-orange-500 text-white px-3 py-1 rounded-lg hover:bg-orange-600">
                          {t("urgentAppts.submitRecord")}
                        </button>
                      ) : (
                        <span className="text-xs text-green-600 font-medium">
                          ✓ {isAr ? "تم التسليم" : "Submitted"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {submitModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-800">{t("urgentAppts.visitRecord")}</h3>
              <HelpButton titleAr={HELP["form.visitRecord"].titleAr} contentAr={HELP["form.visitRecord"].contentAr} />
            </div>
            <p className="text-xs text-slate-400 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
              🚨 {locationText(submitModal.appt)}
            </p>
            <form onSubmit={handleSubmitRecord} className="space-y-3">
              {/* Part B: customer identity is Admin's responsibility, entered at
                  urgent-appointment creation time -- read-only here, never
                  editable by the Technician. */}
              <div className="bg-slate-50 rounded-lg p-3 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">{t("urgentAppts.customerName")}</p>
                  <p className="text-sm font-medium text-slate-700">{submitModal.appt.customer?.name || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">{t("urgentAppts.customerPhone")}</p>
                  <p className="text-sm font-medium text-slate-700" dir="ltr">{submitModal.appt.customer?.phone || "—"}</p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("tasks.technicianName")} *</label>
                <input type="text" required value={record.technicianName}
                  onChange={e => setRecord(r => ({ ...r, technicianName: e.target.value }))}
                  placeholder={isAr ? "مثال: أحمد" : "e.g. Ahmed"}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 ${technicianNameError ? "border-red-400" : ""}`} />
                {technicianNameError && <p className="text-red-500 text-xs mt-1">{technicianNameError}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.customerDetails")}</label>
                <textarea rows={2} value={record.customerDetails} onChange={e => setRecord(r => ({ ...r, customerDetails: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.serviceNotes")}</label>
                <textarea rows={2} value={record.serviceNotes} onChange={e => setRecord(r => ({ ...r, serviceNotes: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.serviceType")} *</label>
                <div className="flex gap-2">
                  {(["INSTALLATION","MAINTENANCE","VISIT_ONLY"] as ServiceType[]).map(st => (
                    <button key={st} type="button" onClick={() => selectServiceType(st)}
                      className={`flex-1 py-2 text-xs rounded-lg border font-medium transition-colors ${record.serviceType === st ? "bg-orange-500 text-white border-orange-500" : "hover:bg-slate-50"}`}>
                      {SERVICE_TYPE_LABELS[st]}
                    </button>
                  ))}
                </div>
              </div>
              {!isVisitOnly && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.paymentMethod")} *</label>
                  <div className="flex gap-2">
                    {(["CASH","BANK_TRANSFER"] as PaymentGroup[]).map(pg => (
                      <button key={pg} type="button" onClick={() => selectPaymentGroup(pg)}
                        className={`flex-1 py-2 text-xs rounded-lg border font-medium transition-colors ${record.paymentGroup === pg ? "bg-orange-500 text-white border-orange-500" : "hover:bg-slate-50"}`}>
                        {PAYMENT_LABELS[pg]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!isVisitOnly && record.paymentGroup === "BANK_TRANSFER" && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.transferType")} *</label>
                  <div className="flex gap-2">
                    {(["COMMERCIAL","PERSONAL"] as Array<"COMMERCIAL" | "PERSONAL">).map(tt => (
                      <button key={tt} type="button" onClick={() => setRecord(r => ({ ...r, transferType: tt }))}
                        className={`flex-1 py-2 text-xs rounded-lg border font-medium transition-colors ${record.transferType === tt ? "bg-orange-500 text-white border-orange-500" : "hover:bg-slate-50"}`}>
                        {TRANSFER_TYPE_LABELS[tt]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.amount")} * (SAR)</label>
                <input type="number" step="0.01" min="0" required value={record.amount} disabled={isVisitOnly}
                  onChange={e => setRecord(r => ({ ...r, amount: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:bg-slate-100 disabled:text-slate-400" />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={submitMutation.isPending || !isRecordValid}
                  className="flex-1 bg-orange-500 text-white py-2 rounded-lg text-sm hover:bg-orange-600 disabled:opacity-50">
                  {submitMutation.isPending ? "..." : t("urgentAppts.submitRecord")}
                </button>
                <button type="button" onClick={() => setSubmitModal(null)} className="flex-1 border py-2 rounded-lg text-sm hover:bg-slate-50">
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
