import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import toast from "react-hot-toast";
import { escapeHtml as esc } from "../../utils/htmlEscape";
import { formatGregorianDate, formatGregorianDateTime, formatGregorianMonthYear, localDateOnlyStr } from "../../utils/dateTimeInput";
import { fetchAllPages } from "../../utils/fetchAllPages";
import { CheckGroup, toggleIn } from "../../ui/CheckGroup";
import {
  APPOINTMENT_REPORT_STATUSES, CUSTOMER_REPORT_STATUSES,
  appointmentStatusLabel, appointmentStatusLabels, customerStatusLabels, statusParam,
  type AppointmentReportStatus, type CustomerReportStatus,
} from "../../utils/reportStatus";
import { Button } from "../../ui/Button";
import { Input, Select, Field, Label } from "../../ui/Field";
import { Badge, Tone } from "../../ui/Badge";
import { PageHeader } from "../../ui/Surface";
import { EmptyState, Loading } from "../../ui/Feedback";
import { TableShell, Table, THead, TH, TBody, TR, TD } from "../../ui/Table";
import { Icon, IconName } from "../../ui/icons";
import { cx } from "../../ui/cx";

function formatCycle(cycle: string, freq: number, t: any) {
  const n = Number(freq) || 1;
  if (cycle === "DAILY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.day") : t("customers.days")}`;
  if (cycle === "WEEKLY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.week") : t("customers.weeks")}`;
  if (cycle === "MONTHLY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.month") : t("customers.months")}`;
  return cycle;
}

function AlertBadge({ c, isAr }: { c: any; isAr: boolean }) {
  if (c.alertLevel === "overdue") {
    return <Badge tone="danger" dot>{isAr ? `متأخر ${c.overdueCount} يوم` : `Overdue ${c.overdueCount}d`}</Badge>;
  }
  if (c.alertLevel === "soon") {
    const label = c.daysUntil === 0
      ? (isAr ? "اليوم" : "Today")
      : c.daysUntil === 1
        ? (isAr ? "غداً" : "Tomorrow")
        : (isAr ? `${c.daysUntil} يوم` : `${c.daysUntil}d`);
    return <Badge tone="warning" dot>{label}</Badge>;
  }
  if (c.daysUntil !== null) {
    return <Badge tone="success" dot>{isAr ? `${c.daysUntil} يوم` : `${c.daysUntil}d`}</Badge>;
  }
  return <span className="text-2xs text-fg-muted">—</span>;
}

function buildPdfHtml(customers: any[], filters: any, isAr: boolean, t: any, total: number) {
  const dir = isAr ? "rtl" : "ltr";
  const filterSummary = [
    filters.dateFrom ? (isAr ? `من ${filters.dateFrom}` : `From ${filters.dateFrom}`) : "",
    filters.dateTo   ? (isAr ? `إلى ${filters.dateTo}` : `To ${filters.dateTo}`) : "",
    // Every selected status is named, through the same translation map the
    // filter control and the Excel export use -- so the PDF's header line can
    // never claim a narrower filter than the one that produced its rows.
    filters.statuses.length ? filters.statuses.map((sv: CustomerReportStatus) => customerStatusLabels(t)[sv]).join(isAr ? "، " : ", ") : "",
    filters.search   ? (isAr ? `بحث: ${filters.search}` : `Search: ${filters.search}`) : "",
  ].filter(Boolean).join(" | ") || (isAr ? "جميع العملاء" : "All Customers");

  const headers = isAr
    ? ["#", "الاسم", "الجوال", "المدينة", "تاريخ التسجيل", "تاريخ التركيب", "دورة الصيانة", "آخر صيانة", "الصيانة القادمة", "صيانة قادمة", "حالة الصيانة", "المبلغ الإجمالي (ريال)"]
    : ["#", "Name", "Phone", "City", "Reg. Date", "Install Date", "Cycle", "Last Maint.", "Next Maint.", "Upcoming", "Maint. Status", "Total Amount (SAR)"];

  function statusText(c: any) {
    const ms = c.maintenanceStatus;
    const map: Record<string, string> = {
      COMPLETED: isAr ? "مكتملة" : "Completed",
      OVERDUE: isAr ? "متأخرة" : "Overdue",
      SCHEDULED: isAr ? "مجدولة" : "Scheduled",
      IN_PROGRESS: isAr ? "جارية" : "In Progress",
      POSTPONED: isAr ? "مؤجلة" : "Postponed",
      CANCELLED: isAr ? "ملغية" : "Cancelled",
      NO_APPOINTMENTS: isAr ? "لا مواعيد" : "No Appts",
    };
    return map[ms] || ms || "—";
  }

  const rows = customers.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(c.name)}</td>
      <td>${esc(c.phone)}</td>
      <td>${esc(c.address?.city) || "—"}</td>
      <td dir="ltr">${formatGregorianDate(c.createdAt)}</td>
      <td dir="ltr">${c.installationDate ? formatGregorianDate(c.installationDate) : "—"}</td>
      <td>${formatCycle(c.maintenanceCycle, c.maintenanceFrequency, t)}</td>
      <td dir="ltr">${c.lastMaintenance ? formatGregorianDate(c.lastMaintenance) : "—"}</td>
      <td dir="ltr">${(c.nextMaintenanceDate || c.nextMaintenance) ? formatGregorianDate(c.nextMaintenanceDate || c.nextMaintenance) : "—"}</td>
      <td><span class="badge badge-${c.alertLevel || "ok"}">${
    c.alertLevel === "overdue"
      ? (isAr ? `متأخر ${c.overdueCount} يوم` : `Overdue ${c.overdueCount}d`)
      : c.daysUntil !== null
        ? (isAr ? `متبقي ${c.daysUntil} يوم` : `In ${c.daysUntil}d`)
        : "—"
  }</span></td>
      <td>${statusText(c)}</td>
      <td style="text-align:center;font-weight:600;font-family:monospace">${c.totalAmount != null && c.totalAmount > 0 ? Number(c.totalAmount).toFixed(2) : "—"}</td>
    </tr>`).join("");

  const grandTotal = customers.reduce((s: number, c: any) => s + (Number(c.totalAmount) || 0), 0);
  return `<!DOCTYPE html><html dir="${dir}" lang="${isAr ? "ar" : "en"}"><head><meta charset="UTF-8">
<style>
body{font-family:Tahoma,Arial,sans-serif;margin:20px;font-size:11px;direction:${dir};color:#333}
.hdr{border-bottom:3px solid #000080;margin-bottom:14px;padding-bottom:10px}
.brand{font-size:20px;font-weight:bold;color:#000080;margin-bottom:4px}
.rtitle{font-size:14px;font-weight:bold;margin-bottom:3px}
.meta{color:#666;font-size:10px}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:10px}
th{background:#000080;color:#fff;padding:6px 8px;text-align:${dir === "rtl" ? "right" : "left"}}
td{padding:5px 8px;border-bottom:1px solid #eee}
tr:nth-child(even){background:#f9f9f9}
.badge{padding:2px 6px;border-radius:10px;font-size:9px;font-weight:bold}
.badge-ok{background:#dcfce7;color:#166534}
.badge-soon{background:#fef3c7;color:#92400e}
.badge-overdue{background:#fee2e2;color:#991b1b}
.grand-total{margin-top:16px;background:linear-gradient(135deg,#000080,#1a1ab0);color:#fff;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:bold}
.ftr{margin-top:14px;border-top:1px solid #eee;padding-top:6px;color:#999;font-size:9px;text-align:center}
</style></head><body>
<div class="hdr">
  <div class="brand">Pure Home</div>
  <div class="rtitle">${isAr ? "تقرير العملاء" : "Customer Report"}</div>
  <div class="meta">${isAr ? "تاريخ التقرير" : "Date"}: ${formatGregorianDate(new Date(), { utc: false })} &nbsp;|&nbsp; ${isAr ? "الفلاتر" : "Filters"}: ${esc(filterSummary)} &nbsp;|&nbsp; ${isAr ? "الإجمالي" : "Total"}: ${total}</div>
</div>
<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
<div class="grand-total"><span>${isAr ? "إجمالي المبالغ" : "Total Amount"}</span><span>${grandTotal.toFixed(2)} ${isAr ? "ريال" : "SAR"}</span></div>
<div class="ftr">Pure Home System — ${formatGregorianDateTime(new Date(), { utc: false })}</div>
</body></html>`;
}

