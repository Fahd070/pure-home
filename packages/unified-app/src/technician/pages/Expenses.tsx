import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import toast from "react-hot-toast";

const CATEGORIES = ["fuel","tools","materials","food","transport","other"] as const;
const EMPTY = { amount: "", category: "fuel", description: "", date: new Date().toISOString().slice(0,10), customCategory: "" };

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
};

export default function TechExpenses() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const { data, isLoading } = useQuery({
    queryKey: ["tech-expenses"],
    queryFn: () => api.get("/expenses").then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post("/expenses", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tech-expenses"] });
      toast.success(t("expenses.saved"));
      setShowForm(false);
      setForm({ ...EMPTY });
    },
    onError: () => toast.error(t("common.error")),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0 || !form.date) return;
    if (form.category === "other" && !form.customCategory.trim()) {
      toast.error(isAr ? "يرجى تحديد الفئة عند اختيار 'أخرى'" : "Please specify the category when selecting 'Other'");
      return;
    }
    const finalCategory = form.category === "other" ? form.customCategory.trim() : form.category;
    createMutation.mutate({
      amount,
      category: finalCategory,
      description: form.description || undefined,
      date: form.date,
    });
  }

  const expenses: any[] = data?.data || [];
  const total: number = data?.meta?.totalAmount || 0;

  const CATEGORY_LABEL: Record<string, string> = {
    fuel: isAr ? "وقود" : "Fuel",
    tools: isAr ? "أدوات" : "Tools",
    materials: isAr ? "مواد" : "Materials",
    food: isAr ? "طعام" : "Food",
    transport: isAr ? "مواصلات" : "Transport",
    other: isAr ? "أخرى" : "Other",
  };

  const STATUS_LABEL: Record<string, string> = {
    PENDING: isAr ? "بانتظار الموافقة" : "Pending",
    APPROVED: isAr ? "موافق عليه" : "Approved",
    REJECTED: isAr ? "مرفوض" : "Rejected",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{t("expenses.title")}</h1>
          <p className="text-sm text-slate-500">
            {isAr ? `الإجمالي: ${total.toFixed(2)} ريال` : `Total: ${total.toFixed(2)} SAR`}
          </p>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className="bg-orange-500 text-white text-sm px-4 py-2 rounded-lg hover:bg-orange-600">
          + {t("expenses.newExpense")}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold text-slate-700 mb-4">{t("expenses.newExpense")}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("expenses.amount")}</label>
              <input type="number" step="0.01" min="0.01" required value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("expenses.category")}</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value, customCategory: e.target.value !== "other" ? "" : f.customCategory }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white">
                {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("expenses.date")}</label>
              <input type="date" required value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
            {form.category === "other" && (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-red-600 mb-1">
                  {isAr ? "تحديد الفئة *" : "Specify Category *"}
                </label>
                <input
                  required
                  value={form.customCategory}
                  onChange={e => setForm(f => ({ ...f, customCategory: e.target.value }))}
                  placeholder={isAr ? "اكتب الفئة هنا..." : "Enter category here..."}
                  className="w-full border border-orange-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("expenses.description")}</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
            <div className="col-span-2 flex gap-2 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50">{t("common.cancel")}</button>
              <button type="submit" disabled={createMutation.isPending}
                className="bg-orange-500 text-white text-sm px-4 py-2 rounded-lg hover:bg-orange-600 disabled:opacity-50">
                {createMutation.isPending ? "..." : t("common.save")}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <p className="text-center py-10 text-slate-400">{t("common.loading")}</p>
        ) : !expenses.length ? (
          <p className="text-center py-10 text-slate-400">{t("expenses.noExpenses")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("expenses.category")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("expenses.amount")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("expenses.date")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("expenses.description")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e: any) => (
                  <tr key={e.id} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{CATEGORY_LABEL[e.category] || e.category}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{e.amount.toFixed(2)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {new Date(e.date).toLocaleDateString(isAr ? "ar-SA" : undefined)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-[200px] truncate">{e.description || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[e.status] || ""}`}>
                        {STATUS_LABEL[e.status] || e.status}
                      </span>
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
