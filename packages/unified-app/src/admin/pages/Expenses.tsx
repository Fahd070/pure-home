import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import toast from "react-hot-toast";
import { escapeHtml as esc } from "../../utils/htmlEscape";
import { formatGregorianDate, formatGregorianDateTime } from "../../utils/dateTimeInput";
import { Button } from "../../ui/Button";
import { Input, Select, Field } from "../../ui/Field";
import { Badge, Tone } from "../../ui/Badge";
import { PageHeader } from "../../ui/Surface";
import { EmptyState, Loading } from "../../ui/Feedback";
import { TableShell, Table, THead, TH, TBody, TR, TD } from "../../ui/Table";
import { ConfirmDialog } from "../../ui/Modal";
import { Icon } from "../../ui/icons";

const STATUS_TONES: Record<string, Tone> = {
  PENDING:  "pending",
  APPROVED: "success",
  REJECTED: "danger",
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
  <div class="inv-id">${isAr ? "رقم الفاتورة" : "Invoice ID"}: ${esc(expense.id)}</div>
</div>
<div class="section">
  <div class="sec-title">${isAr ? "تفاصيل المصروف" : "Expense Details"}</div>
  <div class="grid">
    <div class="item"><div class="lbl">${isAr ? "الفني" : "Technician"}</div><div class="val">${esc(expense.technician?.name) || "—"}</div></div>
    <div class="item"><div class="lbl">${isAr ? "التاريخ" : "Date"}</div><div class="val" dir="ltr">${formatGregorianDate(expense.date)}</div></div>
    <div class="item"><div class="lbl">${isAr ? "الفئة" : "Category"}</div><div class="val">${esc(isAr ? (catAr[expense.category] || expense.category) : expense.category)}</div></div>
    <div class="item"><div class="lbl">${isAr ? "الحالة" : "Status"}</div><div class="val">${esc(isAr ? (statusAr[expense.status] || expense.status) : (statusEn[expense.status] || expense.status))}</div></div>
    <div class="item"><div class="lbl">${isAr ? "طريقة الدفع" : "Payment Method"}</div><div class="val">—</div></div>
    ${expense.description ? `<div class="item" style="grid-column:1/-1"><div class="lbl">${isAr ? "الوصف" : "Description"}</div><div class="val" style="font-weight:normal">${esc(expense.description)}</div></div>` : ""}
  </div>
</div>
<div class="amount-box">
  <span class="lbl">${isAr ? "المبلغ الإجمالي" : "Total Amount"}</span>
  <span class="val">${expense.amount.toFixed(2)} ${isAr ? "ريال" : "SAR"}</span>
</div>
<div class="ftr">Pure Home System — ${formatGregorianDateTime(new Date(), { utc: false })} &nbsp;|&nbsp; ${isAr ? "تاريخ الإصدار" : "Issued"}: ${formatGregorianDate(new Date(), { utc: false })}</div>
</body></html>`;
}

function buildAllInvoicesPdfHtml(expenses: any[], isAr: boolean) {
  const dir = isAr ? "rtl" : "ltr";
  const statusAr: Record<string, string> = { PENDING: "بانتظار", APPROVED: "موافق عليه", REJECTED: "مرفوض" };
  const statusEn: Record<string, string> = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected" };
  const catAr: Record<string, string> = { fuel: "وقود", tools: "أدوات", materials: "مواد", food: "طعام", transport: "مواصلات", other: "أخرى" };

  const pages = expenses.map((expense, idx) => `
    <div class="page${idx < expenses.length - 1 ? " page-break" : ""}">
      <div class="hdr">
        <div class="brand">Pure Home</div>
        <div class="title">${isAr ? "فاتورة مصروف" : "Expense Invoice"}</div>
        <div class="inv-id">${isAr ? "رقم الفاتورة" : "Invoice ID"}: ${esc(expense.id)}</div>
      </div>
      <div class="section">
        <div class="sec-title">${isAr ? "تفاصيل المصروف" : "Expense Details"}</div>
        <div class="grid">
          <div class="item"><div class="lbl">${isAr ? "الفني" : "Technician"}</div><div class="val">${esc(expense.technician?.name) || "—"}</div></div>
          <div class="item"><div class="lbl">${isAr ? "التاريخ" : "Date"}</div><div class="val" dir="ltr">${formatGregorianDate(expense.date)}</div></div>
          <div class="item"><div class="lbl">${isAr ? "الفئة" : "Category"}</div><div class="val">${esc(isAr ? (catAr[expense.category] || expense.category) : expense.category)}</div></div>
          <div class="item"><div class="lbl">${isAr ? "الحالة" : "Status"}</div><div class="val">${esc(isAr ? (statusAr[expense.status] || expense.status) : (statusEn[expense.status] || expense.status))}</div></div>
          ${expense.description ? `<div class="item" style="grid-column:1/-1"><div class="lbl">${isAr ? "الوصف" : "Description"}</div><div class="val" style="font-weight:normal">${esc(expense.description)}</div></div>` : ""}
        </div>
      </div>
      <div class="amount-box">
        <span class="lbl">${isAr ? "المبلغ الإجمالي" : "Total Amount"}</span>
        <span class="val">${expense.amount.toFixed(2)} ${isAr ? "ريال" : "SAR"}</span>
      </div>
      <div class="ftr">Pure Home System — ${formatGregorianDateTime(new Date(), { utc: false })} &nbsp;|&nbsp; ${isAr ? "تاريخ الإصدار" : "Issued"}: ${formatGregorianDate(new Date(), { utc: false })}</div>
    </div>`).join("");

  return `<!DOCTYPE html><html dir="${dir}" lang="${isAr ? "ar" : "en"}"><head><meta charset="UTF-8">
<style>
body{font-family:Tahoma,Arial,sans-serif;margin:0;font-size:12px;direction:${dir};color:#333}
.page{padding:24px;min-height:200px}
.page-break{page-break-after:always;border-bottom:2px dashed #ccc;margin-bottom:20px;padding-bottom:20px}
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
</style></head><body>${pages}</body></html>`;
}

function buildExpensePdfHtml(expenses: any[], isAr: boolean, period: string) {
  const dir = isAr ? "rtl" : "ltr";
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const byCategory: Record<string, number> = {};
  expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + e.amount; });

  const headers = isAr
    ? ["#", "الفني", "الفئة", "المبلغ (ريال)", "التاريخ", "الوصف", "الحالة"]
    : ["#", "Technician", "Category", "Amount (SAR)", "Date", "Description", "Status"];
  const statusAr: Record<string, string> = { PENDING: "بانتظار", APPROVED: "موافق عليه", REJECTED: "مرفوض" };
  const statusEn: Record<string, string> = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected" };
  const catAr: Record<string, string> = { fuel: "وقود", tools: "أدوات", materials: "مواد", food: "طعام", transport: "مواصلات", other: "أخرى" };

  const rows = expenses.map((e, i) => `
    <tr>
      <td style="text-align:center;color:#888">${i + 1}</td>
      <td>${esc(e.technician?.name) || "—"}</td>
      <td>${esc(isAr ? (catAr[e.category] || e.category) : e.category)}</td>
      <td style="text-align:center;font-weight:600;font-family:monospace">${e.amount.toFixed(2)}</td>
      <td style="white-space:nowrap" dir="ltr">${formatGregorianDate(e.date)}</td>
      <td style="color:#666;font-size:9px">${esc(e.description) || "—"}</td>
      <td><span style="padding:2px 7px;border-radius:10px;font-size:9px;font-weight:bold;background:${e.status==="APPROVED"?"#dcfce7":e.status==="REJECTED"?"#fee2e2":"#fef3c7"};color:${e.status==="APPROVED"?"#166534":e.status==="REJECTED"?"#991b1b":"#92400e"}">${esc(isAr ? (statusAr[e.status] || e.status) : (statusEn[e.status] || e.status))}</span></td>
    </tr>`).join("");

  const catRows = Object.entries(byCategory).map(([cat, amt]) => `
    <tr>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;font-size:10px">${esc(isAr ? (catAr[cat] || cat) : cat)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;font-weight:600;font-family:monospace;font-size:10px;text-align:${dir==="rtl"?"left":"right"}">${amt.toFixed(2)} ${isAr ? "ريال" : "SAR"}</td>
    </tr>`).join("");

  return `<!DOCTYPE html><html dir="${dir}" lang="${isAr ? "ar" : "en"}"><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box}
body{font-family:Tahoma,Arial,sans-serif;margin:20px;font-size:11px;direction:${dir};color:#222;background:#fff}
.border-box{border:2px solid #000080;border-radius:6px;padding:16px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #000080;margin-bottom:14px;padding-bottom:10px}
.brand{font-size:22px;font-weight:bold;color:#000080}
.rtitle{font-size:14px;font-weight:bold;margin:4px 0 2px;color:#000080}
.period-badge{font-size:11px;color:#333;background:#e8eeff;border:1px solid #b0c0ff;border-radius:4px;padding:3px 10px;display:inline-block;margin-top:4px}
.print-date{font-size:10px;color:#888}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:10px}
th{background:#000080;color:#fff;padding:7px 8px;text-align:${dir==="rtl"?"right":"left"};font-size:10px}
td{padding:5px 8px;border-bottom:1px solid #e8e8e8;vertical-align:middle}
tr:nth-child(even) td{background:#f7f8fc}
.summary-row{margin-top:14px;display:flex;gap:14px;align-items:stretch}
.cat-box{flex:1;border:1px solid #dde;border-radius:6px;overflow:hidden}
.cat-title{background:#000080;color:#fff;padding:5px 10px;font-size:10px;font-weight:bold}
.grand-box{min-width:180px;background:linear-gradient(135deg,#000080,#1a1ab0);color:#fff;border-radius:8px;padding:16px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
.grand-lbl{font-size:11px;opacity:0.9;margin-bottom:6px}
.grand-val{font-size:24px;font-weight:bold;font-family:monospace}
.grand-currency{font-size:12px;opacity:0.8}
.grand-count{font-size:10px;opacity:0.75;margin-top:4px}
.ftr{margin-top:14px;border-top:1px solid #eee;padding-top:6px;color:#aaa;font-size:9px;text-align:center}
</style></head><body>
<div class="border-box">
<div class="hdr">
  <div>
    <div class="brand">Pure Home</div>
    <div class="rtitle">${isAr ? "تقرير المصروفات" : "Expenses Report"}</div>
    <div><span class="period-badge">📅 ${period}</span></div>
  </div>
  <div class="print-date">${isAr ? "تاريخ الطباعة" : "Printed"}: ${formatGregorianDate(new Date(), { utc: false })}</div>
</div>
<table>
  <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
  <tbody>${rows || `<tr><td colspan="7" style="text-align:center;color:#bbb;padding:20px">${isAr ? "لا توجد مصروفات في هذه الفترة" : "No expenses in this period"}</td></tr>`}</tbody>
</table>
<div class="summary-row">
  <div class="cat-box">
    <div class="cat-title">${isAr ? "الملخص حسب الفئة" : "Summary by Category"}</div>
    <table style="margin:0"><tbody>${catRows || `<tr><td colspan="2" style="padding:8px;color:#bbb;font-size:10px">${isAr ? "لا بيانات" : "No data"}</td></tr>`}</tbody></table>
  </div>
  <div class="grand-box">
    <div class="grand-lbl">${isAr ? "إجمالي المصروفات" : "Total Expenses"}</div>
    <div class="grand-val">${total.toFixed(2)}</div>
    <div class="grand-currency">${isAr ? "ريال سعودي" : "Saudi Riyal (SAR)"}</div>
    <div class="grand-count">${isAr ? `${expenses.length} مصروف` : `${expenses.length} expense(s)`}</div>
  </div>
</div>
<div class="ftr">Pure Home System &nbsp;|&nbsp; ${isAr ? "نظام بيور هوم" : "Pure Home Management System"} &nbsp;|&nbsp; ${formatGregorianDateTime(new Date(), { utc: false })}</div>
</div>
</body></html>`;
}

export default function AdminExpenses() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ technicianId: "", from: "", to: "", status: "" });
  // Replaces confirm(): the native dialog cannot be themed or translated.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
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

  async function downloadAllInvoices() {
    setGenerating(true);
    try {
      const { data: allData } = await api.get("/expenses", { params: { limit: 5000 } });
      const allExpenses: any[] = allData.data || [];
      if (!allExpenses.length) {
        toast.error(isAr ? "لا توجد مصروفات" : "No expenses found");
        return;
      }
      const html = buildAllInvoicesPdfHtml(allExpenses, isAr);
      const filePath = await (window as any).electron.printToPDF(html, `all-invoices-${Date.now()}.pdf`);
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
      <PageHeader
        title={t("expenses.title")}
        subtitle={
          <span className="tabular-nums">
            {isAr ? `الإجمالي: ${totalAmount.toFixed(2)} ريال` : `Total: ${totalAmount.toFixed(2)} SAR`}
          </span>
        }
        actions={
          <Button variant="secondary" loading={generating} onClick={downloadAllInvoices}>
            <Icon name="download" className="w-3.5 h-3.5" />
            {isAr ? "تنزيل الفواتير" : "Download Invoices"}
          </Button>
        }
      />

      {/* Filters sit in their own strip directly above the table they filter. */}
      <div className="bg-surface border border-line rounded-md p-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label={isAr ? "الفني" : "Technician"} htmlFor="exp-filter-tech">
            <Select
              id="exp-filter-tech"
              value={filters.technicianId}
              onChange={e => setFilters(f => ({ ...f, technicianId: e.target.value }))}
            >
              <option value="">{t("common.all")}</option>
              {(techData || []).map((tech: any) => (
                <option key={tech.id} value={tech.id}>{tech.name}</option>
              ))}
            </Select>
          </Field>

          <Field label={t("reports.dateFrom")} htmlFor="exp-filter-from">
            <Input
              id="exp-filter-from" type="date" lang="en-GB" dir="ltr"
              value={filters.from}
              onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
            />
          </Field>

          <Field label={t("reports.dateTo")} htmlFor="exp-filter-to">
            <Input
              id="exp-filter-to" type="date" lang="en-GB" dir="ltr"
              value={filters.to}
              onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
            />
          </Field>

          <Field label={t("common.status")} htmlFor="exp-filter-status">
            <Select
              id="exp-filter-status"
              value={filters.status}
              onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
            >
              <option value="">{t("common.all")}</option>
              {["PENDING", "APPROVED", "REJECTED"].map(sv => (
                <option key={sv} value={sv}>{STATUS_LABEL[sv]}</option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      {isLoading ? (
        <Loading label={t("common.loading")} />
      ) : !filteredExpenses.length ? (
        <div className="bg-surface border border-line rounded-md">
          <EmptyState icon={<Icon name="expenses" className="w-5 h-5" />} title={t("expenses.noExpenses")} />
        </div>
      ) : (
        <TableShell>
          <Table className="min-w-[1000px]">
            <THead>
              <tr>
                <TH width="3rem" align="end">#</TH>
                <TH>{isAr ? "الفني" : "Technician"}</TH>
                <TH width="8rem">{t("expenses.category")}</TH>
                <TH width="7rem" align="end">{t("expenses.amount")}</TH>
                <TH width="7rem">{t("expenses.date")}</TH>
                <TH>{t("expenses.description")}</TH>
                <TH width="8rem">{t("common.status")}</TH>
                <TH width="16rem">{t("common.actions")}</TH>
              </tr>
            </THead>
            <TBody>
              {filteredExpenses.map((e: any, i: number) => (
                <TR key={e.id}>
                  <TD align="end" className="text-fg-muted text-2xs tabular-nums">{i + 1}</TD>
                  <TD className="font-medium">{e.technician?.name || "—"}</TD>
                  <TD className="text-fg-secondary">{isAr ? (CATEGORY_AR[e.category] || e.category) : e.category}</TD>
                  {/* Money right-aligned and tabular so a column of figures
                      lines up digit-for-digit. */}
                  <TD align="end" className="font-semibold tabular-nums">{e.amount.toFixed(2)}</TD>
                  <TD className="text-fg-secondary text-2xs tabular-nums whitespace-nowrap">
                    <span dir="ltr">{formatGregorianDate(e.date)}</span>
                  </TD>
                  <TD className="text-fg-secondary text-2xs max-w-[240px] truncate" title={e.description || undefined}>
                    {e.description || "—"}
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONES[e.status] ?? "neutral"} dot>
                      {STATUS_LABEL[e.status] || e.status}
                    </Badge>
                  </TD>
                  <TD>
                    <div className="flex gap-1 items-center flex-wrap">
                      {e.status === "PENDING" && (
                        <>
                          <Button size="sm" variant="primary" onClick={() => statusMutation.mutate({ id: e.id, status: "APPROVED" })}>
                            {isAr ? "قبول" : "Approve"}
                          </Button>
                          <Button size="sm" variant="secondary" className="text-danger-fg" onClick={() => statusMutation.mutate({ id: e.id, status: "REJECTED" })}>
                            {isAr ? "رفض" : "Reject"}
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant={e.invoiceGenerated ? "subtle" : "secondary"}
                        onClick={() => generateInvoice(e)}
                      >
                        <Icon name={e.invoiceGenerated ? "check" : "download"} className="w-3.5 h-3.5" />
                        {isAr ? "فاتورة" : "Invoice"}
                      </Button>
                      <Button
                        size="sm" variant="ghost" iconOnly
                        onClick={() => setPendingDelete(e.id)}
                        title={t("common.delete")}
                        aria-label={t("common.delete")}
                        className="hover:text-danger-fg hover:bg-danger-bg"
                      >
                        <Icon name="trash" className="w-4 h-4" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableShell>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete);
          setPendingDelete(null);
        }}
        title={isAr ? "حذف هذا المصروف؟" : "Delete this expense?"}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