function buildCustomerPdfHtml(c: any, isAr: boolean, t: any) {
  const dir = isAr ? "rtl" : "ltr";
  return `<!DOCTYPE html><html dir="${dir}" lang="${isAr ? "ar" : "en"}"><head><meta charset="UTF-8">
<style>
body{font-family:Tahoma,Arial,sans-serif;margin:24px;font-size:12px;direction:${dir};color:#333}
.hdr{border-bottom:3px solid #000080;margin-bottom:14px;padding-bottom:10px}
.brand{font-size:18px;font-weight:bold;color:#000080}
.cname{font-size:16px;font-weight:bold;margin:8px 0 4px}
.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:bold}
.badge-ok{background:#dcfce7;color:#166534}.badge-soon{background:#fef3c7;color:#92400e}.badge-overdue{background:#fee2e2;color:#991b1b}
.section{margin-top:14px}.sec-title{font-weight:bold;color:#000080;border-bottom:1px solid #ddd;padding-bottom:4px;margin-bottom:8px;font-size:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.item .lbl{color:#888;font-size:9px;margin-bottom:2px}.item .val{font-size:11px;font-weight:500}
.ftr{margin-top:20px;border-top:1px solid #eee;padding-top:8px;color:#999;font-size:9px;text-align:center}
</style></head><body>
<div class="hdr">
  <div class="brand">Pure Home</div>
  <div style="color:#666;font-size:10px">${formatGregorianDate(new Date(), { utc: false })}</div>
</div>
<div class="cname">${esc(c.name)}</div>
<span class="badge badge-${c.alertLevel || "ok"}">${c.alertLevel === "overdue" ? (isAr ? "متأخر" : "Overdue") : c.alertLevel === "soon" ? (isAr ? "قادم قريباً" : "Upcoming Soon") : (isAr ? "طبيعي" : "OK")}</span>
<div class="section">
  <div class="sec-title">${isAr ? "معلومات التواصل" : "Contact Info"}</div>
  <div class="grid">
    <div class="item"><div class="lbl">${isAr ? "الجوال" : "Phone"}</div><div class="val">${esc(c.phone)}</div></div>
    <div class="item"><div class="lbl">${isAr ? "المدينة" : "City"}</div><div class="val">${esc(c.address?.city) || "—"}</div></div>
    <div class="item"><div class="lbl">${isAr ? "الحي" : "District"}</div><div class="val">${esc(c.address?.district) || "—"}</div></div>
    <div class="item"><div class="lbl">${isAr ? "الشارع" : "Street"}</div><div class="val">${esc(c.address?.street) || "—"}</div></div>
  </div>
</div>
<div class="section">
  <div class="sec-title">${isAr ? "معلومات الصيانة" : "Maintenance Info"}</div>
  <div class="grid">
    <div class="item"><div class="lbl">${isAr ? "تاريخ التسجيل" : "Registered"}</div><div class="val" dir="ltr">${formatGregorianDate(c.createdAt)}</div></div>
    <div class="item"><div class="lbl">${isAr ? "دورة الصيانة" : "Cycle"}</div><div class="val">${formatCycle(c.maintenanceCycle, c.maintenanceFrequency, t)}</div></div>
    <div class="item"><div class="lbl">${isAr ? "آخر صيانة" : "Last Maintenance"}</div><div class="val" dir="ltr">${c.lastMaintenance ? formatGregorianDate(c.lastMaintenance) : "—"}</div></div>
    <div class="item"><div class="lbl">${isAr ? "الصيانة القادمة" : "Next Maintenance"}</div><div class="val" dir="ltr">${c.nextMaintenance ? formatGregorianDate(c.nextMaintenance) : "—"}</div></div>
  </div>
</div>
${c.notes ? `<div class="section"><div class="sec-title">${isAr ? "ملاحظات" : "Notes"}</div><p style="font-size:11px;margin:0">${esc(c.notes)}</p></div>` : ""}
<div class="ftr">Pure Home System — ${formatGregorianDateTime(new Date(), { utc: false })}</div>
</body></html>`;
}

// v4 Requirement #10A: the browser-side cooldown that used to live here is gone.
//
// It stored a timestamp in localStorage after each download and refused to
// generate the report again for a week (or a month), which meant an
// administrator who needed a second copy -- or who had just closed the file by
// mistake -- was locked out of their own data by their own browser, while anyone
// on a different machine or a cleared profile was not locked out at all. It
// protected nothing: the underlying endpoint is a plain read.
//
// It was also wired up wrong. The countdown was keyed on `period` while the
// tiles were keyed on `${period}-${format}`, so downloading the weekly PDF
// silently locked the weekly EXCEL as well -- two different reports sharing one
// lock. Both the restriction and the defect are removed together rather than the
// defect being fixed inside a mechanism that should not exist.
//
// GET /reports/sales is verified to carry no server-side throttle of its own, so
// nothing real is being bypassed here. It is ADMIN-only and read-only, and the
// app's generic rate limiter still applies.

function prevWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const daysToLastMon = day === 0 ? 7 : day + 6;
  const lastMon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToLastMon);
  const lastSun = new Date(lastMon.getFullYear(), lastMon.getMonth(), lastMon.getDate() + 6);
  return { from: lastMon, to: lastSun };
}
function prevMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from, to };
}

