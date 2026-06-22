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

function formatCompletionDate(dateStr: string, isAr: boolean): string {
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  let h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? (isAr ? 'م' : 'PM') : (isAr ? 'ص' : 'AM');
  h = h % 12 || 12;
  return `${dd}/${mm}/${yyyy} - ${String(h).padStart(2, '0')}:${min} ${ampm}`;
}

export default function Technicians() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const [modal, setModal] = useState<{ tech: any; type: "completed" | "postponed" } | null>(null);
  const [imageViewer, setImageViewer] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<{ task: any; techName: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["technicians-detail"],
    queryFn: () => api.get("/technicians").then(r => r.data.data),
  });

  if (isLoading) return <p className="text-center py-12">{t("common.loading")}</p>;

  const PAYMENT_LABELS: Record<string, string> = {
    CASH: isAr ? "نقداً" : "Cash",
    BANK_TRANSFER: isAr ? "تحويل بنكي" : "Bank Transfer",
  };

  const APPT_TYPE_LABELS: Record<string, string> = {
    MAINTENANCE: isAr ? "صيانة" : "Maintenance",
    INSTALLATION: isAr ? "تركيب" : "Installation",
  };

  const modalTasks = modal
    ? (modal.type === "completed" ? modal.tech.completedTasksList : modal.tech.postponedTasksList) || []
    : [];

  return (
    <div>
      {imageViewer && (
        <ImageViewer src={imageViewer} onClose={() => setImageViewer(null)} isAr={isAr} />
      )}

      {/* ── Completed Task Detail Modal (z-60, above task list at z-50) ── */}
      {taskDetail && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
          onClick={() => setTaskDetail(null)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="p-5 border-b flex justify-between items-center shrink-0 bg-gradient-to-r from-green-50 to-white rounded-t-xl">
              <div>
                <h3 className="font-bold text-slate-800 text-base">
                  {isAr ? "تفاصيل المهمة المكتملة" : "Completed Task Details"}
                </h3>
                <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full mt-1 font-medium">
                  ✓ {isAr ? "مكتملة" : "Completed"}
                </span>
              </div>
              <button onClick={() => setTaskDetail(null)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 shrink-0">
                ✕
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-5">

              {/* Section 1 — Task Information */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2.5">
                  {isAr ? "معلومات المهمة" : "Task Information"}
                </p>
                <div className="bg-slate-50 rounded-xl p-4 space-y-2.5">
                  <div className="flex gap-2">
                    <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "اسم العميل" : "Customer"}:</span>
                    <span className="font-semibold text-slate-800 text-sm">
                      {taskDetail.task.customer?.name || (isAr ? "زيارة عاجلة" : "Urgent Visit")}
                    </span>
                  </div>
                  {taskDetail.task.customer?.phone && (
                    <div className="flex gap-2">
                      <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "رقم الجوال" : "Phone"}:</span>
                      <span className="text-slate-700 text-xs">{taskDetail.task.customer.phone}</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "نوع الخدمة" : "Service Type"}:</span>
                    <span className="text-slate-700 text-xs">
                      {APPT_TYPE_LABELS[taskDetail.task.type || ''] || "—"}
                    </span>
                  </div>
                  {taskDetail.task.scheduledDate && (
                    <div className="flex gap-2">
                      <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "تاريخ الموعد" : "Appointment Date"}:</span>
                      <span className="text-slate-700 text-xs">
                        {new Date(taskDetail.task.scheduledDate).toLocaleDateString(isAr ? "ar-SA" : undefined)}
                      </span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "اسم الفني" : "Technician"}:</span>
                    <span className="text-slate-700 text-xs">{taskDetail.techName}</span>
                  </div>
                </div>
              </div>

              {/* Section 2 — Completion Information */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2.5">
                  {isAr ? "معلومات الإتمام" : "Completion Information"}
                </p>
                <div className="bg-green-50/70 rounded-xl p-4 space-y-2.5 border border-green-100">
                  <div className="flex gap-2">
                    <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "الحالة" : "Status"}:</span>
                    <span className="text-green-700 font-semibold text-xs">✓ {isAr ? "مكتملة" : "Completed"}</span>
                  </div>
                  {taskDetail.task.completedAt && (
                    <div className="flex gap-2">
                      <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "تاريخ ووقت الإتمام" : "Completed At"}:</span>
                      <span className="text-slate-800 font-medium text-xs tabular-nums">
                        {formatCompletionDate(taskDetail.task.completedAt, isAr)}
                      </span>
                    </div>
                  )}
                  {taskDetail.task.serviceDetails && (
                    <div className="flex gap-2">
                      <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "تفاصيل الخدمة" : "Service Details"}:</span>
                      <span className="text-slate-700 text-xs break-words">{taskDetail.task.serviceDetails}</span>
                    </div>
                  )}
                  {taskDetail.task.workNotes && (
                    <div className="flex gap-2">
                      <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "ملاحظات الإتمام" : "Completion Notes"}:</span>
                      <span className="text-slate-700 text-xs break-words">{taskDetail.task.workNotes}</span>
                    </div>
                  )}
                  {!taskDetail.task.serviceDetails && !taskDetail.task.workNotes && (
                    <p className="text-xs text-slate-400 italic">{isAr ? "لا توجد تفاصيل مُدخلة" : "No details provided"}</p>
                  )}
                </div>
              </div>

              {/* Section 3 — Payment (Admin only — API already strips these for SCHEDULING) */}
              {(taskDetail.task.completionAmount != null || taskDetail.task.completionPaymentMethod) && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2.5">
                    {isAr ? "معلومات الدفع" : "Payment Information"}
                  </p>
                  <div className="bg-blue-50/60 rounded-xl p-4 space-y-2.5 border border-blue-100">
                    {taskDetail.task.completionAmount != null && (
                      <div className="flex gap-2 items-center">
                        <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "المبلغ" : "Amount"}:</span>
                        <span className="font-bold text-green-700 text-base">
                          {taskDetail.task.completionAmount.toFixed(2)} {isAr ? "ريال" : "SAR"}
                        </span>
                      </div>
                    )}
                    {taskDetail.task.completionPaymentMethod && (
                      <div className="flex gap-2">
                        <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "طريقة الدفع" : "Payment Method"}:</span>
                        <span className="text-slate-700 text-xs">
                          {PAYMENT_LABELS[taskDetail.task.completionPaymentMethod] || taskDetail.task.completionPaymentMethod}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Section 4 — Completion Image */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2.5">
                  {isAr ? "صورة الإتمام" : "Completion Image"}
                </p>
                {taskDetail.task.completionImage ? (
                  <div className="relative group inline-block">
                    <img
                      src={taskDetail.task.completionImage}
                      alt={isAr ? "صورة الإتمام" : "Completion photo"}
                      className="w-full max-w-[280px] h-44 object-cover rounded-xl border border-green-200 cursor-zoom-in shadow-sm"
                      onClick={() => setImageViewer(taskDetail.task.completionImage)}
                      title={isAr ? "انقر للتكبير" : "Click to enlarge"}
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-xl transition-colors flex items-center justify-center pointer-events-none">
                      <span className="opacity-0 group-hover:opacity-100 bg-black/60 text-white text-xs px-3 py-1.5 rounded-lg transition-opacity">
                        🔍 {isAr ? "انقر للتكبير" : "Click to enlarge"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-50 rounded-xl p-6 text-center border border-dashed border-slate-200">
                    <p className="text-sm text-slate-400 italic">{t("tasks.noImage")}</p>
                  </div>
                )}
              </div>

            </div>

            {/* Footer */}
            <div className="p-4 border-t shrink-0">
              <button onClick={() => setTaskDetail(null)}
                className="w-full py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 font-medium transition-colors">
                {isAr ? "إغلاق" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Technician cards grid */}
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

      {/* Task list modal */}
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
                {modal.type === "completed" && (
                  <p className="text-xs text-blue-400 mt-0.5">
                    {isAr ? "انقر على أي مهمة لعرض التفاصيل الكاملة" : "Click any task to view full details"}
                  </p>
                )}
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
                  className={`border rounded-lg p-4 transition-all ${
                    modal.type === "completed"
                      ? "border-green-100 bg-green-50/50 cursor-pointer hover:shadow-md hover:border-green-300 hover:bg-green-50"
                      : "border-orange-100 bg-orange-50/50"
                  }`}
                  onClick={modal.type === "completed" ? () => setTaskDetail({ task, techName: modal.tech.name }) : undefined}>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-medium text-sm">
                        {task.customer?.name || (isAr ? "زيارة عاجلة" : "Urgent Visit")}
                      </p>
                      <p className="text-xs text-slate-400">{task.customer?.phone || "—"}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-slate-400">
                        {task.scheduledDate
                          ? new Date(task.scheduledDate).toLocaleDateString(isAr ? "ar-SA" : undefined)
                          : "—"}
                      </span>
                      {modal.type === "completed" && (
                        <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                          {isAr ? "← تفاصيل" : "Details →"}
                        </span>
                      )}
                    </div>
                  </div>
                  {modal.type === "completed" ? (
                    <div className="space-y-1">
                      {task.type && (
                        <div className="flex gap-2 text-xs">
                          <span className="text-slate-400 min-w-[90px] shrink-0">{isAr ? "نوع الخدمة" : "Service type"}:</span>
                          <span className="text-slate-600">{APPT_TYPE_LABELS[task.type] || task.type}</span>
                        </div>
                      )}
                      {task.completedAt && (
                        <div className="flex gap-2 text-xs">
                          <span className="text-slate-400 min-w-[90px] shrink-0">{isAr ? "تاريخ الإتمام" : "Completed"}:</span>
                          <span className="text-green-700 font-medium">{formatCompletionDate(task.completedAt, isAr)}</span>
                        </div>
                      )}
                      {task.completionImage && (
                        <p className="text-xs text-slate-400 pt-0.5">📷 {isAr ? "تم إرفاق صورة" : "Image attached"}</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <DetailRow label={isAr ? "سبب التأجيل" : "Postponement reason"} value={task.postponements?.[0]?.reason} />
                      {task.postponements?.[0]?.newDate && (
                        <DetailRow
                          label={isAr ? "الموعد الجديد" : "New date"}
                          value={new Date(task.postponements[0].newDate).toLocaleDateString(isAr ? "ar-SA" : undefined)} />
                      )}
                      <DetailRow label={isAr ? "ملاحظات الفني" : "Technician notes"} value={task.workNotes} />
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
