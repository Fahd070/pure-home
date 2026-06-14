import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-slate-400 min-w-[110px] shrink-0">{label}:</span>
      <span className="text-slate-700 break-all">{value}</span>
    </div>
  );
}

function ImageViewer({ src, onClose, isAr }: { src: string; onClose: () => void; isAr: boolean }) {
  const [zoom, setZoom] = useState(1);
  return (
    <div className="fixed inset-0 bg-black/92 z-[9999] flex flex-col items-center justify-center p-3"
      onClick={onClose}>
      <div className="flex gap-2 mb-3" onClick={e => e.stopPropagation()}>
        <button onClick={() => setZoom(z => Math.min(z + 0.5, 5))}
          className="bg-white/15 hover:bg-white/25 text-white rounded-lg w-9 h-9 text-xl flex items-center justify-center font-light">+</button>
        <span className="bg-white/10 text-white/80 rounded-lg px-3 flex items-center text-xs tabular-nums min-w-[52px] justify-center">
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={() => setZoom(z => Math.max(z - 0.5, 0.5))}
          className="bg-white/15 hover:bg-white/25 text-white rounded-lg w-9 h-9 text-xl flex items-center justify-center font-light">−</button>
        <button onClick={() => setZoom(1)}
          className="bg-white/15 hover:bg-white/25 text-white rounded-lg px-3 h-9 text-xs">
          {isAr ? "ملاءمة" : "Fit"}
        </button>
        <button onClick={onClose}
          className="bg-red-700/70 hover:bg-red-600 text-white rounded-lg w-9 h-9 text-base flex items-center justify-center">✕</button>
      </div>
      <div className="overflow-auto rounded-xl border border-white/10 shadow-2xl"
        style={{ maxHeight: "80vh", maxWidth: "90vw" }}
        onClick={e => e.stopPropagation()}>
        <img src={src} alt=""
          style={{
            display: "block",
            maxWidth: zoom === 1 ? "90vw" : "none",
            maxHeight: zoom === 1 ? "76vh" : "none",
            width: zoom > 1 ? `${zoom * 90}vw` : "auto",
            height: "auto",
          }} />
      </div>
      <p className="text-white/25 text-xs mt-2" onClick={e => e.stopPropagation()}>
        {isAr ? "انقر خارج الصورة للإغلاق" : "Click outside to close"}
      </p>
    </div>
  );
}