function buildSalesPdfHtml(rows: any[], isAr: boolean, periodLabel: string, totalAmount: number) {
  const dir = isAr ? "rtl" : "ltr";
  const payLabels: Record<string, string> = { CASH: isAr ? "نقداً" : "Cash", BANK_TRANSFER_COMMERCIAL: isAr ? "تحويل بنكي (تجاري)" : "Bank Transfer (Commercial)", BANK_TRANSFER_PERSONAL: isAr ? "تحويل بنكي (خاص)" : "Bank Transfer (Personal)" };
  const typeLabels: Record<string, string> = { INSTALLATION: isAr ? "تركيب" : "Installation", MAINTENANCE: isAr ? "صيانة" : "Maintenance", VISIT_ONLY: isAr ? "زيارة فقط" : "Visit Only" };
  const headers = isAr
    ? ["#", "اسم العميل", "الجوال", "نوع الخدمة", "التاريخ", "الفني", "طريقة الدفع", "المبلغ (ريال)"]
    : ["#", "Customer", "Phone", "Service Type", "Date", "Technician", "Payment", "Amount (SAR)"];
  const tableRows = rows.map((r, i) => `<tr>
    <td style="text-align:center;color:#888">${i + 1}</td>
    <td>${esc(r.customerName)}</td>
    <td>${esc(r.customerPhone)}</td>
    <td>${esc(typeLabels[r.appointmentType] || r.appointmentType)}</td>
    <td style="white-space:nowrap" dir="ltr">${formatGregorianDate(r.date)}</td>
    <td>${esc(r.technicianName)}</td>
    <td>${esc(payLabels[r.paymentMethod] || r.paymentMethod || "—")}</td>
    <td style="text-align:center;font-weight:600;font-family:monospace">${Number(r.amount).toFixed(2)}</td>
  </tr>`).join("");
  return `<!DOCTYPE html><html dir="${dir}" lang="${isAr ? "ar" : "en"}"><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box}
body{font-family:Tahoma,Arial,sans-serif;margin:20px;font-size:11px;direction:${dir};color:#222}
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
.grand-box{margin-top:16px;background:linear-gradient(135deg,#000080,#1a1ab0);color:#fff;border-radius:8px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center}
.grand-lbl{font-size:13px;font-weight:bold}
.grand-val{font-size:22px;font-weight:bold;font-family:monospace}
.ftr{margin-top:14px;border-top:1px solid #eee;padding-top:6px;color:#aaa;font-size:9px;text-align:center}
</style></head><body>
<div class="border-box">
<div class="hdr">
  <div>
    <div class="brand">Pure Home</div>
    <div class="rtitle">${isAr ? "تقرير المبيعات" : "Sales Report"}</div>
    <div><span class="period-badge">📅 ${periodLabel}</span></div>
  </div>
  <div class="print-date">${isAr ? "تاريخ الطباعة" : "Printed"}: ${formatGregorianDate(new Date(), { utc: false })}</div>
</div>
<table>
  <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
  <tbody>${tableRows || `<tr><td colspan="8" style="text-align:center;color:#bbb;padding:20px">${isAr ? "لا توجد بيانات في هذه الفترة" : "No data for this period"}</td></tr>`}</tbody>
</table>
<div class="grand-box">
  <span class="grand-lbl">${isAr ? "إجمالي المبيعات" : "Total Sales"} &nbsp;·&nbsp; ${rows.length} ${isAr ? "سجل" : "records"}</span>
  <span class="grand-val">${totalAmount.toFixed(2)} <span style="font-size:13px;opacity:0.85">${isAr ? "ريال" : "SAR"}</span></span>
</div>
<div class="ftr">Pure Home System — ${formatGregorianDateTime(new Date(), { utc: false })}</div>
</div>
</body></html>`;
}

