import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useAuthStore } from "../store/authStore";
import toast from "react-hot-toast";
import { dateOnlyToApiDate } from "../../utils/dateTimeInput";

export interface CallReportPresetCustomer {
  id: string;
  name: string;
  phone: string;
}

const EMPTY = { customerId: "", date: "", notes: "", employeeName: "", unregisteredName: "", unregisteredPhone: "" };

// Modification #11: single shared form + save path for creating a call report,
// used by both the standalone Call Reports page and the Dashboard "Call
// Report" shortcut. There is exactly one createMutation (POST /call-reports,
// the existing Modification-era endpoint, unchanged) and one validation rule
// set here -- the Dashboard shortcut is only a different entry point into this
// same component, never a second report system.
export default function CallReportForm({
  presetCustomer, onSaved, onCancel,
}: {
  /** When set (Dashboard shortcut), pre-fills and locks out unregistered-customer mode -- the row's customer is already known. */
  presetCustomer?: CallReportPresetCustomer | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [unregisteredMode, setUnregisteredMode] = useState(false);
  const [form, setForm] = useState({
    ...EMPTY,
    employeeName: user?.name || "",
    customerId: presetCustomer?.id || "",
  });
  const [formSearch, setFormSearch] = useState(presetCustomer ? `${presetCustomer.name} — ${presetCustomer.phone}` : "");

  const { data: customersData } = useQuery({
    queryKey: ["customers-select-sched"],
    queryFn: () => api.get("/customers", { params: { limit: 500 } }).then(r => r.data.data || []),
    enabled: !presetCustomer,
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post("/call-reports", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["call-reports"] });
      toast.success(t("callReports.saved"));
      onSaved();
    },
    onError: () => toast.error(t("common.error")),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hasCustomer = unregisteredMode
      ? (form.unregisteredName.trim().length > 0)
      : !!form.customerId;
    const callDate = dateOnlyToApiDate(form.date);
    if (!hasCustomer || !callDate || !form.employeeName) return;
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

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-medium text-slate-600">{t("callReports.customer")}</label>
          {!presetCustomer && (
            <button type="button" onClick={() => { setUnregisteredMode(v => !v); setForm(f => ({ ...f, customerId: "", unregisteredName: "", unregisteredPhone: "" })); setFormSearch(""); }}
              className={`text-xs px-2 py-1 rounded-lg border transition-colors ${unregisteredMode ? "bg-amber-100 border-amber-300 text-amber-700" : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"}`}>
              {unregisteredMode ? "✕ " : "+"} {t("callReports.unregisteredCustomer")}
            </button>
          )}
        </div>
        {presetCustomer ? (
          <div className="border rounded-lg px-3 py-2 bg-green-50 text-sm">
            <span className="font-medium">{presetCustomer.name}</span> <span className="text-slate-400">{presetCustomer.phone}</span>
          </div>
        ) : unregisteredMode ? (
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
        <label className="block text-xs font-medium text-slate-600 mb-1">{t("common.date")}</label>
        <input type="date" lang="en-GB" dir="ltr" required value={form.date}
          onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
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
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50">{t("common.cancel")}</button>
        <button type="submit" disabled={createMutation.isPending || (!unregisteredMode && !form.customerId) || (unregisteredMode && !form.unregisteredName.trim())}
          className="bg-green-700 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-800 disabled:opacity-50">
          {createMutation.isPending ? "..." : t("common.save")}
        </button>
      </div>
    </form>
  );
}
