import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import toast from "react-hot-toast";

const STATUS_COLORS: Record<string, string> = {
  PENDING:  "bg-yellow-100 text-yellow-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
};

function buildInvoicePdfHtml(expense: any, isAr: boolean) {
  const dir = isAr ? "rtl" : "ltr";
  const statusAr: Record<string, string> = { PENDING: "بانتظار", APPROVED: "موافق عليه", REJECTED: "مرفوض" };
  const statusEn: Record<string, string> = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected" };
  const catAr: Record<string, string> = { fuel: "وقود", tools: "أدوات", materials: "مواد", food: "طعام", transport: "مواصلات", other: "أخرى" };
  return `<!DOCTYPE html><html dir="${dir}" lang="${isAr ? "ar" : "en"}"><head><meta charset="UTF-8">
<style>
body{font-family:Tahoma,Arial,sans-serif;margin:24px;font-size:12px;direction:${dir};color:#333}
.hdr{border-bottom:3px solid #000080;margin-bottom:16px;padding-bottom:10px}
.brand{font-size:20px;font-weight:bold;color:#000080}
.title{font-size:15px;font-weight:bold;margin:6px 0 3px}
.inv-id{color:#666;font-size:10px}
.section{margin-top:14px}
.sec-title{font-weight:bold;color:#000080;border-bottom:1px solid #ddd;padding-bottom:4px;margin-bottom:8px;font-size:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.item .lbl{color:#888;font-size:9px;margin-bottom:2px}
.item .val{font-size:12px;font-weight:600}
.amount-box{margin-top:14px;background:#f0f4ff;border:1px solid #000080;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center}
.amount-box .lbl{color:#000080;font-size:11px;font-weight:bold}
.amount-box .val{font-size:18px;font-weight:bold;color:#000080}
.ftr{margin-top:20px;border-top:1px solid #eee;padding-top:8px;color:#999;font-size:9px;text-align:center}
</style></head><body>
<div class="hdr">
  <div class="brand">Pure Home</div>
  <div class="title">${isAr ? "فاتورة مصروف" : "Expense Invoice"}</div>
  <div class="inv-id">${isAr ? "رقم الفاتورة" : "Invoice ID"}: ${expense.id}</div>
</div>
<div class="section">
  <div class="sec-title">${isAr ? "تفاصيل المصروف" : "Expense Details"}</div>
  <div class="grid">
    <div class="item"><div class="lbl">${isAr ? "الفني" : "Technician"}</div><div class="val">${expense.technician?.name || "—"}</div></div>
    <div class="item"><div class="lbl">${isAr ? "التاريخ" : "Date"}</div><div class="val">${new Date(expense.date).toLocaleDateString(isAr ? "ar-SA" : undefined)}</div></div>
    <div class="item"><div class="lbl">${isAr ? "الفئة" : "Category"}</div><div class="val">${isAr ? (catAr[expense.category] || expense.category) : expense.category}</div></div>
    <div class="item"><div class="lbl">${isAr ? "الحالة" : "Status"}</div><div class="val">${isAr ? (statusAr[expense.status] || expense.status) : (statusEn[expense.status] || expense.status)}</div></div>
    <div class="item"><div class="lbl">${isAr ? "طريقة الدفع" : "Payment Method"}</div><div class="val">—</div></div>
    ${expense.description ? `<div class="item" style="grid-column:1/-1"><div class="lbl">${isAr ? "الوصف" : "Description"}</div><div class="val" style="font-weight:normal">${expense.description}</div></div>` : ""}
  </div>
</div>
<div class="amount-box">
  <span class="lbl">${isAr ? "المبلغ الإجمالي" : "Total Amount"}</span>
  <span class="val">${expense.amount.toFixed(2)} ${isAr ? "ريال" : "SAR"}</span>
</div>
<div class="ftr">Pure Home System — ${new Date().toLocaleString()} &nbsp;|&nbsp; ${isAr ? "تاريخ الإصدار" : "Issued"}: ${new Date().toLocaleDateString(isAr ? "ar-SA" : undefined)}</div>
</body></html>`;
}