export default function Reports() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const [tab, setTab] = useState<null | "customers" | "appointments" | "sales">(null);
  // v4 Requirement #10C: several outcomes at once (the approved example is
  // Completed + Postponed). An empty array keeps the previous "All Statuses"
  // meaning rather than meaning "match nothing".
  const [filters, setFilters] = useState<{ dateFrom: string; dateTo: string; statuses: CustomerReportStatus[]; search: string }>(
    { dateFrom: "", dateTo: "", statuses: [], search: "" }
  );
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [generating, setGenerating] = useState<"pdf" | "excel" | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [apptFilters, setApptFilters] = useState<{ dateFrom: string; dateTo: string; statuses: AppointmentReportStatus[] }>(
    { dateFrom: "", dateTo: "", statuses: [] }
  );
  const [hasSearchedAppts, setHasSearchedAppts] = useState(false);
  const [generatingAppts, setGeneratingAppts] = useState<"pdf" | "excel" | null>(null);
  const [generatingSales, setGeneratingSales] = useState<string | null>(null);

  useEffect(() => {
    window.dispatchEvent(new Event("clear-badge-reports-admin"));
  }, []);

  useEffect(() => {
    const tm = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(tm);
  }, [filters.search]);

  // Every matching customer, not the first page.
  //
  // This previously asked for limit=200 and then printed `meta.total` as the
  // report's headline figure -- so a filter matching 900 customers produced a PDF
  // headed "Total: 900" containing 200 rows, with a money total covering only
  // those 200. Multi-status selection makes broad result sets considerably more
  // likely, so the same fetchAllPages treatment the appointments report and the
  // Customers-page export already use is applied here: the count in the header
  // and the rows under it now come from the same set.
  const { data: reportCustomers, isLoading } = useQuery({
    queryKey: ["reports-customers", filters.dateFrom, filters.dateTo, filters.statuses.join(","), debouncedSearch],
    queryFn: () => fetchAllPages(api, "/reports/customers", {
      search: debouncedSearch || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      status: statusParam(filters.statuses),
    }),
    enabled: hasSearched,
  });

  const customers: any[] = reportCustomers || [];
  const total = customers.length;

  // Perf fix: GET /appointments is now paginated (default 20/page, max 100).
  // This export/report flow must reflect every matching appointment, not just
  // page 1, so it fetches every page explicitly (fetchAllPages) instead of
  // silently exporting a truncated result.
  const { data: apptData, isLoading: apptLoading } = useQuery({
    queryKey: ["reports-appointments", apptFilters],
    // reportStatus (not `status`) is the operational state a row actually
    // displays as, which spans Appointment.status and Appointment.workStatus --
    // see services/reportStatus.service.ts. It accepts several at once, and the
    // SAME parameter drives the table, the PDF and the Excel export because all
    // three read this one query result.
    queryFn: () => fetchAllPages(api, "/appointments", {
      from: apptFilters.dateFrom || undefined,
      to: apptFilters.dateTo || undefined,
      reportStatus: statusParam(apptFilters.statuses),
    }),
    enabled: hasSearchedAppts,
  });
  const allAppts: any[] = apptData || [];
  const regularAppts = allAppts.filter((a: any) => !a.isUrgent && a.customer != null);
  const urgentAppts  = allAppts.filter((a: any) => a.isUrgent);

  function apptSourceLabel(role: string) {
    if (role === "ADMIN") return isAr ? "قسم الإدارة" : "Administration";
    if (role === "SCHEDULING") return isAr ? "قسم المواعيد والصيانة" : "Scheduling & Maintenance";
    return role || "—";
  }

  function apptAmount(a: any): number | null {
    if (a.task?.completionAmount != null) return Number(a.task.completionAmount);
    if (a.urgentVisitRecord?.amount != null) return Number(a.urgentVisitRecord.amount);
    return null;
  }

  async function exportApptPdf() {
    if (!allAppts.length) return;
    setGeneratingAppts("pdf");
    try {
      const dir = isAr ? "rtl" : "ltr";
      function apptRows(list: any[]) {
        return list.map((a: any, i: number) => {
          const amt = apptAmount(a);
          return `<tr>
          <td>${i + 1}</td>
          <td>${esc(a.customer?.name) || (isAr ? "زيارة عاجلة" : "Urgent Visit")}</td>
          <td>${esc(a.customer?.phone) || "—"}</td>
          <td dir="ltr">${formatGregorianDate(a.scheduledDate)}</td>
          <td>${a.type === "INSTALLATION" ? (isAr ? "تركيب" : "Installation") : (isAr ? "صيانة" : "Maintenance")}</td>
          <td>${esc(appointmentStatusLabel(a, t))}</td>
          <td>${esc(apptSourceLabel(a.createdByRole))}</td>
          <td style="text-align:center;font-weight:600;font-family:monospace">${amt != null ? amt.toFixed(2) : "—"}</td>
        </tr>`;
        }).join("");
      }
      function apptTotal(list: any[]) {
        return list.reduce((s: number, a: any) => s + (apptAmount(a) ?? 0), 0);
      }
      const headers = isAr
        ? ["#","العميل","الجوال","التاريخ","النوع","الحالة","المصدر","المبلغ (ريال)"]
        : ["#","Customer","Phone","Date","Type","Status","Source","Amount (SAR)"];
      const headHtml = headers.map(h => `<th>${h}</th>`).join("");
      const totalRegular = apptTotal(regularAppts);
      const totalUrgent = apptTotal(urgentAppts);
      const grandTotal = totalRegular + totalUrgent;
      const html = `<!DOCTYPE html><html dir="${dir}" lang="${isAr ? "ar" : "en"}"><head><meta charset="UTF-8">
<style>
body{font-family:Tahoma,Arial,sans-serif;margin:20px;font-size:11px;direction:${dir};color:#333}
.hdr{border-bottom:3px solid #000080;margin-bottom:14px;padding-bottom:10px}
.brand{font-size:20px;font-weight:bold;color:#000080;margin-bottom:4px}
h2{color:#000080;font-size:13px;margin:14px 0 6px}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:10px}
th{background:#000080;color:#fff;padding:6px 8px;text-align:${dir === "rtl" ? "right" : "left"}}
td{padding:5px 8px;border-bottom:1px solid #eee}
tr:nth-child(even){background:#f9f9f9}
.total-row{background:#e8eeff;font-weight:bold;font-size:11px}
.grand-total{margin-top:16px;background:linear-gradient(135deg,#000080,#1a1ab0);color:#fff;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:bold}
.ftr{margin-top:14px;border-top:1px solid #eee;padding-top:6px;color:#999;font-size:9px;text-align:center}
</style></head><body>
<div class="hdr">
  <div class="brand">Pure Home</div>
  <div style="font-size:14px;font-weight:bold">${isAr ? "تقرير المواعيد" : "Appointments Report"}</div>
  <div style="color:#666;font-size:10px">${formatGregorianDate(new Date(), { utc: false })}</div>
</div>
<h2>${isAr ? "المواعيد العادية" : "Regular Appointments"} (${regularAppts.length})</h2>
<table><thead><tr>${headHtml}</tr></thead><tbody>${apptRows(regularAppts)}
<tr class="total-row"><td colspan="7" style="text-align:${dir==="rtl"?"left":"right"}">${isAr?"إجمالي المواعيد العادية":"Regular Total"}</td><td style="text-align:center;font-family:monospace">${totalRegular.toFixed(2)}</td></tr>
</tbody></table>
<h2>${isAr ? "المواعيد العاجلة" : "Urgent Appointments"} (${urgentAppts.length})</h2>
<table><thead><tr>${headHtml}</tr></thead><tbody>${apptRows(urgentAppts)}
<tr class="total-row"><td colspan="7" style="text-align:${dir==="rtl"?"left":"right"}">${isAr?"إجمالي المواعيد العاجلة":"Urgent Total"}</td><td style="text-align:center;font-family:monospace">${totalUrgent.toFixed(2)}</td></tr>
</tbody></table>
<div class="grand-total"><span>${isAr?"الإجمالي الكلي":"Grand Total"}</span><span>${grandTotal.toFixed(2)} ${isAr?"ريال":"SAR"}</span></div>
<div class="ftr">Pure Home System — ${formatGregorianDateTime(new Date(), { utc: false })}</div>
</body></html>`;
      const filePath = await (window as any).electron.printToPDF(html, `appointments-report-${Date.now()}.pdf`);
      toast.success(`${t("reports.savedTo")}: ${filePath}`);
    } catch {
      toast.error(t("common.error"));
    } finally { setGeneratingAppts(null); }
  }

  async function exportApptExcel() {
    if (!allAppts.length) return;
    setGeneratingAppts("excel");
    try {
      const { downloadExcelWorkbook } = await import("../../utils/excelExport");
      function apptRow(a: any) {
        const amt = apptAmount(a);
        return {
          [isAr ? "النوع" : "Kind"]: a.isUrgent ? (isAr ? "عاجل" : "Urgent") : (isAr ? "عادي" : "Regular"),
          [isAr ? "المصدر" : "Source"]: apptSourceLabel(a.createdByRole),
          [isAr ? "العميل" : "Customer"]: a.customer?.name || (isAr ? "زيارة عاجلة" : "Urgent Visit"),
          [isAr ? "الجوال" : "Phone"]: a.customer?.phone || "—",
          [isAr ? "التاريخ" : "Date"]: formatGregorianDate(a.scheduledDate),
          [isAr ? "نوع الخدمة" : "Service Type"]: a.type,
          [isAr ? "الحالة" : "Status"]: appointmentStatusLabel(a, t),
          [isAr ? "المبلغ (ريال)" : "Amount (SAR)"]: amt != null ? amt : "",
        };
      }
      function totalRow(label: string, list: any[]) {
        const total = list.reduce((s: number, a: any) => s + (apptAmount(a) ?? 0), 0);
        return { [isAr ? "النوع" : "Kind"]: label, [isAr ? "المصدر" : "Source"]: "", [isAr ? "العميل" : "Customer"]: "", [isAr ? "الجوال" : "Phone"]: "", [isAr ? "التاريخ" : "Date"]: "", [isAr ? "نوع الخدمة" : "Service Type"]: "", [isAr ? "الحالة" : "Status"]: isAr ? "الإجمالي" : "TOTAL", [isAr ? "المبلغ (ريال)" : "Amount (SAR)"]: total };
      }
      const apptCols = [10, 18, 30, 14, 14, 16, 16, 14];
      const regularRows = [...regularAppts.map(apptRow), totalRow(isAr ? "الإجمالي - العادية" : "Total - Regular", regularAppts)];
      const urgentRows  = [...urgentAppts.map(apptRow), totalRow(isAr ? "الإجمالي - العاجلة" : "Total - Urgent", urgentAppts)];
      await downloadExcelWorkbook([
        { name: isAr ? "المواعيد العادية" : "Regular", rows: regularRows, colWidths: apptCols },
        { name: isAr ? "المواعيد العاجلة" : "Urgent", rows: urgentRows, colWidths: apptCols },
      ], `appointments-${Date.now()}.xlsx`);
      toast.success(t("reports.savedTo"));
    } catch {
      toast.error(t("common.error"));
    } finally { setGeneratingAppts(null); }
  }

  async function exportPdf() {
    if (!customers.length) return;
    setGenerating("pdf");
    try {
      const html = buildPdfHtml(customers, filters, isAr, t, total);
      const filePath = await (window as any).electron.printToPDF(html, `customers-report-${Date.now()}.pdf`);
      toast.success(`${t("reports.savedTo")}: ${filePath}`);
    } catch {
      toast.error(t("common.error"));
    } finally { setGenerating(null); }
  }

  async function exportExcel() {
    if (!customers.length) return;
    setGenerating("excel");
    try {
      const { downloadExcelWorkbook } = await import("../../utils/excelExport");
      const customerExcelTotal = customers.reduce((s: number, c: any) => s + (Number(c.totalAmount) || 0), 0);
      const rows = [
        ...customers.map((c: any) => ({
          [isAr ? "الاسم" : "Name"]: c.name,
          [isAr ? "الجوال" : "Phone"]: c.phone,
          [isAr ? "المدينة" : "City"]: c.address?.city || "",
          [isAr ? "الحي" : "District"]: c.address?.district || "",
          [isAr ? "تاريخ التسجيل" : "Reg. Date"]: formatGregorianDate(c.createdAt),
          [isAr ? "تاريخ التركيب" : "Installation Date"]: c.installationDate ? formatGregorianDate(c.installationDate) : "",
          [isAr ? "دورة الصيانة" : "Cycle"]: formatCycle(c.maintenanceCycle, c.maintenanceFrequency, t),
          [isAr ? "آخر صيانة" : "Last Maint."]: c.lastMaintenance ? formatGregorianDate(c.lastMaintenance) : "",
          [isAr ? "الصيانة القادمة" : "Next Maint."]: (c.nextMaintenanceDate || c.nextMaintenance) ? formatGregorianDate(c.nextMaintenanceDate || c.nextMaintenance) : "",
          [isAr ? "أيام متبقية" : "Days Until"]: c.daysUntil ?? "",
          [isAr ? "حالة الصيانة" : "Maintenance Status"]: c.maintenanceStatus ? maintenanceStatusLabel(c.maintenanceStatus) : "",
          [isAr ? "الحالة" : "Alert"]: c.alertLevel === "overdue" ? (isAr ? "متأخر" : "Overdue") : c.alertLevel === "soon" ? (isAr ? "قريب" : "Soon") : (isAr ? "طبيعي" : "OK"),
          [isAr ? "ملاحظات" : "Notes"]: c.notes || "",
          [isAr ? "المبلغ الإجمالي (ريال)" : "Total Amount (SAR)"]: c.totalAmount != null && c.totalAmount > 0 ? Number(c.totalAmount) : "",
        })),
        {
          [isAr ? "الاسم" : "Name"]: isAr ? "الإجمالي الكلي" : "GRAND TOTAL",
          [isAr ? "الجوال" : "Phone"]: "", [isAr ? "المدينة" : "City"]: "", [isAr ? "الحي" : "District"]: "",
          [isAr ? "تاريخ التسجيل" : "Reg. Date"]: "", [isAr ? "تاريخ التركيب" : "Installation Date"]: "",
          [isAr ? "دورة الصيانة" : "Cycle"]: "", [isAr ? "آخر صيانة" : "Last Maint."]: "",
          [isAr ? "الصيانة القادمة" : "Next Maint."]: "", [isAr ? "أيام متبقية" : "Days Until"]: "",
          [isAr ? "حالة الصيانة" : "Maintenance Status"]: "", [isAr ? "الحالة" : "Alert"]: "",
          [isAr ? "ملاحظات" : "Notes"]: "",
          [isAr ? "المبلغ الإجمالي (ريال)" : "Total Amount (SAR)"]: customerExcelTotal,
        },
      ];
      const colWidths = [
        28, // Name
        14, // Phone
        16, // City
        18, // District
        14, // Reg Date
        16, // Install Date
        20, // Cycle
        14, // Last Maint
        14, // Next Maint
        10, // Days Until
        18, // Maintenance Status
        10, // Alert
        30, // Notes
        18, // Total Amount
      ];
      await downloadExcelWorkbook([
        { name: isAr ? "العملاء" : "Customers", rows, colWidths },
      ], `customers-${Date.now()}.xlsx`);
      toast.success(t("reports.savedTo"));
    } catch {
      toast.error(t("common.error"));
    } finally { setGenerating(null); }
  }

  async function exportCustomerPdf(c: any) {
    try {
      const html = buildCustomerPdfHtml(c, isAr, t);
      const filePath = await (window as any).electron.printToPDF(html, `customer-${c.id}-${Date.now()}.pdf`);
      toast.success(`${t("reports.savedTo")}: ${filePath}`);
    } catch {
      toast.error(t("common.error"));
    }
  }

  async function generateSalesReport(period: "weekly" | "monthly", format: "pdf" | "excel") {
    const key = `${period}-${format}`;
    setGeneratingSales(key);
    try {
      const { from, to } = period === "weekly" ? prevWeekRange() : prevMonthRange();
      // Timezone safety: from/to are LOCAL-midnight Date objects (see
      // prevWeekRange/prevMonthRange above) -- toISOString() would convert to
      // UTC and can shift the boundary back a day in Saudi's +03:00 offset.
      const fromStr = localDateOnlyStr(from);
      const toStr = localDateOnlyStr(to);
      const periodLabel = period === "weekly"
        ? (isAr
            ? `الأسبوع الماضي: ${formatGregorianDate(from, { utc: false })} — ${formatGregorianDate(to, { utc: false })}`
            : `Previous Week: ${formatGregorianDate(from, { utc: false })} — ${formatGregorianDate(to, { utc: false })}`)
        : (isAr
            ? `الشهر الماضي: ${formatGregorianMonthYear(from, true)}`
            : `Previous Month: ${formatGregorianMonthYear(from, false)}`);
      const { data: salesData } = await api.get("/reports/sales", { params: { from: fromStr, to: toStr } });
      const rows: any[] = salesData.data || [];
      const totalAmount: number = salesData.meta?.totalAmount || 0;
      if (format === "pdf") {
        const html = buildSalesPdfHtml(rows, isAr, periodLabel, totalAmount);
        const filePath = await (window as any).electron.printToPDF(html, `sales-${period}-${Date.now()}.pdf`);
        toast.success(`${t("reports.savedTo")}: ${filePath}`);
      } else {
        const { downloadExcelWorkbook } = await import("../../utils/excelExport");
        const payLabels: Record<string, string> = { CASH: isAr ? "نقداً" : "Cash", BANK_TRANSFER_COMMERCIAL: isAr ? "تحويل بنكي (تجاري)" : "Bank Transfer (Commercial)", BANK_TRANSFER_PERSONAL: isAr ? "تحويل بنكي (خاص)" : "Bank Transfer (Personal)" };
        const typeLabels: Record<string, string> = { INSTALLATION: isAr ? "تركيب" : "Installation", MAINTENANCE: isAr ? "صيانة" : "Maintenance", VISIT_ONLY: isAr ? "زيارة فقط" : "Visit Only" };
        const excelRows = [
          ...rows.map((r: any) => ({
            [isAr ? "اسم العميل" : "Customer"]: r.customerName,
            [isAr ? "الجوال" : "Phone"]: r.customerPhone,
            [isAr ? "نوع الخدمة" : "Service Type"]: typeLabels[r.appointmentType] || r.appointmentType,
            [isAr ? "التاريخ" : "Date"]: formatGregorianDate(r.date),
            [isAr ? "الفني" : "Technician"]: r.technicianName,
            [isAr ? "طريقة الدفع" : "Payment"]: payLabels[r.paymentMethod] || r.paymentMethod || "—",
            [isAr ? "المبلغ (ريال)" : "Amount (SAR)"]: Number(r.amount),
          })),
          {
            [isAr ? "اسم العميل" : "Customer"]: isAr ? "الإجمالي" : "TOTAL",
            [isAr ? "الجوال" : "Phone"]: "", [isAr ? "نوع الخدمة" : "Service Type"]: "",
            [isAr ? "التاريخ" : "Date"]: "", [isAr ? "الفني" : "Technician"]: "",
            [isAr ? "طريقة الدفع" : "Payment"]: "", [isAr ? "المبلغ (ريال)" : "Amount (SAR)"]: totalAmount,
          },
        ];
        await downloadExcelWorkbook([
          { name: isAr ? "المبيعات" : "Sales", rows: excelRows, colWidths: [28, 14, 16, 14, 20, 16, 14] },
        ], `sales-${period}-${Date.now()}.xlsx`);
        toast.success(isAr ? "تم التنزيل" : "Downloaded");
      }
    } catch {
      toast.error(t("common.error"));
    } finally { setGeneratingSales(null); }
  }

  function maintenanceStatusLabel(status: string) {
    const map: Record<string, string> = {
      COMPLETED:      t("reports.maintenanceStatusCompleted"),
      OVERDUE:        t("reports.maintenanceStatusOverdue"),
      SCHEDULED:      t("reports.maintenanceStatusScheduled"),
      IN_PROGRESS:    t("reports.maintenanceStatusInProgress"),
      POSTPONED:      t("reports.maintenanceStatusPostponed"),
      CANCELLED:      t("reports.maintenanceStatusCancelled"),
      NO_APPOINTMENTS:t("reports.maintenanceStatusNoAppts"),
    };
    return map[status] || status;
  }

  function maintenanceStatusTone(status: string): Tone {
    const toneMap: Record<string, Tone> = {
      COMPLETED:       "success",
      OVERDUE:         "danger",
      SCHEDULED:       "info",
      IN_PROGRESS:     "progress",
      POSTPONED:       "warning",
      CANCELLED:       "neutral",
      NO_APPOINTMENTS: "neutral",
    };
    return toneMap[status] || "neutral";
  }

  const REPORT_TYPES: { key: "customers" | "appointments" | "sales"; icon: IconName; title: string; desc: string }[] = [
    {
      key: "customers", icon: "customers",
      title: isAr ? "تقارير العملاء" : "Customer Reports",
      desc: isAr ? "بيانات العملاء ودورات الصيانة" : "Customer data and maintenance cycles",
    },
    {
      key: "appointments", icon: "appointments",
      title: isAr ? "تقارير المواعيد" : "Appointment Reports",
      desc: isAr ? "المواعيد العادية والعاجلة" : "Regular and urgent appointments",
    },
    {
      key: "sales", icon: "reports",
      title: isAr ? "تقارير المبيعات" : "Sales Reports",
      desc: isAr ? "المبيعات الأسبوعية والشهرية" : "Weekly and monthly sales",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Report type selector. One accent marks the chosen type -- it used to be
          three different brand colours, which read as three unrelated products
          rather than three views of one report tool. */}
      <div className="bg-surface border border-line rounded-md p-3">
        <p className="text-2xs font-semibold uppercase tracking-wide text-fg-muted mb-2">
          {isAr ? "اختر نوع التقرير" : "Select Report Type"}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {REPORT_TYPES.map(rt => {
            const active = tab === rt.key;
            return (
              <button
                key={rt.key}
                type="button"
                onClick={() => setTab(rt.key)}
                aria-pressed={active}
                className={cx(
                  "flex items-center gap-3 p-3 rounded-md border text-start transition-colors",
                  active
                    ? "border-accent bg-accent-subtle"
                    : "border-line bg-surface hover:bg-surface-hover"
                )}
              >
                <span
                  className={cx(
                    "w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0",
                    active ? "bg-accent text-accent-fg" : "bg-surface-subtle border border-line-subtle text-fg-muted"
                  )}
                  aria-hidden="true"
                >
                  <Icon name={rt.icon} className="w-4 h-4" />
                </span>
                <span className="min-w-0">
                  <span className={cx("block text-[0.8125rem] font-semibold truncate", active ? "text-accent-subtlefg" : "text-fg")}>
                    {rt.title}
                  </span>
                  <span className="block text-2xs text-fg-muted truncate">{rt.desc}</span>
                </span>
                {active && <Icon name="check" className="w-4 h-4 text-accent ms-auto flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      {!tab && (
        <div className="bg-surface border border-line rounded-md">
          <EmptyState
            icon={<Icon name="reports" className="w-5 h-5" />}
            title={isAr ? "اختر نوع التقرير أعلاه للبدء" : "Select a report type above to get started"}
            description={isAr ? "تقارير العملاء أو تقارير المواعيد أو تقارير المبيعات" : "Customer Reports, Appointment Reports, or Sales Reports"}
          />
        </div>
      )}

      {/* ── Customer Reports ── */}
      {tab === "customers" && <>
        <PageHeader
          title={t("reports.customerReports")}
          subtitle={t("reports.showingCount", { count: total })}
          actions={
            <>
              <Button variant="secondary" disabled={!customers.length} loading={generating === "pdf"} onClick={exportPdf}>
                <Icon name="download" className="w-3.5 h-3.5" />
                {t("reports.exportPdf")}
              </Button>
              <Button variant="secondary" disabled={!customers.length} loading={generating === "excel"} onClick={exportExcel}>
                <Icon name="download" className="w-3.5 h-3.5" />
                {t("reports.exportExcel")}
              </Button>
            </>
          }
        />

        <div className="bg-surface border border-line rounded-md">
          <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label={t("common.search")} htmlFor="rep-search">
              <Input
                id="rep-search"
                value={filters.search}
                onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                placeholder={isAr ? "اسم، جوال..." : "Name, phone..."}
              />
            </Field>
            <Field label={t("reports.dateFrom")} htmlFor="rep-from">
              <Input id="rep-from" type="date" lang="en-GB" dir="ltr" value={filters.dateFrom}
                onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} />
            </Field>
            <Field label={t("reports.dateTo")} htmlFor="rep-to">
              <Input id="rep-to" type="date" lang="en-GB" dir="ltr" value={filters.dateTo}
                onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} />
            </Field>
            <div className="sm:col-span-2 lg:col-span-4">
              <Label>{t("reports.statusFilterMulti")}</Label>
              <CheckGroup
                className="mt-1"
                ariaLabel={t("reports.statusFilterMulti")}
                value={filters.statuses}
                options={CUSTOMER_REPORT_STATUSES}
                labels={customerStatusLabels(t)}
                onToggle={opt => setFilters(f => ({ ...f, statuses: toggleIn(f.statuses, opt as CustomerReportStatus) }))}
              />
              <p className="text-2xs text-fg-muted mt-1.5">
                {filters.statuses.length
                  ? t("reports.statusSelectedCount", { count: filters.statuses.length })
                  : t("reports.statusNoneSelectedMeansAll")}
              </p>
            </div>
          </div>
          <div className="px-3 py-2.5 border-t border-line bg-surface-subtle flex justify-end">
            <Button variant="primary" onClick={() => setHasSearched(true)}>
              <Icon name="search" className="w-3.5 h-3.5" />
              {isAr ? "تحميل النتائج" : "Load Results"}
            </Button>
          </div>
        </div>

        {!hasSearched ? (
          <div className="bg-surface border border-line rounded-md">
            <EmptyState
              icon={<Icon name="search" className="w-5 h-5" />}
              title={isAr ? "طبّق فلاتر البحث لتحميل البيانات" : "Apply search filters to load data"}
            />
          </div>
        ) : isLoading ? (
          <Loading label={t("common.loading")} />
        ) : !customers.length ? (
          <div className="bg-surface border border-line rounded-md">
            <EmptyState icon={<Icon name="customers" className="w-5 h-5" />} title={t("reports.noResults")} />
          </div>
        ) : (
          <TableShell>
            <Table className="min-w-[1240px]">
              <THead>
                <tr>
                  <TH width="3rem" align="end">#</TH>
                  <TH>{t("common.name")}</TH>
                  <TH width="9rem">{t("common.phone")}</TH>
                  <TH width="8rem">{t("customers.city")}</TH>
                  <TH width="7rem">{t("reports.registrationDate")}</TH>
                  <TH width="7rem">{t("reports.installationDate")}</TH>
                  <TH width="9rem">{t("customers.maintenanceCycle")}</TH>
                  <TH width="7rem">{t("reports.lastMaintenance")}</TH>
                  <TH width="7rem">{t("reports.nextMaintenance")}</TH>
                  <TH width="9rem">{t("reports.upcomingMaintenance")}</TH>
                  <TH width="10rem">{t("reports.maintenanceStatus")}</TH>
                  <TH width="4rem" />
                </tr>
              </THead>
              <TBody>
                {customers.map((c: any, i: number) => (
                  <TR key={c.id}>
                    <TD align="end" className="text-fg-muted text-2xs tabular-nums">{i + 1}</TD>
                    <TD className="font-medium">{c.name}</TD>
                    <TD className="text-fg-secondary"><span dir="ltr">{c.phone}</span></TD>
                    <TD className="text-fg-secondary">{c.address?.city || "—"}</TD>
                    <TD className="text-fg-secondary text-2xs tabular-nums whitespace-nowrap">
                      <span dir="ltr">{formatGregorianDate(c.createdAt)}</span>
                    </TD>
                    <TD className="text-fg-secondary text-2xs tabular-nums whitespace-nowrap">
                      <span dir="ltr">{c.installationDate ? formatGregorianDate(c.installationDate) : "—"}</span>
                    </TD>
                    <TD className="text-fg-secondary text-2xs">{formatCycle(c.maintenanceCycle, c.maintenanceFrequency, t)}</TD>
                    <TD className="text-fg-secondary text-2xs tabular-nums whitespace-nowrap">
                      <span dir="ltr">{c.lastMaintenance ? formatGregorianDate(c.lastMaintenance) : "—"}</span>
                    </TD>
                    <TD className="text-fg-secondary text-2xs tabular-nums whitespace-nowrap">
                      <span dir="ltr">
                        {(c.nextMaintenanceDate || c.nextMaintenance) ? formatGregorianDate(c.nextMaintenanceDate || c.nextMaintenance) : "—"}
                      </span>
                    </TD>
                    <TD><AlertBadge c={c} isAr={isAr} /></TD>
                    <TD>
                      {c.maintenanceStatus ? (
                        <Badge tone={maintenanceStatusTone(c.maintenanceStatus)} dot>
                          {maintenanceStatusLabel(c.maintenanceStatus)}
                        </Badge>
                      ) : <span className="text-2xs text-fg-muted">—</span>}
                    </TD>
                    <TD>
                      <Button
                        size="sm" variant="ghost" iconOnly
                        onClick={() => exportCustomerPdf(c)}
                        title={t("reports.exportCustPdf")}
                        aria-label={t("reports.exportCustPdf")}
                      >
                        <Icon name="download" className="w-4 h-4" />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableShell>
        )}
      </>}

      {/* ── Appointment Reports ── */}
      {tab === "appointments" && <>
        <PageHeader
          title={isAr ? "تقارير المواعيد" : "Appointment Reports"}
          subtitle={
            <span className="tabular-nums">
              {isAr
                ? `${regularAppts.length} عادي | ${urgentAppts.length} عاجل`
                : `${regularAppts.length} regular | ${urgentAppts.length} urgent`}
            </span>
          }
          actions={
            <>
              <Button variant="secondary" disabled={!allAppts.length} loading={generatingAppts === "pdf"} onClick={exportApptPdf}>
                <Icon name="download" className="w-3.5 h-3.5" />
                {t("reports.exportPdf")}
              </Button>
              <Button variant="secondary" disabled={!allAppts.length} loading={generatingAppts === "excel"} onClick={exportApptExcel}>
                <Icon name="download" className="w-3.5 h-3.5" />
                {t("reports.exportExcel")}
              </Button>
            </>
          }
        />

        <div className="bg-surface border border-line rounded-md">
          <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label={t("reports.dateFrom")} htmlFor="appt-rep-from">
              <Input id="appt-rep-from" type="date" lang="en-GB" dir="ltr" value={apptFilters.dateFrom}
                onChange={e => setApptFilters(f => ({ ...f, dateFrom: e.target.value }))} />
            </Field>
            <Field label={t("reports.dateTo")} htmlFor="appt-rep-to">
              <Input id="appt-rep-to" type="date" lang="en-GB" dir="ltr" value={apptFilters.dateTo}
                onChange={e => setApptFilters(f => ({ ...f, dateTo: e.target.value }))} />
            </Field>
            <div className="sm:col-span-2 lg:col-span-4">
              <Label>{t("reports.statusFilterMulti")}</Label>
              <CheckGroup
                className="mt-1"
                ariaLabel={t("reports.statusFilterMulti")}
                value={apptFilters.statuses}
                options={APPOINTMENT_REPORT_STATUSES}
                labels={appointmentStatusLabels(t)}
                onToggle={opt => setApptFilters(f => ({ ...f, statuses: toggleIn(f.statuses, opt as AppointmentReportStatus) }))}
              />
              <p className="text-2xs text-fg-muted mt-1.5">
                {apptFilters.statuses.length
                  ? t("reports.statusSelectedCount", { count: apptFilters.statuses.length })
                  : t("reports.statusNoneSelectedMeansAll")}
              </p>
            </div>
          </div>
          <div className="px-3 py-2.5 border-t border-line bg-surface-subtle flex justify-end">
            <Button variant="primary" onClick={() => setHasSearchedAppts(true)}>
              <Icon name="search" className="w-3.5 h-3.5" />
              {isAr ? "تحميل النتائج" : "Load Results"}
            </Button>
          </div>
        </div>

        {!hasSearchedAppts ? (
          <div className="bg-surface border border-line rounded-md">
            <EmptyState
              icon={<Icon name="search" className="w-5 h-5" />}
              title={isAr ? "طبّق فلاتر البحث لتحميل البيانات" : "Apply search filters to load data"}
            />
          </div>
        ) : apptLoading ? (
          <Loading label={t("common.loading")} />
        ) : (
          <>
            <TableShell>
              <div className="px-3 py-2.5 border-b border-line bg-surface-subtle flex items-baseline gap-2 flex-wrap">
                <span className="text-2xs font-semibold uppercase tracking-wide text-fg">
                  {isAr ? "المواعيد العادية" : "Regular Appointments"}
                  <span className="tabular-nums ms-1">({regularAppts.length})</span>
                </span>
                <span className="text-2xs text-fg-muted">
                  {isAr ? "المصدر: الإدارة أو الجدولة" : "Source: Administration or Scheduling"}
                </span>
              </div>
              {regularAppts.length === 0 ? (
                <EmptyState icon={<Icon name="appointments" className="w-5 h-5" />} title={t("common.noRecords")} />
              ) : (
                <Table className="min-w-[900px]">
                  <THead>
                    <tr>
                      <TH width="3rem" align="end">#</TH>
                      <TH>{t("appointments.customer")}</TH>
                      <TH width="9rem">{t("common.phone")}</TH>
                      <TH width="7rem">{t("common.date")}</TH>
                      <TH width="8rem">{t("appointments.type")}</TH>
                      <TH width="8rem">{t("common.status")}</TH>
                      <TH width="12rem">{isAr ? "المصدر" : "Source"}</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {regularAppts.map((a: any, i: number) => (
                      <TR key={a.id}>
                        <TD align="end" className="text-fg-muted text-2xs tabular-nums">{i + 1}</TD>
                        <TD className="font-medium">{a.customer?.name || "—"}</TD>
                        <TD className="text-fg-secondary"><span dir="ltr">{a.customer?.phone || "—"}</span></TD>
                        <TD className="text-2xs tabular-nums whitespace-nowrap"><span dir="ltr">{formatGregorianDate(a.scheduledDate)}</span></TD>
                        <TD className="text-fg-secondary text-2xs">{a.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}</TD>
                        <TD><Badge tone="info">{appointmentStatusLabel(a, t)}</Badge></TD>
                        <TD className="text-fg-secondary text-2xs">{apptSourceLabel(a.createdByRole)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </TableShell>

            <TableShell>
              <div className="px-3 py-2.5 border-b border-line bg-urgent-bg flex items-baseline gap-2 flex-wrap">
                <span className="text-2xs font-semibold uppercase tracking-wide text-urgent-fg">
                  {isAr ? "المواعيد العاجلة" : "Urgent Appointments"}
                  <span className="tabular-nums ms-1">({urgentAppts.length})</span>
                </span>
                <span className="text-2xs text-urgent-fg opacity-75">
                  {isAr ? "المصدر: الإدارة" : "Source: Administration"}
                </span>
              </div>
              {urgentAppts.length === 0 ? (
                <EmptyState icon={<Icon name="urgent" className="w-5 h-5" />} title={t("common.noRecords")} />
              ) : (
                <Table className="min-w-[900px]">
                  <THead>
                    <tr>
                      <TH width="3rem" align="end">#</TH>
                      <TH>{isAr ? "موقع الزيارة" : "Visit Location"}</TH>
                      <TH width="7rem">{t("common.date")}</TH>
                      <TH width="8rem">{t("appointments.type")}</TH>
                      <TH width="8rem">{t("common.status")}</TH>
                      <TH width="12rem">{isAr ? "المصدر" : "Source"}</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {urgentAppts.map((a: any, i: number) => {
                      let loc: any = {};
                      try { loc = a.urgentLocation ? JSON.parse(a.urgentLocation) : {}; } catch {}
                      const locationText = [loc.city, loc.district, loc.street].filter(Boolean).join("، ") || "—";
                      return (
                        <TR key={a.id}>
                          <TD align="end" className="text-fg-muted text-2xs tabular-nums">{i + 1}</TD>
                          <TD>{locationText}</TD>
                          <TD className="text-2xs tabular-nums whitespace-nowrap"><span dir="ltr">{formatGregorianDate(a.scheduledDate)}</span></TD>
                          <TD className="text-fg-secondary text-2xs">{a.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}</TD>
                          <TD><Badge tone="urgent">{appointmentStatusLabel(a, t)}</Badge></TD>
                          <TD className="text-fg-secondary text-2xs">{apptSourceLabel(a.createdByRole)}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </TableShell>
          </>
        )}
      </>}

      {/* ── Sales Reports ── */}
      {tab === "sales" && (
        <div className="bg-surface border border-line rounded-md" dir={isAr ? "rtl" : "ltr"}>
          <div className="px-4 py-3 border-b border-line">
            <h3 className="text-sm font-semibold text-fg">{isAr ? "تقارير المبيعات" : "Sales Reports"}</h3>
            <p className="text-2xs text-fg-muted mt-0.5">
              {isAr
                ? "تقرير الأسبوع الماضي أو الشهر الماضي — يمكن إنشاؤه في أي وقت"
                : "Covers the previous week or the previous month — generate it whenever you need it"}
            </p>
          </div>

          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([
              { period: "weekly"  as const, format: "pdf"   as const, label: isAr ? "تقرير المبيعات الأسبوعي (PDF)" : "Weekly Sales Report (PDF)" },
              { period: "monthly" as const, format: "pdf"   as const, label: isAr ? "تقرير المبيعات الشهري (PDF)" : "Monthly Sales Report (PDF)" },
              { period: "weekly"  as const, format: "excel" as const, label: isAr ? "تقرير المبيعات الأسبوعي (Excel)" : "Weekly Sales Report (Excel)" },
              { period: "monthly" as const, format: "excel" as const, label: isAr ? "تقرير المبيعات الشهري (Excel)" : "Monthly Sales Report (Excel)" },
            ] as const).map(({ period, format, label }) => {
              const key = `${period}-${format}`;
              const isGen = generatingSales === key;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => generateSalesReport(period, format)}
                  disabled={generatingSales !== null}
                  className={cx(
                    "rounded-md border border-line bg-surface p-3 min-h-[88px] flex flex-col justify-between text-start",
                    "transition-colors hover:bg-surface-hover hover:border-accent",
                    "disabled:opacity-60 disabled:pointer-events-none"
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Icon name="download" className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
                    <span className="text-xs font-medium text-fg leading-snug">{label}</span>
                  </div>
                  <div className="mt-2">
                    {isGen
                      ? <span className="text-2xs text-fg-muted animate-pulse">{isAr ? "جاري التحميل..." : "Generating..."}</span>
                      : <span className="text-2xs text-success-fg font-medium">{isAr ? "جاهز للتحميل" : "Ready to download"}</span>
                    }
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