export default function Technicians() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const [modal, setModal] = useState<{ tech: any; type: "completed" | "postponed" } | null>(null);
  const [imageViewer, setImageViewer] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["technicians-detail"],
    queryFn: () => api.get("/technicians").then(r => r.data.data),
  });

  if (isLoading) return <p className="text-center py-12">{t("common.loading")}</p>;

  const PAYMENT_LABELS: Record<string, string> = {
    CASH: isAr ? "نقداً" : "Cash",
    BANK_TRANSFER: isAr ? "تحويل بنكي" : "Bank Transfer",
  };

  const modalTasks = modal
    ? (modal.type === "completed" ? modal.tech.completedTasksList : modal.tech.postponedTasksList) || []
    : [];

  return (
    <div>
      {imageViewer && (
        <ImageViewer src={imageViewer} onClose={() => setImageViewer(null)} isAr={isAr} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(data || []).map((tech: any) => (
          <div key={tech.id} className="bg-white rounded-xl shadow-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-lg">
                {tech.name?.[0] || "?"}
              </div>
              <div>
                <p className="font-semibold">{tech.name}</p>
                <p className="text-xs text-slate-400">{tech.email}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <button
                onClick={() => (tech.completedTasksList?.length || 0) > 0 ? setModal({ tech, type: "completed" }) : undefined}
                className={`bg-green-50 rounded-lg p-3 text-center transition-colors ${(tech.completedTasksList?.length || 0) > 0 ? "hover:bg-green-100 cursor-pointer" : "cursor-default"}`}>
                <p className="text-xl font-bold text-green-700">{tech.completedTasks || 0}</p>
                <p className="text-xs text-green-600">{t("technicians.completedTasks")}</p>
                {(tech.completedTasksList?.length || 0) > 0 && (
                  <p className="text-xs text-green-400 mt-0.5">{isAr ? "انقر للتفاصيل" : "click for details"}</p>
                )}
              </button>
              <button
                onClick={() => (tech.postponedTasksList?.length || 0) > 0 ? setModal({ tech, type: "postponed" }) : undefined}
                className={`bg-orange-50 rounded-lg p-3 text-center transition-colors ${(tech.postponedTasksList?.length || 0) > 0 ? "hover:bg-orange-100 cursor-pointer" : "cursor-default"}`}>
                <p className="text-xl font-bold text-orange-700">{tech.postponedTasks || 0}</p>
                <p className="text-xs text-orange-600">{isAr ? "المؤجلة" : "Postponed"}</p>
                {(tech.postponedTasksList?.length || 0) > 0 && (
                  <p className="text-xs text-orange-400 mt-0.5">{isAr ? "انقر للتفاصيل" : "click for details"}</p>
                )}
              </button>
              <div className="col-span-2 bg-yellow-50 rounded-lg p-3">
                <p className="text-xl font-bold text-yellow-700">{tech.pendingTasks || 0}</p>
                <p className="text-xs text-yellow-600">{t("technicians.pendingTasks")}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-xl max-h-[80vh] flex flex-col">
            <div className="p-5 border-b flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-semibold text-slate-800">
                  {modal.type === "completed"
                    ? (isAr ? "المهام المكتملة" : "Completed Tasks")
                    : (isAr ? "المهام المؤجلة" : "Postponed Tasks")}
                </h3>
                <p className="text-xs text-slate-400">{modal.tech.name} — {modalTasks.length} {isAr ? "مهمة" : "tasks"}</p>
              </div>
              <button onClick={() => setModal(null)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100">
                ✕
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-3">
              {modalTasks.length === 0 ? (
                <p className="text-center py-8 text-slate-400">{t("common.noRecords")}</p>
              ) : modalTasks.map((task: any) => (
                <div key={task.id}
                  className={`border rounded-lg p-4 ${modal.type === "completed" ? "border-green-100 bg-green-50/50" : "border-orange-100 bg-orange-50/50"}`}>
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="font-medium text-sm">
                        {task.appointment?.customer?.name || (isAr ? "زيارة عاجلة" : "Urgent Visit")}
                      </p>
                      <p className="text-xs text-slate-400">{task.appointment?.customer?.phone || "—"}</p>
                    </div>
                    <span className="text-xs text-slate-400 whitespace-nowrap">
                      {task.appointment?.scheduledDate
                        ? new Date(task.appointment.scheduledDate).toLocaleDateString(isAr ? "ar-SA" : undefined)
                        : "—"}
                    </span>
                  </div>
                  {modal.type === "completed" ? (
                    <div className="space-y-1.5">
                      <DetailRow label={isAr ? "ملاحظات الإتمام" : "Completion notes"} value={task.notes} />
                      <DetailRow label={isAr ? "تفاصيل الخدمة" : "Service details"} value={task.serviceDetails} />
                      <DetailRow label={isAr ? "طريقة الدفع" : "Payment"} value={task.completionPaymentMethod ? (PAYMENT_LABELS[task.completionPaymentMethod] || task.completionPaymentMethod) : null} />
                      {task.completionAmount != null && (
                        <div className="flex gap-2 text-xs">
                          <span className="text-slate-400 min-w-[110px]">{isAr ? "المبلغ" : "Amount"}:</span>
                          <span className="font-semibold text-green-700">{task.completionAmount.toFixed(2)} SAR</span>
                        </div>
                      )}
                      {task.completedAt && (
                        <DetailRow
                          label={isAr ? "تاريخ الإتمام" : "Completed at"}
                          value={new Date(task.completedAt).toLocaleString(isAr ? "ar-SA" : undefined)} />
                      )}
                      {/* Completion photo */}
                      <div className="pt-1.5">
                        <p className="text-xs text-slate-400 mb-1">{t("tasks.completionPhoto")}</p>
                        {task.completionImage ? (
                          <img
                            src={task.completionImage}
                            alt="completion"
                            className="w-24 h-24 object-cover rounded-lg border border-green-200 cursor-zoom-in shadow-sm hover:opacity-90 transition-opacity"
                            onClick={() => setImageViewer(task.completionImage)}
                            title={isAr ? "انقر للتكبير" : "Click to enlarge"}
                          />
                        ) : (
                          <p className="text-xs text-slate-400 italic">{t("tasks.noImage")}</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <DetailRow label={isAr ? "سبب التأجيل" : "Postponement reason"} value={task.postponements?.[0]?.reason} />
                      {task.postponements?.[0]?.newDate && (
                        <DetailRow
                          label={isAr ? "الموعد الجديد" : "New date"}
                          value={new Date(task.postponements[0].newDate).toLocaleDateString(isAr ? "ar-SA" : undefined)} />
                      )}
                      <DetailRow label={isAr ? "ملاحظات الفني" : "Technician notes"} value={task.notes} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
