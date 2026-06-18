import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useAuthStore } from "../store/authStore";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";

const EMPTY = { customerId: "", callDate: "", notes: "", employeeName: "", unregisteredName: "", unregisteredPhone: "" };

type ConfirmType = "single" | "selected" | "all";

export default function CallReports() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const socket = useSocket();
  const [showForm, setShowForm] = useState(false);
  const [unregisteredMode, setUnregisteredMode] = useState(false);
  const [form, setForm] = useState({ ...EMPTY, employeeName: user?.name || "" });
  const [filterSearch, setFilterSearch] = useState("");
  const [formSearch, setFormSearch] = useState("");
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

  const { data: customersData } = useQuery({
    queryKey: ["customers-select-sched"],
    queryFn: () => api.get("/customers", { params: { limit: 500 } }).then(r => r.data.data || []),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["call-reports"],
    queryFn: () => api.get("/call-reports", { params: { limit: 200 } }).then(r => r.data.data || []),
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post("/call-reports", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["call-reports"] });
      toast.success(t("callReports.saved"));
      setShowForm(false);
      setUnregisteredMode(false);
      setForm({ ...EMPTY, employeeName: user?.name || "" });
      setFormSearch("");
    },
    onError: () => toast.error(t("common.error")),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ type, ids }: { type: ConfirmType; ids?: string[] }) => {
      if (type === "single" || type === "selected") {
        return api.delete("/call-reports/bulk", { data: { ids } });
      }
      return api.delete("/call-reports/all");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["call-reports"] });
      setSelected(new Set());
      setConfirm(null);
      toast.success(t("callReports.deleted"));
    },
    onError: () => toast.error(t("common.error")),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hasCustomer = unregisteredMode
      ? (form.unregisteredName.trim().length > 0)
      : !!form.customerId;
    if (!hasCustomer || !form.callDate || !form.employeeName) return;
    const callDate = form.callDate.length === 16 ? form.callDate + ":00" : form.callDate;
    if (unregisteredMode) {
      createMutation.mutate({
        unregisteredName: form.unregisteredName,
        unregisteredPhone: form.unregisteredPhone || undefined,
        callDate,
        notes: form.notes || undefined,
        employeeName: form.employeeName,
      });
    } else {
      createMutation.mutate({
        customerId: form.customerId,
        callDate,
        notes: form.notes || undefined,
        employeeName: form.employeeName,
      });
    }
  }

  const allCustomers: any[] = customersData || [];

  const filteredFormCustomers = useMemo(() => {
    if (!formSearch.trim()) return allCustomers;
    const q = formSearch.toLowerCase();
    return allCustomers.filter((c: any) => c.name?.toLowerCase().includes(q) || c.phone?.includes(q));
  }, [allCustomers, formSearch]);

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
    ? t("callReports.confirmDeleteAll")
    : confirm?.type === "selected"
      ? t("callReports.confirmDeleteSelected")
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
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-medium text-slate-600">{t("callReports.customer")}</label>
                <button type="button" onClick={() => { setUnregisteredMode(v => !v); setForm(f => ({ ...f, customerId: "", unregisteredName: "", unregisteredPhone: "" })); setFormSearch(""); }}
                  className={`text-xs px-2 py-1 rounded-lg border transition-colors ${unregisteredMode ? "bg-amber-100 border-amber-300 text-amber-700" : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"}`}>
                  {unregisteredMode ? "✕ " : "+"} {t("callReports.unregisteredCustomer")}
                </button>
              </div>
              {unregisteredMode ? (
                <div className="space-y-2">
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800">{t("callReports.unregisteredGuidance")}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={form.unregisteredName} onChange={e => setForm(f => ({ ...f, unregisteredName: e.target.value }))}
                      placeholder={t("callReports.unregisteredName")}
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    <input value={form.unregisteredPhone} onChange={e => setForm(f => ({ ...f, unregisteredPhone: e.target.value }))}
                      placeholder={t("callReports.unregisteredPhone")}
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </div>
                </div>
              ) : (
                <>
                  <input value={formSearch} onChange={e => { setFormSearch(e.target.value); setForm(f => ({ ...f, customerId: "" })); }}
                    placeholder={isAr ? "ابحث بالاسم أو الجوال..." : "Search by name or phone..."}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 mb-1" />
                  {formSearch && !form.customerId && (
                    <div className="border rounded-lg max-h-40 overflow-y-auto bg-white shadow-sm z-10">
                      {filteredFormCustomers.length === 0 ? (
                        <p className="text-xs text-slate-400 px-3 py-2">{t("common.noRecords")}</p>
                      ) : filteredFormCustomers.slice(0, 8).map((c: any) => (
                        <button key={c.id} type="button"
                          onClick={() => { setForm(f => ({ ...f, customerId: c.id })); setFormSearch(`${c.name} — ${c.phone}`); }}
                          className="w-full text-start px-3 py-2 text-sm hover:bg-green-50 border-b last:border-b-0">
                          <span className="font-medium">{c.name}</span> <span className="text-slate-400">{c.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {form.customerId && <p className="text-xs text-green-600">✓ {isAr ? "تم اختيار العميل" : "Customer selected"}</p>}
                </>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("callReports.callDate")}</label>
              <input type="datetime-local" required value={form.callDate}
                onChange={e => setForm(f => ({ ...f, callDate: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("callReports.employeeName")}</label>
              <input value={form.employeeName} onChange={e => setForm(f => ({ ...f, employeeName: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("callReports.notes")}</label>
              <textarea rows={4} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
            </div>
            <div className="col-span-2 flex gap-2 justify-end">
              <button type="button" onClick={() => { setShowForm(false); setUnregisteredMode(false); setFormSearch(""); }} className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50">{t("common.cancel")}</button>
              <button type="submit" disabled={createMutation.isPending || (!unregisteredMode && !form.customerId) || (unregisteredMode && !form.unregisteredName.trim())}
                className="bg-green-700 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-800 disabled:opacity-50">
                {createMutation.isPending ? "..." : t("common.save")}
              </button>
            </div>
          </form>
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
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">
                      {new Date(r.callDate).toLocaleString(isAr ? "ar-SA" : undefined)}
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
