import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useAuthStore } from "../store/authStore";
import toast from "react-hot-toast";

const EMPTY = { customerId: "", callDate: "", notes: "", employeeName: "" };

export default function CallReports() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY, employeeName: user?.name || "" });
  const [filterSearch, setFilterSearch] = useState("");
  const [formSearch, setFormSearch] = useState("");

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
      setForm({ ...EMPTY, employeeName: user?.name || "" });
      setFormSearch("");
    },
    onError: () => toast.error(t("common.error")),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customerId || !form.callDate || !form.employeeName) return;
    const callDate = form.callDate.length === 16 ? form.callDate + ":00" : form.callDate;
    createMutation.mutate({
      customerId: form.customerId,
      callDate,
      notes: form.notes || undefined,
      employeeName: form.employeeName,
    });
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
      r.customer?.name?.toLowerCase().includes(q) || r.customer?.phone?.includes(q)
    );
  }, [data, filterSearch]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">{t("callReports.title")}</h1>
        <button onClick={() => setShowForm(v => !v)}
          className="bg-green-700 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-800">
          📞 {t("callReports.newReport")}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold text-slate-700 mb-4">{t("callReports.newReport")}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("callReports.customer")}</label>
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
              <button type="button" onClick={() => { setShowForm(false); setFormSearch(""); }} className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50">{t("common.cancel")}</button>
              <button type="submit" disabled={createMutation.isPending || !form.customerId}
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
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("callReports.customer")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.phone")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("callReports.employeeName")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("callReports.callDate")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("callReports.notes")}</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r: any) => (
                  <tr key={r.id} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{r.customer?.name || "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{r.customer?.phone || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{r.employeeName}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">
                      {new Date(r.callDate).toLocaleString(isAr ? "ar-SA" : undefined)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-[300px] truncate">{r.notes || "—"}</td>
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
