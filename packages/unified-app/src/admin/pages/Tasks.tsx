import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";

const STATUS_COLORS: Record<string, string> = {
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-700", APPROVED: "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-indigo-100 text-indigo-700", COMPLETED: "bg-green-100 text-green-700", POSTPONED: "bg-orange-100 text-orange-700"
};

const PAYMENT_LABELS_AR: Record<string, string> = { CASH: "نقداً", BANK_TRANSFER: "تحويل بنكي" };
const PAYMENT_LABELS_EN: Record<string, string> = { CASH: "Cash", BANK_TRANSFER: "Bank Transfer" };

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-slate-400 min-w-[100px] shrink-0">{label}:</span>
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

export default function Tasks() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const socket = useSocket();
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [techId, setTechId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [imageViewer, setImageViewer] = useState<string | null>(null);

  useEffect(() => {
    window.dispatchEvent(new Event("clear-badge-tasks-admin"));
  }, []);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      window.dispatchEvent(new Event("clear-badge-tasks-admin"));
    };
    socket.on("task:approved", refresh);
    socket.on("task:completed", refresh);
    socket.on("task:postponed", refresh);
    socket.on("appointment:created", refresh);
    return () => {
      socket.off("task:approved", refresh);
      socket.off("task:completed", refresh);
      socket.off("task:postponed", refresh);
      socket.off("appointment:created", refresh);
    };
  }, [socket, qc]);

  const { data } = useQuery({ queryKey: ["tasks"], queryFn: () => api.get("/tasks").then(r => r.data.data) });
  const { data: techs } = useQuery({ queryKey: ["technicians"], queryFn: () => api.get("/technicians").then(r => r.data.data) });

  const [postponeModal, setPostponeModal] = useState<{ task: any } | null>(null);
  const [postponeReason, setPostponeReason] = useState("");
  const [postponeDate, setPostponeDate] = useState("");

  const approve = useMutation({
    mutationFn: ({ id, technicianId }: { id: string; technicianId: string }) => api.patch(`/tasks/${id}/approve`, { technicianId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success(t("common.success")); setSelectedTask(null); setTechId(""); }
  });

  const startTask = useMutation({
    mutationFn: (id: string) => api.patch(`/tasks/${id}/start`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success(t("common.success")); }
  });

  const completeTask = useMutation({
    mutationFn: (id: string) => api.patch(`/tasks/${id}/complete`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success(t("common.success")); }
  });

  const postponeTask = useMutation({
    mutationFn: ({ id, reason, newDate }: { id: string; reason: string; newDate: string }) =>
      api.patch(`/tasks/${id}/postpone`, { reason, newDate }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(t("common.success"));
      setPostponeModal(null);
      setPostponeReason(""); setPostponeDate("");
    }
  });

  const bulkCompleteAll = useMutation({
    mutationFn: () => api.post("/tasks/bulk-complete-existing"),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      const count = res?.data?.data?.count ?? 0;
      toast.success(t("tasks.bulkCompleted", { count }));
      setBulkConfirm(false);
    },
    onError: () => toast.error(t("common.error")),
  });

  const [bulkConfirm, setBulkConfirm] = useState(false);

  const PAYMENT_LABELS = isAr ? PAYMENT_LABELS_AR : PAYMENT_LABELS_EN;

  const statusLabel: Record<string, string> = {
    PENDING_APPROVAL: t("tasks.pendingApproval"), APPROVED: t("tasks.approved"),
    IN_PROGRESS: t("tasks.inProgress"), COMPLETED: t("tasks.completed"), POSTPONED: t("tasks.postponed"),
  };

  const pending = (data || []).filter((tk: any) => tk.status === "PENDING_APPROVAL");
  const others = (data || []).filter((tk: any) => tk.status !== "PENDING_APPROVAL");
  const activeCount = (data || []).filter((tk: any) => tk.status !== "COMPLETED").length;

  return (
    <div className="space-y-4">
      {imageViewer && (
        <ImageViewer src={imageViewer} onClose={() => setImageViewer(null)} isAr={isAr} />
      )}

      {bulkConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
            <p className="text-sm font-medium text-slate-700 text-center mb-4">{t("tasks.completeAllConfirm")}</p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => setBulkConfirm(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50">{t("common.cancel")}</button>
              <button onClick={() => bulkCompleteAll.mutate()} disabled={bulkCompleteAll.isPending}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                {bulkCompleteAll.isPending ? "..." : t("common.yes")}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeCount > 0 && (
        <div className="flex justify-end">
          <button onClick={() => setBulkConfirm(true)}
            className="bg-green-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-700">
            ✓ {t("tasks.completeAll")} ({activeCount})
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <h3 className="font-semibold text-yellow-800 mb-3">{t("tasks.pendingApproval")} ({pending.length})</h3>
          <div className="space-y-2">
            {pending.map((task: any) => (
              <div key={task.id} className="bg-white rounded-lg p-3 flex justify-between items-center">
                <div>
                  <p className="font-medium text-sm">{task.appointment?.customer?.name || (isAr ? "موعد عاجل" : "Urgent Task")}</p>
                  <p className="text-xs text-slate-400">{new Date(task.appointment?.scheduledDate).toLocaleDateString()} — {task.appointment?.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}</p>
                </div>
                <button onClick={() => { setSelectedTask(task); setTechId(techs?.[0]?.id || ""); }}
                  className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-700">
                  {t("tasks.approve")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-start px-4 py-3">{t("appointments.customer")}</th>
                <th className="text-start px-4 py-3">{t("appointments.technician")}</th>
                <th className="text-start px-4 py-3">{t("common.date")}</th>
                <th className="text-start px-4 py-3">{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {others.map((task: any) => {
                const isExpanded = expandedId === task.id;
                const customer = task.appointment?.customer;
                const postponement = task.postponements?.[0];
                return (
                  <React.Fragment key={task.id}>
                    <tr className="border-b hover:bg-slate-50 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : task.id)}>
                      <td className="px-4 py-3 font-medium">
                        {customer?.name || (isAr ? "موعد عاجل" : "Urgent Task")}
                        {task.appointment?.isUrgent && <span className="ml-1 text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">🚨</span>}
                      </td>
                      <td className="px-4 py-3">{task.technician?.name || "—"}</td>
                      <td className="px-4 py-3">{new Date(task.appointment?.scheduledDate).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[task.status] || ""}`}>
                          {statusLabel[task.status] || task.status}
                        </span>
                        <span className="text-xs text-slate-300 ms-2">{isExpanded ? "▲" : "▼"}</span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50 border-b">
                        <td colSpan={4} className="px-6 py-4">
                          <div className="space-y-3">
                            {customer && (
                              <div className="space-y-1">
                                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{isAr ? "معلومات العميل" : "Customer Info"}</p>
                                <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                                  <DetailRow label={isAr ? "الاسم" : "Name"} value={customer.name} />
                                  <DetailRow label={isAr ? "الجوال" : "Phone"} value={customer.phone} />
                                  {customer.address && <>
                                    <DetailRow label={isAr ? "المدينة" : "City"} value={customer.address.city} />
                                    <DetailRow label={isAr ? "الحي" : "District"} value={customer.address.district} />
                                  </>}
                                </div>
                              </div>
                            )}
                            {task.status === "POSTPONED" && postponement && (
                              <div className="space-y-1 border-t pt-3">
                                <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide">{isAr ? "تفاصيل التأجيل" : "Postponement Details"}</p>
                                <DetailRow label={t("tasks.postponementReason")} value={postponement.reason} />
                                {postponement.newDate && <DetailRow label={t("tasks.newDate")} value={new Date(postponement.newDate).toLocaleDateString(isAr ? "ar-SA" : undefined)} />}
                                <DetailRow label={isAr ? "ملاحظات الفني" : "Technician Notes"} value={task.notes} />
                              </div>
                            )}
                            {task.status === "COMPLETED" && (
                              <div className="space-y-1 border-t pt-3">
                                <p className="text-xs font-semibold text-green-600 uppercase tracking-wide">{isAr ? "تفاصيل الإتمام" : "Completion Details"}</p>
                                <DetailRow label={t("tasks.completionNotes")} value={task.notes} />
                                <DetailRow label={t("tasks.serviceDetails")} value={task.serviceDetails} />
                                <DetailRow label={t("tasks.paymentMethod")} value={task.completionPaymentMethod ? (PAYMENT_LABELS[task.completionPaymentMethod] || task.completionPaymentMethod) : null} />
                                {task.completionAmount != null && (
                                  <div className="flex gap-2 text-xs">
                                    <span className="text-slate-400 min-w-[100px]">{t("tasks.amount")}:</span>
                                    <span className="font-semibold text-slate-800">{task.completionAmount.toFixed(2)} SAR</span>
                                  </div>
                                )}
                                {task.completedAt && <DetailRow label={t("tasks.completionDate")} value={new Date(task.completedAt).toLocaleString(isAr ? "ar-SA" : undefined)} />}
                                {/* Completion photo */}
                                <div className="pt-2">
                                  <p className="text-xs font-semibold text-slate-500 mb-1.5">{t("tasks.completionPhoto")}</p>
                                  {task.completionImage ? (
                                    <img
                                      src={task.completionImage}
                                      alt="completion"
                                      className="w-28 h-28 object-cover rounded-lg border border-green-200 cursor-zoom-in shadow-sm hover:opacity-90 transition-opacity"
                                      onClick={() => setImageViewer(task.completionImage)}
                                      title={isAr ? "انقر للتكبير" : "Click to enlarge"}
                                    />
                                  ) : (
                                    <p className="text-xs text-slate-400 italic">{t("tasks.noImage")}</p>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedTask && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-semibold mb-4">{t("tasks.approve")}</h3>
            <p className="text-sm text-slate-600 mb-3">{selectedTask.appointment?.customer?.name || (isAr ? "موعد عاجل" : "Urgent Task")}</p>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">{t("tasks.selectTechnician")}</label>
              <select value={techId} onChange={e => setTechId(e.target.value)} className="w-full border rounded-lg px-3 py-2">
                {(techs || []).map((tk: any) => <option key={tk.id} value={tk.id}>{tk.name}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={() => approve.mutate({ id: selectedTask.id, technicianId: techId })} disabled={!techId || approve.isPending}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                {approve.isPending ? t("common.loading") : t("common.save")}
              </button>
              <button onClick={() => setSelectedTask(null)} className="flex-1 border py-2 rounded-lg text-sm hover:bg-slate-50">{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}

      {postponeModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl space-y-4">
            <h3 className="font-semibold">{t("tasks.confirmPostpone")}</h3>
            <p className="text-sm text-slate-600">{postponeModal.task.appointment?.customer?.name}</p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("tasks.reason")}</label>
              <input value={postponeReason} onChange={e => setPostponeReason(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("tasks.newDate")}</label>
              <input type="date" value={postponeDate} onChange={e => setPostponeDate(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => postponeTask.mutate({ id: postponeModal.task.id, reason: postponeReason, newDate: postponeDate })}
                disabled={!postponeReason || !postponeDate || postponeTask.isPending}
                className="flex-1 bg-orange-500 text-white py-2 rounded-lg text-sm hover:bg-orange-600 disabled:opacity-50">
                {postponeTask.isPending ? t("common.loading") : t("tasks.postpone")}
              </button>
              <button onClick={() => setPostponeModal(null)} className="flex-1 border py-2 rounded-lg text-sm hover:bg-slate-50">{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
