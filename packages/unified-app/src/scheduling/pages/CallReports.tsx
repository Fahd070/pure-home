import React, { useState, useMemo, useEffect } from "react";
import type { AxiosResponse } from "axios";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";
import CallReportForm from "../components/CallReportForm";
import { formatGregorianDate } from "../../utils/dateTimeInput";

type ConfirmType = "single" | "selected" | "all";

export default function CallReports() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const socket = useSocket();
  const [showForm, setShowForm] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ type: ConfirmType; ids?: string[] } | null>(null);

  useEffect(() => {
    if (!socket) return;
    const onNew = () => qc.invalidateQueries({ queryKey: ["call-reports"] });
    const onDeleted = () => { qc.invalidateQueries({ queryKey: ["call-reports"] }); setSelected(new Set()); };
    socket.on("call_report:new", onNew);
    socket.on("call_report:deleted", onDeleted);
    return () => {
      socket.off("call_report:new", onNew);
      socket.off("call_report:deleted", onDeleted);
    };
  }, [socket, qc]);

  const { data: reportsResp, isLoading } = useQuery({
    queryKey: ["call-reports"],
    queryFn: () => api.get("/call-reports", { params: { limit: 200 } }).then(r => r.data),
  });
  const data: any[] = reportsResp?.data || [];
  const reportsTotal: number = reportsResp?.meta?.total ?? data.length;

  const deleteMutation = useMutation({
    mutationFn: ({ type, ids }: { type: ConfirmType; ids?: string[] }): Promise<AxiosResponse> => {
      if (type === "single" || type === "selected") {
        const uniqueIds = Array.from(new Set(ids || []));
        return api.delete("/call-reports/bulk", { data: { confirm: true, ids: uniqueIds, expectedCount: uniqueIds.length } });
      }
      return api.delete("/call-reports/all", { data: { confirm: true, expectedCount: reportsTotal } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["call-reports"] });
      setSelected(new Set());
      setConfirm(null);
      toast.success(t("callReports.deleted"));
    },
    onError: (err: any) => {
      if (err?.response?.status === 409) {
        qc.invalidateQueries({ queryKey: ["call-reports"] });
        setConfirm(null);
        toast.error(t("callReports.countChanged"));
      } else {
        toast.error(t("common.error"));
      }
    },
  });

  const reports: any[] = useMemo(() => {
    const all: any[] = data || [];
    if (!filterSearch.trim()) return all;
    const q = filterSearch.toLowerCase();
    return all.filter((r: any) =>
      r.customer?.name?.toLowerCase().includes(q) || r.customer?.phone?.includes(q) ||
      r.unregisteredName?.toLowerCase().includes(q) || r.unregisteredPhone?.includes(q)
    );
  }, [data, filterSearch]);

  const allIds = reports.map((r: any) => r.id);
  const allSelected = allIds.length > 0 && allIds.every((id: string) => selected.has(id));
  const someSelected = allIds.some((id: string) => selected.has(id));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function openConfirm(type: ConfirmType, ids?: string[]) {
    setConfirm({ type, ids });
  }

  function doDelete() {
    if (!confirm) return;
    const ids = confirm.type === "selected"
      ? Array.from(selected)
      : confirm.ids;
    deleteMutation.mutate({ type: confirm.type, ids });
  }

  const selectedCount = selected.size;

  const confirmMsg = confirm?.type === "all"
    ? t("callReports.confirmDeleteAllCount", { count: reportsTotal })
    : confirm?.type === "selected"
      ? t("callReports.confirmDeleteSelectedCount", { count: selectedCount })
      : t("callReports.deleteConfirm");

  return (
    <div className="space-y-4">
      {/* Confirmation Dialog */}
      {confirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
            <p className="text-sm font-medium text-slate-700 text-center mb-4">{confirmMsg}</p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => setConfirm(null)}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={doDelete}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? "..." : t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-slate-800">{t("callReports.title")}</h1>
        <div className="flex gap-2 flex-wrap">
          {someSelected && (
            <button
              onClick={() => openConfirm("selected")}
              className="bg-red-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-red-700"
            >
              {t("callReports.deleteSelected")} ({selectedCount})
            </button>
          )}
          {reports.length > 0 && (
            <button
              onClick={() => openConfirm("all")}
              className="border border-red-300 text-red-600 text-sm px-3 py-2 rounded-lg hover:bg-red-50"
            >
              {t("callReports.deleteAll")}
            </button>
          )}
          <button onClick={() => setShowForm(v => !v)}
            className="bg-green-700 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-800">
            📞 {t("callReports.newReport")}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="font-semibold text-slate-700">{t("callReports.newReport")}</h2>
            <HelpButton titleAr={HELP["form.callReport"].titleAr} contentAr={HELP["form.callReport"].contentAr} />
          </div>
          <CallReportForm onSaved={() => setShowForm(false)} onCancel={() => setShowForm(false)} />
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="mb-1">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            {isAr ? "بحث عن عميل (اسم أو جوال)" : "Search Customer (name or phone)"}
          </label>
          <input value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
            placeholder={isAr ? "ابحث..." : "Search..."}
            className="w-64 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <p className="text-center py-10 text-slate-400">{t("common.loading")}</p>
        ) : !reports.length ? (
          <p className="text-center py-10 text-slate-400">{t("callReports.noReports")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="w-4 h-4 rounded cursor-pointer accent-green-700" />
                  </th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("callReports.customer")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.phone")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("callReports.employeeName")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("callReports.callDate")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("callReports.notes")}</th>
                  <th className="px-4 py-3 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r: any) => (
                  <tr key={r.id} className={`border-b transition-colors ${selected.has(r.id) ? "bg-green-50" : "hover:bg-slate-50"}`}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)}
                        className="w-4 h-4 rounded cursor-pointer accent-green-700" />
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {r.customer?.name || r.unregisteredName || "—"}
                      {!r.customer && r.unregisteredName && <span className="ms-1 text-xs bg-amber-100 text-amber-700 px-1 rounded">غير مسجل</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{r.customer?.phone || r.unregisteredPhone || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{r.employeeName}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs" dir="ltr">
                      {formatGregorianDate(r.callDate)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-[300px] truncate">{r.notes || "—"}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openConfirm("single", [r.id])}
                        className="text-red-500 hover:text-red-700 text-xs px-2 py-1 rounded hover:bg-red-50 transition-colors"
                        title={t("common.delete")}
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
