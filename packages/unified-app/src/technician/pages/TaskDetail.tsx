import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import toast from "react-hot-toast";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";

type PaymentMethod = "CASH" | "BANK_TRANSFER";

const EMPTY_COMPLETE = { notes: "", serviceDetails: "", amount: "", paymentMethod: "CASH" as PaymentMethod };

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showComplete, setShowComplete] = useState(false);
  const [showPostpone, setShowPostpone] = useState(false);
  const [completeForm, setCompleteForm] = useState({ ...EMPTY_COMPLETE });
  const [postponeReason, setPostponeReason] = useState("");
  const [postponeDate, setPostponeDate] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["task", id],
    queryFn: () => api.get(`/tasks`).then(r => r.data.data.find((t: any) => t.id === id))
  });

  const start = useMutation({
    mutationFn: () => api.patch(`/tasks/${id}/start`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["task", id] }); toast.success(t("common.success")); }
  });

  const complete = useMutation({
    mutationFn: () => api.patch(`/tasks/${id}/complete`, {
      notes: completeForm.notes,
      serviceDetails: completeForm.serviceDetails,
      completionAmount: parseFloat(completeForm.amount),
      completionPaymentMethod: completeForm.paymentMethod,
    }),
    onSuccess: () => { toast.success(t("common.success")); navigate("/technician/queue"); },
    onError: (err: any) => toast.error(err?.response?.data?.message || t("common.error")),
  });

  const postpone = useMutation({
    mutationFn: () => api.patch(`/tasks/${id}/postpone`, { reason: postponeReason, newDate: postponeDate || undefined }),
    onSuccess: () => { toast.success(t("common.success")); navigate("/technician/queue"); }
  });

  if (isLoading) return <p className="text-center py-12">{t("common.loading")}</p>;
  if (!data) return <p className="text-center py-12">{t("common.error")}</p>;

  const task = data;
  const appt = task.appointment;
  const customer = appt?.customer;
  const addr = customer?.address;

  const isCompleteValid = completeForm.notes.trim() && completeForm.serviceDetails.trim() && completeForm.amount && parseFloat(completeForm.amount) >= 0;

  const PAYMENT_LABELS: Record<string, string> = {
    CASH: isAr ? "نقداً" : "Cash",
    BANK_TRANSFER: isAr ? "تحويل بنكي" : "Bank Transfer",
  };

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <button onClick={() => navigate(-1)} className="text-slate-500 hover:text-slate-700">← {t("common.back")}</button>
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold">{customer?.name || (isAr ? "موعد عاجل" : "Urgent Task")}</h2>
            <p className="text-slate-500">{customer?.phone}</p>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${task.status === "IN_PROGRESS" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>
            {task.status.replace("_"," ")}
          </span>
        </div>
        {addr && (
          <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
            <p className="font-medium mb-1">{t("customers.address")}</p>
            <p>{addr.city}، {addr.district}، {addr.street}</p>
            {addr.buildingNo && <p>{t("customers.buildingNo")}: {addr.buildingNo} {addr.floorNo && `| ${t("customers.floorNo")}: ${addr.floorNo}`}</p>}
            {addr.apartmentNo && <p>{t("customers.apartmentNo")}: {addr.apartmentNo}</p>}
          </div>
        )}
        {!customer && appt?.urgentLocation && (() => {
          try {
            const loc = JSON.parse(appt.urgentLocation);
            return (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm space-y-1">
                <p className="font-medium text-red-700 mb-1">🚨 {isAr ? "موقع العميل" : "Customer Location"}</p>
                {loc.city && <p>{t("customers.city")}: {loc.city}</p>}
                {loc.district && <p>{t("customers.district")}: {loc.district}</p>}
                {loc.street && <p>{t("customers.street")}: {loc.street}</p>}
                {loc.buildingNo && <p>{t("customers.buildingNo")}: {loc.buildingNo}{loc.floorNo ? ` | ${t("customers.floorNo")}: ${loc.floorNo}` : ""}</p>}
                {loc.apartmentNo && <p>{t("customers.apartmentNo")}: {loc.apartmentNo}</p>}
              </div>
            );
          } catch { return null; }
        })()}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-slate-400">{t("appointments.type")}: </span>{appt?.type}</div>
          <div><span className="text-slate-400">{t("common.date")}: </span>{new Date(appt?.scheduledDate).toLocaleDateString()}</div>
        </div>
        <div className="flex gap-3 pt-2">
          {task.status === "APPROVED" && (
            <button onClick={() => start.mutate()} disabled={start.isPending} className="flex-1 bg-orange-600 text-white py-2.5 rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50">
              {t("tasks.start")}
            </button>
          )}
          {task.status === "IN_PROGRESS" && (<>
            <button onClick={() => setShowComplete(true)} className="flex-1 bg-green-600 text-white py-2.5 rounded-lg font-medium hover:bg-green-700">{t("tasks.complete")}</button>
            <button onClick={() => setShowPostpone(true)} className="flex-1 bg-yellow-500 text-white py-2.5 rounded-lg font-medium hover:bg-yellow-600">{t("tasks.postpone")}</button>
          </>)}
        </div>
      </div>

      {showComplete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{t("tasks.confirmComplete")}</h3>
              <HelpButton titleAr={HELP["form.taskCompletion"].titleAr} contentAr={HELP["form.taskCompletion"].contentAr} />
            </div>
            <p className="text-xs text-slate-500 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              {isAr ? "جميع الحقول إلزامية لإتمام المهمة" : "All fields are required to complete the task"}
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("tasks.completionNotes")} *</label>
                <textarea value={completeForm.notes} onChange={e => setCompleteForm(f => ({ ...f, notes: e.target.value }))} rows={3} required
                  placeholder={isAr ? "ملاحظات الإتمام..." : "Completion notes..."}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("tasks.serviceDetails")} *</label>
                <textarea value={completeForm.serviceDetails} onChange={e => setCompleteForm(f => ({ ...f, serviceDetails: e.target.value }))} rows={3} required
                  placeholder={isAr ? "تفاصيل الخدمة المنفذة..." : "Details of work done..."}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("tasks.amount")} * (SAR)</label>
                <input type="number" step="0.01" min="0" required value={completeForm.amount}
                  onChange={e => setCompleteForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("tasks.paymentMethod")} *</label>
                <div className="flex gap-2">
                  {(["CASH","BANK_TRANSFER"] as PaymentMethod[]).map(pm => (
                    <button key={pm} type="button" onClick={() => setCompleteForm(f => ({ ...f, paymentMethod: pm }))}
                      className={`flex-1 py-2 text-xs rounded-lg border font-medium transition-colors ${completeForm.paymentMethod === pm ? "bg-green-600 text-white border-green-600" : "hover:bg-slate-50"}`}>
                      {PAYMENT_LABELS[pm]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => complete.mutate()} disabled={!isCompleteValid || complete.isPending}
                className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">
                {complete.isPending ? t("common.loading") : t("common.save")}
              </button>
              <button onClick={() => { setShowComplete(false); setCompleteForm({ ...EMPTY_COMPLETE }); }}
                className="flex-1 border py-2 rounded-lg text-sm hover:bg-slate-50">{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}

      {showPostpone && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-semibold mb-3">{t("tasks.confirmPostpone")}</h3>
            <textarea value={postponeReason} onChange={e => setPostponeReason(e.target.value)} placeholder={t("tasks.reason") + " *"} rows={3}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 mb-3" />
            <input type="date" value={postponeDate} onChange={e => setPostponeDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 mb-4" />
            <div className="flex gap-2">
              <button onClick={() => postponeReason.trim() && postpone.mutate()} disabled={!postponeReason.trim() || postpone.isPending}
                className="flex-1 bg-yellow-500 text-white py-2 rounded-lg text-sm hover:bg-yellow-600 disabled:opacity-50">
                {postpone.isPending ? t("common.loading") : t("common.save")}
              </button>
              <button onClick={() => setShowPostpone(false)} className="flex-1 border py-2 rounded-lg text-sm hover:bg-slate-50">{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
