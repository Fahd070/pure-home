import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";

function formatDate(dateStr: string, isAr: boolean) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString(isAr ? "ar-SA" : undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type ConfirmAction = { id: string; action: "approve" | "reject" } | null;

export default function Approvals() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const socket = useSocket();
  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    window.dispatchEvent(new Event("clear-badge-approvals-admin"));
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onNew = () => {
      qc.invalidateQueries({ queryKey: ["customer-approvals"] });
      qc.invalidateQueries({ queryKey: ["customer-approvals-count"] });
    };
    const onResolved = () => {
      qc.invalidateQueries({ queryKey: ["customer-approvals"] });
      qc.invalidateQueries({ queryKey: ["customer-approvals-count"] });
    };
    socket.on("customer_approval:new", onNew);
    socket.on("customer_approval:resolved", onResolved);
    return () => {
      socket.off("customer_approval:new", onNew);
      socket.off("customer_approval:resolved", onResolved);
    };
  }, [socket, qc]);

  const { data, isLoading } = useQuery({
    queryKey: ["customer-approvals"],
    queryFn: () => api.get("/customer-approvals").then(r => r.data.data || []),
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      api.post(`/customer-approvals/${id}/${action}`),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["customer-approvals"] });
      qc.invalidateQueries({ queryKey: ["customer-approvals-count"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success(vars.action === "approve" ? t("approvals.approved") : t("approvals.rejected"));
      setConfirm(null);
    },
    onError: () => toast.error(t("common.error")),
  });

  const requests: any[] = data || [];

  function DetailRow({ label, value }: { label: string; value?: string }) {
    if (!value) return null;
    return (
      <div className="flex gap-2 text-sm">
        <span className="text-slate-500 min-w-[130px] flex-shrink-0">{label}:</span>
        <span className="font-medium text-slate-800">{value}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {confirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
            <p className="text-sm font-medium text-slate-700 text-center mb-4">
              {confirm.action === "approve" ? t("approvals.confirmApprove") : t("approvals.confirmReject")}
            </p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => setConfirm(null)} className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50">
                {t("common.cancel")}
              </button>
              <button
                onClick={() => actionMutation.mutate({ id: confirm.id, action: confirm.action })}
                disabled={actionMutation.isPending}
                className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 ${confirm.action === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}
              >
                {actionMutation.isPending ? "..." : confirm.action === "approve" ? t("approvals.approveBtn") : t("approvals.rejectBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">{t("approvals.title")}</h1>
        <span className="text-sm text-slate-500">
          {requests.length > 0 ? `${requests.length} ${isAr ? "طلب معلق" : "pending request(s)"}` : ""}
        </span>
      </div>

      {isLoading ? (
        <p className="text-center py-12 text-slate-400">{t("common.loading")}</p>
      ) : requests.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <p className="text-4xl mb-3">✅</p>
          <p className="text-slate-500">{t("approvals.noRequests")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req: any) => {
            const d = typeof req.requestData === "string" ? JSON.parse(req.requestData) : req.requestData;
            const isExpanded = expandedId === req.id;
            return (
              <div key={req.id} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-4 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-9 h-9 bg-amber-100 rounded-full flex items-center justify-center text-amber-700 font-bold text-sm flex-shrink-0">
                        {d?.name?.[0] || "?"}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800">{d?.name || "—"}</p>
                        <p className="text-sm text-slate-500">{d?.phone || "—"}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      {d?.address?.city && <span>📍 {d.address.city}{d.address.district ? `، ${d.address.district}` : ""}</span>}
                      <span>👤 {req.creatorName || "—"}</span>
                      <span>🕐 {formatDate(req.createdAt, isAr)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : req.id)}
                      className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50"
                    >
                      {isExpanded ? (isAr ? "إخفاء" : "Hide") : (isAr ? "التفاصيل" : "Details")}
                    </button>
                    <button
                      onClick={() => setConfirm({ id: req.id, action: "reject" })}
                      className="text-xs bg-red-50 text-red-600 hover:bg-red-100 px-3 py-1.5 rounded-lg font-medium border border-red-200"
                    >
                      {t("approvals.rejectBtn")}
                    </button>
                    <button
                      onClick={() => setConfirm({ id: req.id, action: "approve" })}
                      className="text-xs bg-green-600 text-white hover:bg-green-700 px-3 py-1.5 rounded-lg font-medium"
                    >
                      {t("approvals.approveBtn")}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t bg-slate-50 p-4 space-y-2">
                    <DetailRow label={isAr ? "الاسم" : "Name"} value={d?.name} />
                    <DetailRow label={isAr ? "الجوال" : "Phone"} value={d?.phone} />
                    <DetailRow label={isAr ? "المدينة" : "City"} value={d?.address?.city} />
                    <DetailRow label={isAr ? "الحي" : "District"} value={d?.address?.district} />
                    <DetailRow label={isAr ? "الشارع" : "Street"} value={d?.address?.street} />
                    <DetailRow label={isAr ? "دورة الصيانة" : "Maintenance Cycle"} value={d?.maintenanceCycle} />
                    <DetailRow label={t("approvals.installationDate")} value={d?.installationDate ? new Date(d.installationDate).toLocaleDateString(isAr ? "ar-SA" : undefined) : undefined} />
                    <DetailRow label={t("approvals.maintenanceDate")} value={d?.maintenanceDate ? new Date(d.maintenanceDate).toLocaleDateString(isAr ? "ar-SA" : undefined) : undefined} />
                    <DetailRow label={t("approvals.nextMaintenanceDate")} value={d?.nextMaintenanceDate ? new Date(d.nextMaintenanceDate).toLocaleDateString(isAr ? "ar-SA" : undefined) : undefined} />
                    {d?.notes && <DetailRow label={isAr ? "ملاحظات" : "Notes"} value={d.notes} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
