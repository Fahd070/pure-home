import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useAuthStore } from "../store/authStore";
import toast from "react-hot-toast";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";
import { formatGregorianDate } from "../../utils/dateTimeInput";

type PaymentMethod = "CASH" | "BANK_TRANSFER_COMMERCIAL" | "BANK_TRANSFER_PERSONAL";
type PaymentGroup = "CASH" | "BANK_TRANSFER";
type TransferType = "" | "COMMERCIAL" | "PERSONAL";

const ACCEPTED_IMG_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMG_PX = 1200;

// Modification #13: one Unicode letter "word" (Latin or Arabic), optionally
// joined by a single internal hyphen/apostrophe -- matches the backend's
// FIRST_NAME_RE in routes/appointments.ts exactly (duplicated deliberately,
// same convention as PHONE_RE between AddCustomer.tsx and customers.ts).
// Exported (alongside firstNameOf below) so permanent tests can exercise the
// exact production logic directly rather than re-implementing it.
export const FIRST_NAME_RE = /^[\p{L}]+(?:['-][\p{L}]+)*$/u;

export function firstNameOf(fullName?: string | null): string {
  const trimmed = (fullName || "").trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}

async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_IMG_PX / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      img.onerror = reject;
      img.src = e.target!.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Bank Transfer subtype fix (Part D, same behavior as the urgent visit form):
// paymentGroup is the top-level Cash/Bank Transfer choice; transferType only
// matters (and is only shown) when paymentGroup is Bank Transfer.
const EMPTY_COMPLETE = { serviceDetails: "", amount: "", paymentGroup: "CASH" as PaymentGroup, transferType: "" as TransferType, nextMaintenanceNote: "", actualCompletionDate: "", technicianName: "" };

// Modification #8: today's date in the local YYYY-MM-DD form a native date
// input expects, used both to default the field and to cap it via `max` so a
// future date can't be picked in the first place (server also rejects it).
function todayDateInputValue(): string {
  const d = new Date();
  const offsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 10);
}

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [showComplete, setShowComplete] = useState(false);
  const [showPostpone, setShowPostpone] = useState(false);
  const [completeForm, setCompleteForm] = useState({ ...EMPTY_COMPLETE });
  const [postponeReason, setPostponeReason] = useState("");
  const [postponeDate, setPostponeDate] = useState("");
  const [completionImage, setCompletionImage] = useState<string | null>(null);
  const [imageCompressing, setImageCompressing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["appointment", id],
    queryFn: () => api.get(`/appointments/${id}`).then(r => r.data.data)
  });

  const start = useMutation({
    mutationFn: () => api.patch(`/appointments/${id}/start`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work-queue"] });
      qc.invalidateQueries({ queryKey: ["appointment", id] });
      toast.success(t("common.success"));
    }
  });

  const complete = useMutation({
    mutationFn: () => api.patch(`/appointments/${id}/complete`, {
      notes: ".",
      serviceDetails: completeForm.serviceDetails,
      completionAmount: parseFloat(completeForm.amount),
      completionPaymentMethod: resolvePaymentMethod(),
      actualCompletionDate: completeForm.actualCompletionDate,
      technicianName: completeForm.technicianName.trim(),
      ...(completionImage ? { completionImage } : {}),
      ...(completeForm.nextMaintenanceNote.trim() ? { nextMaintenanceNote: completeForm.nextMaintenanceNote } : {}),
    }),
    onSuccess: () => { toast.success(t("common.success")); navigate("/technician/queue"); },
    onError: (err: any) => toast.error(err?.response?.data?.message || t("common.error")),
  });

  const postpone = useMutation({
    mutationFn: () => api.patch(`/appointments/${id}/postpone`, { reason: postponeReason, newDate: postponeDate || undefined }),
    onSuccess: () => { toast.success(t("common.success")); navigate("/technician/queue"); }
  });

  if (isLoading) return <p className="text-center py-12">{t("common.loading")}</p>;
  if (!data) return <p className="text-center py-12">{t("common.error")}</p>;

  const appt = data;
  const customer = appt.customer;
  const addr = customer?.address;
  const workStatus = appt.workStatus;

  const trimmedTechnicianName = completeForm.technicianName.trim();
  const technicianNameValid = !!trimmedTechnicianName && FIRST_NAME_RE.test(trimmedTechnicianName);
  const technicianNameError = trimmedTechnicianName && !technicianNameValid
    ? t("tasks.technicianNameFirstOnly")
    : null;

  // Bank Transfer subtype fix (Part D): resolves the final 3-way value the
  // backend accepts. Cash never needs a subtype; Bank Transfer requires one
  // (Commercial or Personal) to be selected, matching the urgent visit form.
  const paymentMethodValid = completeForm.paymentGroup === "CASH" || !!completeForm.transferType;
  function resolvePaymentMethod(): PaymentMethod | null {
    if (completeForm.paymentGroup === "CASH") return "CASH";
    if (completeForm.transferType === "COMMERCIAL") return "BANK_TRANSFER_COMMERCIAL";
    if (completeForm.transferType === "PERSONAL") return "BANK_TRANSFER_PERSONAL";
    return null;
  }

  const isCompleteValid = completeForm.serviceDetails.trim() && completeForm.amount && parseFloat(completeForm.amount) >= 0 && !!completeForm.actualCompletionDate && technicianNameValid && paymentMethodValid;

  const PAYMENT_LABELS: Record<string, string> = {
    CASH: isAr ? "نقداً" : "Cash",
    BANK_TRANSFER: isAr ? "تحويل بنكي" : "Bank Transfer",
  };

  const TRANSFER_TYPE_LABELS: Record<string, string> = {
    COMMERCIAL: t("tasks.commercialTransfer"),
    PERSONAL: t("tasks.personalTransfer"),
  };

  // Modification #9: same status-label mapping WorkQueue uses, so the detail
  // page shows a readable label instead of the raw workStatus enum value.
  const statusLabel: Record<string, string> = {
    WAITING: t("tasks.waiting") || "Waiting",
    IN_PROGRESS: t("tasks.inProgress"),
    COMPLETED: t("tasks.completed"),
    POSTPONED: t("tasks.postponed"),
  };

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) { setCompletionImage(null); return; }
    if (!ACCEPTED_IMG_TYPES.includes(file.type)) {
      toast.error(isAr ? "صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WEBP." : "Unsupported format. Use JPG, PNG or WEBP.");
      e.target.value = "";
      return;
    }
    setImageCompressing(true);
    try {
      const compressed = await compressImage(file);
      setCompletionImage(compressed);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setImageCompressing(false);
    }
  }

  function closeCompleteModal() {
    setShowComplete(false);
    setCompleteForm({ ...EMPTY_COMPLETE });
    setCompletionImage(null);
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <button onClick={() => navigate(-1)} className="text-slate-500 hover:text-slate-700">← {t("common.back")}</button>
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold">{customer?.name || (isAr ? "موعد عاجل" : "Urgent Task")}</h2>
            <p className="text-slate-500">
              {customer?.secondaryPhone ? `${t("customers.primaryPhone")}: ${customer.phone}` : customer?.phone}
            </p>
            {customer?.secondaryPhone && (
              <p className="text-slate-500">{t("customers.secondaryPhone")}: {customer.secondaryPhone}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${workStatus === "IN_PROGRESS" ? "bg-orange-100 text-orange-700" : "bg-yellow-100 text-yellow-700"}`}>
              {statusLabel[workStatus] || workStatus}
            </span>
            {!appt?.technicianId && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-500">
                {t("tasks.unassigned")}
              </span>
            )}
          </div>
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
          <div><span className="text-slate-400">{t("appointments.type")}: </span>{appt?.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}</div>
          <div><span className="text-slate-400">{t("common.date")}: </span><span dir="ltr">{formatGregorianDate(appt?.scheduledDate)}</span></div>
        </div>
        {appt?.notes && (
          <div className="bg-slate-50 rounded-lg p-3 text-sm">
            <p className="font-medium mb-1">{t("common.notes")}</p>
            <p className="text-slate-700 whitespace-pre-wrap">{appt.notes}</p>
          </div>
        )}
        <div className="flex gap-3 pt-2">
          {workStatus === "WAITING" && (
            <button onClick={() => start.mutate()} disabled={start.isPending} className="flex-1 bg-orange-600 text-white py-2.5 rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50">
              {t("tasks.start")}
            </button>
          )}
          {workStatus === "IN_PROGRESS" && (<>
            <button onClick={() => { setCompleteForm(f => ({ ...f, actualCompletionDate: todayDateInputValue(), technicianName: firstNameOf(user?.name) })); setShowComplete(true); }} className="flex-1 bg-green-600 text-white py-2.5 rounded-lg font-medium hover:bg-green-700">{t("tasks.complete")}</button>
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
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("tasks.technicianName")} *</label>
                <input type="text" required value={completeForm.technicianName}
                  onChange={e => setCompleteForm(f => ({ ...f, technicianName: e.target.value }))}
                  placeholder={isAr ? "مثال: أحمد" : "e.g. Ahmed"}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${technicianNameError ? "border-red-400" : ""}`} />
                {technicianNameError && <p className="text-red-500 text-xs mt-1">{technicianNameError}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("tasks.serviceDetails")} *</label>
                <textarea value={completeForm.serviceDetails} onChange={e => setCompleteForm(f => ({ ...f, serviceDetails: e.target.value }))} rows={3} required
                  placeholder={isAr ? "تفاصيل الخدمة المنفذة..." : "Details of work done..."}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("tasks.completionDate")} *</label>
                <input type="date" required lang="en-GB" dir="ltr" value={completeForm.actualCompletionDate} max={todayDateInputValue()}
                  onChange={e => setCompleteForm(f => ({ ...f, actualCompletionDate: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
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
                  {(["CASH","BANK_TRANSFER"] as PaymentGroup[]).map(pg => (
                    <button key={pg} type="button"
                      onClick={() => setCompleteForm(f => ({ ...f, paymentGroup: pg, transferType: "" }))}
                      className={`flex-1 py-2 text-xs rounded-lg border font-medium transition-colors ${completeForm.paymentGroup === pg ? "bg-green-600 text-white border-green-600" : "hover:bg-slate-50"}`}>
                      {PAYMENT_LABELS[pg]}
                    </button>
                  ))}
                </div>
              </div>
              {completeForm.paymentGroup === "BANK_TRANSFER" && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t("tasks.transferType")} *</label>
                  <div className="flex gap-2">
                    {(["COMMERCIAL","PERSONAL"] as Array<"COMMERCIAL" | "PERSONAL">).map(tt => (
                      <button key={tt} type="button"
                        onClick={() => setCompleteForm(f => ({ ...f, transferType: tt }))}
                        className={`flex-1 py-2 text-xs rounded-lg border font-medium transition-colors ${completeForm.transferType === tt ? "bg-green-600 text-white border-green-600" : "hover:bg-slate-50"}`}>
                        {TRANSFER_TYPE_LABELS[tt]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {t("tasks.nextMaintenanceNote")}
                  <span className="text-slate-400 font-normal ms-1">({isAr ? "اختياري" : "Optional"})</span>
                </label>
                <textarea value={completeForm.nextMaintenanceNote} onChange={e => setCompleteForm(f => ({ ...f, nextMaintenanceNote: e.target.value }))} rows={2}
                  placeholder={isAr ? "مثال: يجب استبدال الفلتر في الزيارة القادمة..." : "e.g. filter should be replaced next visit..."}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {t("tasks.attachPhoto")}
                  <span className="text-slate-400 font-normal ms-1">({isAr ? "اختياري" : "Optional"})</span>
                </label>
                <input
                  type="file"
                  accept={ACCEPTED_IMG_TYPES.join(",")}
                  disabled={imageCompressing}
                  onChange={handleImageChange}
                  className="w-full border rounded-lg px-3 py-2 text-xs text-slate-600 cursor-pointer file:me-3 file:text-xs file:font-medium file:border-0 file:rounded file:bg-green-50 file:text-green-700 file:px-2 file:py-1 file:cursor-pointer"
                />
                {imageCompressing && (
                  <p className="text-xs text-slate-400 mt-1 animate-pulse">
                    {isAr ? "جاري ضغط الصورة..." : "Compressing image..."}
                  </p>
                )}
                {completionImage && !imageCompressing && (
                  <div className="mt-2 relative inline-block">
                    <img src={completionImage} alt="preview"
                      className="w-24 h-24 object-cover rounded-lg border border-green-200 shadow-sm" />
                    <button
                      type="button"
                      onClick={() => setCompletionImage(null)}
                      className="absolute -top-1.5 -end-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 leading-none">
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => complete.mutate()} disabled={!isCompleteValid || complete.isPending || imageCompressing}
                className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">
                {complete.isPending ? t("common.loading") : t("common.save")}
              </button>
              <button onClick={closeCompleteModal}
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
            <input type="date" lang="en-GB" dir="ltr" value={postponeDate} onChange={e => setPostponeDate(e.target.value)}
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
