import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";

type PaymentMethod = "CASH" | "BANK_TRANSFER";
type ServiceType = "INSTALLATION" | "MAINTENANCE" | "VISIT_ONLY";

const EMPTY_RECORD = {
  customerName: "", customerPhone: "", customerDetails: "", serviceNotes: "",
  serviceType: "MAINTENANCE" as ServiceType, paymentMethod: "CASH" as PaymentMethod, amount: "",
};

export default function TechUrgentAppointments() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const socket = useSocket();
  const [submitModal, setSubmitModal] = useState<{ appt: any } | null>(null);
  const [record, setRecord] = useState({ ...EMPTY_RECORD });

  useEffect(() => {
    window.dispatchEvent(new Event("clear-badge-urgent-tech"));
  }, []);

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
      toast.success(t("urgentAppts.recordSaved"));
      setSubmitModal(null);
      setRecord({ ...EMPTY_RECORD });
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || t("common.error")),
  });

  function handleSubmitRecord(e: React.FormEvent) {
    e.preventDefault();
    if (!submitModal) return;
    if (!record.customerName.trim() || !record.customerPhone.trim() || !record.amount) {
      toast.error(t("urgentAppts.requiredFieldsMissing"));
      return;
    }
    const amount = parseFloat(record.amount);
    if (isNaN(amount) || amount < 0) {
      toast.error(isAr ? "المبلغ غير صحيح" : "Invalid amount");
      return;
    }
    submitMutation.mutate({
      appointmentId: submitModal.appt.id,
      customerName: record.customerName.trim(),
      customerPhone: record.customerPhone.trim(),
      customerDetails: record.customerDetails || undefined,
      serviceNotes: record.serviceNotes || undefined,
      serviceType: record.serviceType,
      paymentMethod: record.paymentMethod,
      amount,
    });
  }

  const PAYMENT_LABELS: Record<string, string> = {
    CASH: isAr ? "نقداً" : "Cash",
    BANK_TRANSFER: isAr ? "تحويل بنكي" : "Bank Transfer",
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
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      {new Date(a.scheduledDate).toLocaleString(isAr ? "ar-SA" : undefined)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-[160px] truncate">{a.notes || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                        🚨 {isAr ? "عاجل" : "Urgent"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {!a.urgentVisitRecord ? (
                        <button onClick={() => { setSubmitModal({ appt: a }); setRecord({ ...EMPTY_RECORD }); }}
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.customerName")} *</label>
                  <input required value={record.customerName} onChange={e => setRecord(r => ({ ...r, customerName: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.customerPhone")} *</label>
                  <input required value={record.customerPhone} onChange={e => setRecord(r => ({ ...r, customerPhone: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                </div>
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
                    <button key={st} type="button" onClick={() => setRecord(r => ({ ...r, serviceType: st }))}
                      className={`flex-1 py-2 text-xs rounded-lg border font-medium transition-colors ${record.serviceType === st ? "bg-orange-500 text-white border-orange-500" : "hover:bg-slate-50"}`}>
                      {SERVICE_TYPE_LABELS[st]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.paymentMethod")} *</label>
                <div className="flex gap-2">
                  {(["CASH","BANK_TRANSFER"] as PaymentMethod[]).map(pm => (
                    <button key={pm} type="button" onClick={() => setRecord(r => ({ ...r, paymentMethod: pm }))}
                      className={`flex-1 py-2 text-xs rounded-lg border font-medium transition-colors ${record.paymentMethod === pm ? "bg-orange-500 text-white border-orange-500" : "hover:bg-slate-50"}`}>
                      {PAYMENT_LABELS[pm]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.amount")} * (SAR)</label>
                <input type="number" step="0.01" min="0" required value={record.amount}
                  onChange={e => setRecord(r => ({ ...r, amount: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={submitMutation.isPending || !record.customerName.trim() || !record.customerPhone.trim() || !record.amount}
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