function buildExpensePdfHtml(expenses: any[], isAr: boolean, period: string) {
  const dir = isAr ? "rtl" : "ltr";
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const headers = isAr
    ? ["#", "الفني", "الفئة", "المبلغ (ريال)", "التاريخ", "الوصف", "الحالة"]
    : ["#", "Technician", "Category", "Amount (SAR)", "Date", "Description", "Status"];
  const statusAr: Record<string, string> = { PENDING: "بانتظار", APPROVED: "موافق", REJECTED: "مرفوض" };
  const statusEn: Record<string, string> = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected" };
  const rows = expenses.map((e, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${e.technician?.name || "—"}</td>
      <td>${e.category}</td>
      <td>${e.amount.toFixed(2)}</td>
      <td>${new Date(e.date).toLocaleDateString(isAr ? "ar-SA" : undefined)}</td>
      <td>${e.description || "—"}</td>
      <td>${isAr ? (statusAr[e.status] || e.status) : (statusEn[e.status] || e.status)}</td>
    </tr>`).join("");

  return `<!DOCTYPE html><html dir="${dir}" lang="${isAr ? "ar" : "en"}"><head><meta charset="UTF-8">
<style>
body{font-family:Tahoma,Arial,sans-serif;margin:20px;font-size:11px;direction:${dir};color:#333}
.hdr{border-bottom:3px solid #000080;margin-bottom:14px;padding-bottom:10px}
.brand{font-size:20px;font-weight:bold;color:#000080;margin-bottom:4px}
.meta{color:#666;font-size:10px}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:10px}
th{background:#000080;color:#fff;padding:6px 8px;text-align:${dir === "rtl" ? "right" : "left"}}
td{padding:5px 8px;border-bottom:1px solid #eee}
tr:nth-child(even){background:#f9f9f9}
.total{margin-top:10px;font-weight:bold;font-size:12px}
.ftr{margin-top:14px;border-top:1px solid #eee;padding-top:6px;color:#999;font-size:9px;text-align:center}
</style></head><body>
<div class="hdr">
  <div class="brand">Pure Home</div>
  <div style="font-size:14px;font-weight:bold;margin-bottom:3px">${isAr ? "تقرير المصروفات" : "Expenses Report"} — ${period}</div>
  <div class="meta">${isAr ? "تاريخ التقرير" : "Date"}: ${new Date().toLocaleDateString(isAr ? "ar-SA" : undefined)} &nbsp;|&nbsp; ${isAr ? "العدد" : "Count"}: ${expenses.length}</div>
</div>
<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
<div class="total">${isAr ? "الإجمالي" : "Total"}: ${total.toFixed(2)} ${isAr ? "ريال" : "SAR"}</div>
<div class="ftr">Pure Home System — ${new Date().toLocaleString()}</div>
</body></html>`;
}

export default function AdminExpenses() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ technicianId: "", from: "", to: "", status: "" });
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    window.dispatchEvent(new Event("clear-badge-expenses-admin"));
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-expenses", filters],
    queryFn: () => api.get("/expenses", {
      params: {
        technicianId: filters.technicianId || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        limit: 200,
      }
    }).then(r => r.data),
  });

  const { data: techData } = useQuery({
    queryKey: ["technicians-select"],
    queryFn: () => api.get("/technicians").then(r => r.data.data || []),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/expenses/${id}/status`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-expenses"] }); toast.success(t("common.success")); },
    onError: () => toast.error(t("common.error")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/expenses/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-expenses"] }); toast.success(t("common.success")); },
    onError: () => toast.error(t("common.error")),
  });

  const markInvoiceMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/expenses/${id}/mark-invoice`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-expenses"] }),
  });

  async function generateInvoice(expense: any) {
    try {
      const html = buildInvoicePdfHtml(expense, isAr);
      const filePath = await (window as any).electron.printToPDF(html, `invoice-${expense.id.slice(0, 8)}-${Date.now()}.pdf`);
      await markInvoiceMutation.mutateAsync(expense.id);
      toast.success(`${t("reports.savedTo")}: ${filePath}`);
    } catch {
      toast.error(t("common.error"));
    }
  }

  const expenses: any[] = data?.data || [];
  const totalAmount: number = data?.meta?.totalAmount || 0;

  async function exportPdf(period: "weekly" | "monthly") {
    setGenerating(true);
    try {
      const now = new Date();
      let from: Date, to: Date = now;
      if (period === "weekly") {
        from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else {
        from = new Date(now.getFullYear(), now.getMonth(), 1);
      }
      const { data: pdfData } = await api.get("/expenses", {
        params: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), limit: 5000 }
      });
      const periodLabel = period === "weekly"
        ? (isAr ? "أسبوعي" : "Weekly")
        : (isAr ? "شهري" : "Monthly");
      const html = buildExpensePdfHtml(pdfData.data || [], isAr, periodLabel);
      const filePath = await (window as any).electron.printToPDF(html, `expenses-${period}-${Date.now()}.pdf`);
      toast.success(`${t("reports.savedTo")}: ${filePath}`);
    } catch {
      toast.error(t("common.error"));
    } finally { setGenerating(false); }
  }

  const filteredExpenses = filters.status
    ? expenses.filter(e => e.status === filters.status)
    : expenses;

  const STATUS_LABEL: Record<string, string> = {
    PENDING: isAr ? "بانتظار الموافقة" : "Pending",
    APPROVED: isAr ? "موافق عليه" : "Approved",
    REJECTED: isAr ? "مرفوض" : "Rejected",
  };

  const CATEGORY_AR: Record<string, string> = {
    fuel: "وقود", tools: "أدوات", materials: "مواد", food: "طعام", transport: "مواصلات", other: "أخرى"
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{t("expenses.title")}</h1>
          <p className="text-sm text-slate-500">
            {isAr ? `الإجمالي: ${totalAmount.toFixed(2)} ريال` : `Total: ${totalAmount.toFixed(2)} SAR`}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportPdf("weekly")} disabled={generating}
            style={{ backgroundColor: "#000080" }} className="text-white text-sm px-3 py-2 rounded-lg hover:opacity-90 disabled:opacity-50">
            📄 {isAr ? "PDF أسبوعي" : "Weekly PDF"}
          </button>
          <button onClick={() => exportPdf("monthly")} disabled={generating}
            className="bg-indigo-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            📄 {isAr ? "PDF شهري" : "Monthly PDF"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? "الفني" : "Technician"}</label>
            <select value={filters.technicianId} onChange={e => setFilters(f => ({ ...f, technicianId: e.target.value }))}
              className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">{t("common.all")}</option>
              {(techData || []).map((tech: any) => (
                <option key={tech.id} value={tech.id}>{tech.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t("reports.dateFrom")}</label>
            <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
              className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t("reports.dateTo")}</label>
            <input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
              className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t("common.status")}</label>
            <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
              className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">{t("common.all")}</option>
              {["PENDING", "APPROVED", "REJECTED"].map(s => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <p className="text-center py-10 text-slate-400">{t("common.loading")}</p>
        ) : !filteredExpenses.length ? (
          <p className="text-center py-10 text-slate-400">{t("expenses.noExpenses")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">#</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{isAr ? "الفني" : "Technician"}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("expenses.category")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("expenses.amount")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("expenses.date")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("expenses.description")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.status")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.map((e: any, i: number) => (
                  <tr key={e.id} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-400 text-xs">{i + 1}</td>
                    <td className="px-4 py-3 font-medium">{e.technician?.name || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {isAr ? (CATEGORY_AR[e.category] || e.category) : e.category}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{e.amount.toFixed(2)}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">
                      {new Date(e.date).toLocaleDateString(isAr ? "ar-SA" : undefined)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-[200px] truncate">{e.description || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[e.status] || ""}`}>
                        {STATUS_LABEL[e.status] || e.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 items-center flex-wrap">
                        {e.status === "PENDING" && (
                          <>
                            <button onClick={() => statusMutation.mutate({ id: e.id, status: "APPROVED" })}
                              className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700">
                              {isAr ? "قبول" : "Approve"}
                            </button>
                            <button onClick={() => statusMutation.mutate({ id: e.id, status: "REJECTED" })}
                              className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">
                              {isAr ? "رفض" : "Reject"}
                            </button>
                          </>
                        )}
                        <button onClick={() => generateInvoice(e)}
                          className={`text-xs px-2 py-1 rounded border flex items-center gap-1 ${e.invoiceGenerated ? "border-green-300 text-green-700 bg-green-50" : "border-indigo-200 text-indigo-600 hover:bg-indigo-50"}`}>
                          {e.invoiceGenerated ? "✓" : "📄"} {isAr ? "فاتورة" : "Invoice"}
                        </button>
                        <button onClick={() => { if (confirm(isAr ? "حذف هذا المصروف؟" : "Delete this expense?")) deleteMutation.mutate(e.id); }}
                          className="text-xs text-slate-400 hover:text-red-600 px-1">✕</button>
                      </div>
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
