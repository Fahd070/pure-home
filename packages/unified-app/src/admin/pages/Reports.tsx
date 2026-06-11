import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import toast from "react-hot-toast";

function formatCycle(cycle: string, freq: number, t: any) {
  const n = Number(freq) || 1;
  if (cycle === "DAILY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.day") : t("customers.days")}`;
  if (cycle === "WEEKLY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.week") : t("customers.weeks")}`;
  if (cycle === "MONTHLY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.month") : t("customers.months")}`;
  return cycle;
}

function AlertBadge({ c, isAr }: { c: any; isAr: boolean }) {
  if (c.alertLevel === "overdue") return (
    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
      🔴 {isAr ? `متأخر ${c.overdueCount} يوم` : `Overdue ${c.overdueCount}d`}
    </span>
  );
  if (c.alertLevel === "soon") return (
    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
      🟡 {c.daysUntil === 0 ? (isAr ? "اليوم" : "Today") : c.daysUntil === 1 ? (isAr ? "غداً" : "Tomorrow") : (isAr ? `${c.daysUntil} يوم` : `${c.daysUntil}d`)}
    </span>
  );
  if (c.daysUntil !== null) return (
    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full whitespace-nowrap">
      🟢 {isAr ? `${c.daysUntil} يوم` : `${c.daysUntil}d`}
    </span>
  );
  return <span className="text-xs text-slate-400">—</span>;
}

function buildPdfHtml(customers: any[], filters: any, isAr: boolean, t: any, total: number) {
  const dir = isAr ? "rtl" : "ltr";
  const filterSummary = [
    filters.dateFrom ? (isAr ? `من ${filters.dateFrom}` : `From ${filters.dateFrom}`) : "",
    filters.dateTo   ? (isAr ? `إلى ${filters.dateTo}` : `To ${filters.dateTo}`) : "",
    filters.status !== "ALL" ? t(`reports.status${filters.status.charAt(0) + filters.status.slice(1).toLowerCase()}`) : "",
    filters.search   ? (isAr ? `بحث: ${filters.search}` : `Search: ${filters.search}`) : "",
  ].filter(Boolean).join(" | ") || (isAr ? "جميع العملاء" : "All Customers");

  const headers = isAr
    ? ["#", "الاسم", "الجوال", "المدينة", "تاريخ التسجيل", "تاريخ التركيب", "دورة الصيانة", "آخر صيانة", "الصيانة القادمة", "صيانة قادمة", "حالة الصيانة"]
    : ["#", "Name", "Phone", "City", "Reg. Date", "Install Date", "Cycle", "Last Maint.", "Next Maint.", "Upcoming", "Maint. Status"];

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
      <td>${c.name}</td>
      <td>${c.phone}</td>
      <td>${c.address?.city || "—"}</td>
      <td>${new Date(c.createdAt).toLocaleDateString(isAr ? "ar-SA" : undefined)}</td>
      <td>${c.installationDate ? new Date(c.installationDate).toLocaleDateString(isAr ? "ar-SA" : undefined) : "—"}</td>
      <td>${formatCycle(c.maintenanceCycle, c.maintenanceFrequency, t)}</td>
      <td>${c.lastMaintenance ? new Date(c.lastMaintenance).toLocaleDateString(isAr ? "ar-SA" : undefined) : "—"}</td>
      <td>${(c.nextMaintenanceDate || c.nextMaintenance) ? new Date(c.nextMaintenanceDate || c.nextMaintenance).toLocaleDateString(isAr ? "ar-SA" : undefined) : "—"}</td>
      <td><span class="badge badge-${c.alertLevel || "ok"}">${
    c.alertLevel === "overdue"
      ? (isAr ? `متأخر ${c.overdueCount} يوم` : `Overdue ${c.overdueCount}d`)
      : c.daysUntil !== null
        ? (isAr ? `متبقي ${c.daysUntil} يوم` : `In ${c.daysUntil}d`)
        : "—"
  }</span></td>
      <td>${statusText(c)}</td>
    </tr>`).join("");

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
.ftr{margin-top:14px;border-top:1px solid #eee;padding-top:6px;color:#999;font-size:9px;text-align:center}
</style></head><body>
<div class="hdr">
  <div class="brand">Pure Home</div>
  <div class="rtitle">${isAr ? "تقرير العملاء" : "Customer Report"}</div>
  <div class="meta">${isAr ? "تاريخ التقرير" : "Date"}: ${new Date().toLocaleDateString(isAr ? "ar-SA" : undefined)} &nbsp;|&nbsp; ${isAr ? "الفلاتر" : "Filters"}: ${filterSummary} &nbsp;|&nbsp; ${isAr ? "الإجمالي" : "Total"}: ${total}</div>
</div>
<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
<div class="ftr">Pure Home System — ${new Date().toLocaleString()}</div>
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
  <div style="color:#666;font-size:10px">${new Date().toLocaleDateString(isAr ? "ar-SA" : undefined)}</div>
</div>
<div class="cname">${c.name}</div>
<span class="badge badge-${c.alertLevel || "ok"}">${c.alertLevel === "overdue" ? (isAr ? "متأخر" : "Overdue") : c.alertLevel === "soon" ? (isAr ? "قادم قريباً" : "Upcoming Soon") : (isAr ? "طبيعي" : "OK")}</span>
<div class="section">
  <div class="sec-title">${isAr ? "معلومات التواصل" : "Contact Info"}</div>
  <div class="grid">
    <div class="item"><div class="lbl">${isAr ? "الجوال" : "Phone"}</div><div class="val">${c.phone}</div></div>
    <div class="item"><div class="lbl">${isAr ? "المدينة" : "City"}</div><div class="val">${c.address?.city || "—"}</div></div>
    <div class="item"><div class="lbl">${isAr ? "الحي" : "District"}</div><div class="val">${c.address?.district || "—"}</div></div>
    <div class="item"><div class="lbl">${isAr ? "الشارع" : "Street"}</div><div class="val">${c.address?.street || "—"}</div></div>
  </div>
</div>
<div class="section">
  <div class="sec-title">${isAr ? "معلومات الصيانة" : "Maintenance Info"}</div>
  <div class="grid">
    <div class="item"><div class="lbl">${isAr ? "تاريخ التسجيل" : "Registered"}</div><div class="val">${new Date(c.createdAt).toLocaleDateString(isAr ? "ar-SA" : undefined)}</div></div>
    <div class="item"><div class="lbl">${isAr ? "دورة الصيانة" : "Cycle"}</div><div class="val">${formatCycle(c.maintenanceCycle, c.maintenanceFrequency, t)}</div></div>
    <div class="item"><div class="lbl">${isAr ? "آخر صيانة" : "Last Maintenance"}</div><div class="val">${c.lastMaintenance ? new Date(c.lastMaintenance).toLocaleDateString(isAr ? "ar-SA" : undefined) : "—"}</div></div>
    <div class="item"><div class="lbl">${isAr ? "الصيانة القادمة" : "Next Maintenance"}</div><div class="val">${c.nextMaintenance ? new Date(c.nextMaintenance).toLocaleDateString(isAr ? "ar-SA" : undefined) : "—"}</div></div>
  </div>
</div>
${c.notes ? `<div class="section"><div class="sec-title">${isAr ? "ملاحظات" : "Notes"}</div><p style="font-size:11px;margin:0">${c.notes}</p></div>` : ""}
<div class="ftr">Pure Home System — ${new Date().toLocaleString()}</div>
</body></html>`;
}

export default function Reports() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const [tab, setTab] = useState<null | "customers" | "appointments">(null);
  const [filters, setFilters] = useState({ dateFrom: "", dateTo: "", status: "ALL", search: "" });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [generating, setGenerating] = useState<"pdf" | "excel" | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [apptFilters, setApptFilters] = useState({ dateFrom: "", dateTo: "", status: "" });
  const [hasSearchedAppts, setHasSearchedAppts] = useState(false);
  const [generatingAppts, setGeneratingAppts] = useState<"pdf" | "excel" | null>(null);

  useEffect(() => {
    window.dispatchEvent(new Event("clear-badge-reports-admin"));
  }, []);

  useEffect(() => {
    const tm = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(tm);
  }, [filters.search]);

  const { data, isLoading } = useQuery({
    queryKey: ["reports-customers", filters.dateFrom, filters.dateTo, filters.status, debouncedSearch],
    queryFn: () => api.get("/reports/customers", {
      params: {
        search: debouncedSearch || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        status: filters.status === "ALL" ? undefined : filters.status,
        limit: 200
      }
    }).then(r => r.data),
    enabled: hasSearched,
  });

  const customers: any[] = data?.data || [];
  const total = data?.meta?.total || 0;

  const { data: apptData, isLoading: apptLoading } = useQuery({
    queryKey: ["reports-appointments", apptFilters],
    queryFn: () => api.get("/appointments", {
      params: {
        from: apptFilters.dateFrom || undefined,
        to: apptFilters.dateTo || undefined,
        status: apptFilters.status || undefined,
      }
    }).then(r => r.data.data || []),
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

  async function exportApptPdf() {
    if (!allAppts.length) return;
    setGeneratingAppts("pdf");
    try {
      const dir = isAr ? "rtl" : "ltr";
      function apptRows(list: any[]) {
        return list.map((a: any, i: number) => `<tr>
          <td>${i + 1}</td>
          <td>${a.customer?.name || (isAr ? "زيارة عاجلة" : "Urgent Visit")}</td>
          <td>${a.customer?.phone || "—"}</td>
          <td>${new Date(a.scheduledDate).toLocaleDateString(isAr ? "ar-SA" : undefined)}</td>
          <td>${a.type === "INSTALLATION" ? (isAr ? "تركيب" : "Installation") : (isAr ? "صيانة" : "Maintenance")}</td>
          <td>${a.status}</td>
          <td>${apptSourceLabel(a.createdByRole)}</td>
        </tr>`).join("");
      }
      const headers = isAr
        ? ["#","العميل","الجوال","التاريخ","النوع","الحالة","المصدر"]
        : ["#","Customer","Phone","Date","Type","Status","Source"];
      const headHtml = headers.map(h => `<th>${h}</th>`).join("");
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
.ftr{margin-top:14px;border-top:1px solid #eee;padding-top:6px;color:#999;font-size:9px;text-align:center}
</style></head><body>
<div class="hdr">
  <div class="brand">Pure Home</div>
  <div style="font-size:14px;font-weight:bold">${isAr ? "تقرير المواعيد" : "Appointments Report"}</div>
  <div style="color:#666;font-size:10px">${new Date().toLocaleDateString(isAr ? "ar-SA" : undefined)}</div>
</div>
<h2>${isAr ? "المواعيد العادية" : "Regular Appointments"} (${regularAppts.length})</h2>
<table><thead><tr>${headHtml}</tr></thead><tbody>${apptRows(regularAppts)}</tbody></table>
<h2>${isAr ? "المواعيد العاجلة" : "Urgent Appointments"} (${urgentAppts.length})</h2>
<table><thead><tr>${headHtml}</tr></thead><tbody>${apptRows(urgentAppts)}</tbody></table>
<div class="ftr">Pure Home System — ${new Date().toLocaleString()}</div>
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
      const XLSX = await import("xlsx");
      function apptRow(a: any) {
        return {
          [isAr ? "النوع" : "Kind"]: a.isUrgent ? (isAr ? "عاجل" : "Urgent") : (isAr ? "عادي" : "Regular"),
          [isAr ? "المصدر" : "Source"]: apptSourceLabel(a.createdByRole),
          [isAr ? "العميل" : "Customer"]: a.customer?.name || (isAr ? "زيارة عاجلة" : "Urgent Visit"),
          [isAr ? "الجوال" : "Phone"]: a.customer?.phone || "—",
          [isAr ? "التاريخ" : "Date"]: new Date(a.scheduledDate).toLocaleDateString(),
          [isAr ? "نوع الخدمة" : "Service Type"]: a.type,
          [isAr ? "الحالة" : "Status"]: a.status,
        };
      }
      const apptCols = [{ wch: 10 }, { wch: 18 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 }];
      const regularRows = regularAppts.map(apptRow);
      const urgentRows  = urgentAppts.map(apptRow);
      const wsRegular = XLSX.utils.json_to_sheet(regularRows);
      wsRegular['!cols'] = apptCols;
      const wsUrgent = XLSX.utils.json_to_sheet(urgentRows);
      wsUrgent['!cols'] = apptCols;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, wsRegular, isAr ? "المواعيد العادية" : "Regular");
      XLSX.utils.book_append_sheet(wb, wsUrgent,  isAr ? "المواعيد العاجلة" : "Urgent");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `appointments-${Date.now()}.xlsx`; a.click();
      URL.revokeObjectURL(url);
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
      const XLSX = await import("xlsx");
      const rows = customers.map((c: any) => ({
        [isAr ? "الاسم" : "Name"]: c.name,
        [isAr ? "الجوال" : "Phone"]: c.phone,
        [isAr ? "المدينة" : "City"]: c.address?.city || "",
        [isAr ? "الحي" : "District"]: c.address?.district || "",
        [isAr ? "تاريخ التسجيل" : "Reg. Date"]: new Date(c.createdAt).toLocaleDateString(),
        [isAr ? "تاريخ التركيب" : "Installation Date"]: c.installationDate ? new Date(c.installationDate).toLocaleDateString() : "",
        [isAr ? "دورة الصيانة" : "Cycle"]: formatCycle(c.maintenanceCycle, c.maintenanceFrequency, t),
        [isAr ? "آخر صيانة" : "Last Maint."]: c.lastMaintenance ? new Date(c.lastMaintenance).toLocaleDateString() : "",
        [isAr ? "الصيانة القادمة" : "Next Maint."]: (c.nextMaintenanceDate || c.nextMaintenance) ? new Date(c.nextMaintenanceDate || c.nextMaintenance).toLocaleDateString() : "",
        [isAr ? "أيام متبقية" : "Days Until"]: c.daysUntil ?? "",
        [isAr ? "حالة الصيانة" : "Maintenance Status"]: c.maintenanceStatus ? maintenanceStatusLabel(c.maintenanceStatus) : "",
        [isAr ? "الحالة" : "Alert"]: c.alertLevel === "overdue" ? (isAr ? "متأخر" : "Overdue") : c.alertLevel === "soon" ? (isAr ? "قريب" : "Soon") : (isAr ? "طبيعي" : "OK"),
        [isAr ? "ملاحظات" : "Notes"]: c.notes || "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [
        { wch: 28 }, // Name
        { wch: 14 }, // Phone
        { wch: 16 }, // City
        { wch: 18 }, // District
        { wch: 14 }, // Reg Date
        { wch: 16 }, // Install Date
        { wch: 20 }, // Cycle
        { wch: 14 }, // Last Maint
        { wch: 14 }, // Next Maint
        { wch: 10 }, // Days Until
        { wch: 18 }, // Maintenance Status
        { wch: 10 }, // Alert
        { wch: 30 }, // Notes
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, isAr ? "العملاء" : "Customers");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `customers-${Date.now()}.xlsx`; a.click();
      URL.revokeObjectURL(url);
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

  const statusOptions = [
    { value: "ALL",        label: t("reports.allStatuses") },
    { value: "OVERDUE",    label: t("reports.statusOverdue") },
    { value: "UPCOMING",   label: t("reports.statusUpcoming") },
    { value: "COMPLETED",  label: t("reports.statusCompleted") },
    { value: "POSTPONED",  label: t("reports.statusPostponed") },
    { value: "SCHEDULED",  label: t("reports.statusScheduled") },
    { value: "IN_PROGRESS",label: t("reports.statusInProgress") },
    { value: "CANCELLED",  label: t("reports.statusCancelled") },
    { value: "THIS_MONTH", label: t("reports.statusThisMonth") },
    { value: "NEXT_MONTH", label: t("reports.statusNextMonth") },
  ];

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

  function maintenanceStatusBadge(status: string) {
    const colorMap: Record<string, string> = {
      COMPLETED:       "bg-green-100 text-green-700",
      OVERDUE:         "bg-red-100 text-red-700",
      SCHEDULED:       "bg-blue-100 text-blue-700",
      IN_PROGRESS:     "bg-indigo-100 text-indigo-700",
      POSTPONED:       "bg-orange-100 text-orange-700",
      CANCELLED:       "bg-slate-100 text-slate-500",
      NO_APPOINTMENTS: "bg-slate-50 text-slate-400",
    };
    return colorMap[status] || "bg-slate-100 text-slate-500";
  }

  return (
    <div className="space-y-4">
      {/* Report type selector */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <p className="text-sm font-semibold text-slate-700 mb-3">
          {isAr ? "اختر نوع التقرير" : "Select Report Type"}
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => setTab("customers")}
            className={`flex-1 flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-start ${tab === "customers" ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-slate-300 bg-slate-50"}`}
          >
            <span className="text-2xl">👥</span>
            <div>
              <p className={`font-semibold text-sm ${tab === "customers" ? "text-blue-700" : "text-slate-700"}`}>
                {isAr ? "تقارير العملاء" : "Customer Reports"}
              </p>
              <p className="text-xs text-slate-400">{isAr ? "بيانات العملاء ودورات الصيانة" : "Customer data and maintenance cycles"}</p>
            </div>
            {tab === "customers" && <span className="ms-auto text-blue-600 text-lg">✓</span>}
          </button>
          <button
            onClick={() => setTab("appointments")}
            className={`flex-1 flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-start ${tab === "appointments" ? "border-purple-600 bg-purple-50" : "border-slate-200 hover:border-slate-300 bg-slate-50"}`}
          >
            <span className="text-2xl">📅</span>
            <div>
              <p className={`font-semibold text-sm ${tab === "appointments" ? "text-purple-700" : "text-slate-700"}`}>
                {isAr ? "تقارير المواعيد" : "Appointment Reports"}
              </p>
              <p className="text-xs text-slate-400">{isAr ? "المواعيد العادية والعاجلة" : "Regular and urgent appointments"}</p>
            </div>
            {tab === "appointments" && <span className="ms-auto text-purple-600 text-lg">✓</span>}
          </button>
        </div>
      </div>

      {/* No selection state */}
      {!tab && (
        <div className="bg-white rounded-xl shadow-sm p-16 text-center text-slate-400">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-base font-medium text-slate-600">{isAr ? "اختر نوع التقرير أعلاه للبدء" : "Select a report type above to get started"}</p>
          <p className="text-xs mt-1">{isAr ? "تقارير العملاء أو تقارير المواعيد" : "Customer Reports or Appointment Reports"}</p>
        </div>
      )}

      {/* ── Customer Reports ── */}
      {tab === "customers" && <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{t("reports.customerReports")}</h1>
          <p className="text-sm text-slate-500">{t("reports.showingCount", { count: total })}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportPdf} disabled={!customers.length || generating === "pdf"}
            style={{ backgroundColor: "#000080" }}
            className="text-white text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
            {generating === "pdf" ? t("reports.generating") : `📄 ${t("reports.exportPdf")}`}
          </button>
          <button onClick={exportExcel} disabled={!customers.length || generating === "excel"}
            className="bg-green-700 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-800 disabled:opacity-50 flex items-center gap-2">
            {generating === "excel" ? t("reports.generating") : `📊 ${t("reports.exportExcel")}`}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t("common.search")}</label>
            <input value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              placeholder={isAr ? "اسم، جوال..." : "Name, phone..."}
              className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t("reports.dateFrom")}</label>
            <input type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
              className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t("reports.dateTo")}</label>
            <input type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
              className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t("reports.statusFilter")}</label>
            <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
              className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button onClick={() => setHasSearched(true)}
            style={{ backgroundColor: "#000080" }}
            className="text-white text-sm px-5 py-2 rounded-lg hover:opacity-90 flex items-center gap-2">
            🔍 {isAr ? "تحميل النتائج" : "Load Results"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {!hasSearched ? (
          <p className="text-center py-16 text-slate-400">
            🔍 {isAr ? "طبّق فلاتر البحث لتحميل البيانات" : "Apply search filters to load data"}
          </p>
        ) : isLoading ? (
          <p className="text-center py-10 text-slate-400">{t("common.loading")}</p>
        ) : !customers.length ? (
          <p className="text-center py-10 text-slate-400">{t("reports.noResults")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">#</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.name")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.phone")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("customers.city")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("reports.registrationDate")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("reports.installationDate")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("customers.maintenanceCycle")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("reports.lastMaintenance")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("reports.nextMaintenance")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("reports.upcomingMaintenance")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("reports.maintenanceStatus")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600"></th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c: any, i: number) => (
                  <tr key={c.id} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-400 text-xs">{i + 1}</td>
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-slate-600">{c.phone}</td>
                    <td className="px-4 py-3 text-slate-500">{c.address?.city || "—"}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {new Date(c.createdAt).toLocaleDateString(isAr ? "ar-SA" : undefined)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {c.installationDate ? new Date(c.installationDate).toLocaleDateString(isAr ? "ar-SA" : undefined) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-600">
                      {formatCycle(c.maintenanceCycle, c.maintenanceFrequency, t)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {c.lastMaintenance ? new Date(c.lastMaintenance).toLocaleDateString(isAr ? "ar-SA" : undefined) : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {(c.nextMaintenanceDate || c.nextMaintenance) ? new Date(c.nextMaintenanceDate || c.nextMaintenance).toLocaleDateString(isAr ? "ar-SA" : undefined) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <AlertBadge c={c} isAr={isAr} />
                    </td>
                    <td className="px-4 py-3">
                      {c.maintenanceStatus ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${maintenanceStatusBadge(c.maintenanceStatus)}`}>
                          {maintenanceStatusLabel(c.maintenanceStatus)}
                        </span>
                      ) : <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => exportCustomerPdf(c)}
                        className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-2 py-0.5 rounded hover:bg-blue-50 whitespace-nowrap">
                        📄 {t("reports.exportCustPdf")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>}

      {/* ── Appointment Reports ── */}
      {tab === "appointments" && <>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800">{isAr ? "تقارير المواعيد" : "Appointment Reports"}</h1>
            <p className="text-sm text-slate-500">
              {isAr
                ? `${regularAppts.length} عادي | ${urgentAppts.length} عاجل`
                : `${regularAppts.length} regular | ${urgentAppts.length} urgent`}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={exportApptPdf} disabled={!allAppts.length || generatingAppts === "pdf"}
              style={{ backgroundColor: "#000080" }}
              className="text-white text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50">
              {generatingAppts === "pdf" ? t("reports.generating") : `📄 ${t("reports.exportPdf")}`}
            </button>
            <button onClick={exportApptExcel} disabled={!allAppts.length || generatingAppts === "excel"}
              className="bg-green-700 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-800 disabled:opacity-50">
              {generatingAppts === "excel" ? t("reports.generating") : `📊 ${t("reports.exportExcel")}`}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("reports.dateFrom")}</label>
              <input type="date" value={apptFilters.dateFrom}
                onChange={e => setApptFilters(f => ({ ...f, dateFrom: e.target.value }))}
                className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("reports.dateTo")}</label>
              <input type="date" value={apptFilters.dateTo}
                onChange={e => setApptFilters(f => ({ ...f, dateTo: e.target.value }))}
                className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("common.status")}</label>
              <select value={apptFilters.status}
                onChange={e => setApptFilters(f => ({ ...f, status: e.target.value }))}
                className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">{t("common.all")}</option>
                {["SCHEDULED","RESCHEDULED","CANCELLED","PENDING"].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button onClick={() => setHasSearchedAppts(true)}
              style={{ backgroundColor: "#000080" }}
              className="text-white text-sm px-5 py-2 rounded-lg hover:opacity-90">
              🔍 {isAr ? "تحميل النتائج" : "Load Results"}
            </button>
          </div>
        </div>

        {!hasSearchedAppts ? (
          <div className="bg-white rounded-xl shadow-sm">
            <p className="text-center py-16 text-slate-400">
              🔍 {isAr ? "طبّق فلاتر البحث لتحميل البيانات" : "Apply search filters to load data"}
            </p>
          </div>
        ) : apptLoading ? (
          <p className="text-center py-10 text-slate-400">{t("common.loading")}</p>
        ) : (
          <>
            {/* Regular Appointments */}
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b bg-blue-50 flex items-center gap-2">
                <span className="text-xs font-bold text-blue-700 uppercase tracking-wide">
                  {isAr ? "المواعيد العادية" : "Regular Appointments"} ({regularAppts.length})
                </span>
                <span className="text-xs text-blue-500">{isAr ? "المصدر: الإدارة أو الجدولة" : "Source: Administration or Scheduling"}</span>
              </div>
              {regularAppts.length === 0 ? (
                <p className="text-center py-8 text-slate-400 text-sm">{t("common.noRecords")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="text-start px-4 py-3 font-medium text-slate-600">#</th>
                        <th className="text-start px-4 py-3 font-medium text-slate-600">{t("appointments.customer")}</th>
                        <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.phone")}</th>
                        <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.date")}</th>
                        <th className="text-start px-4 py-3 font-medium text-slate-600">{t("appointments.type")}</th>
                        <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.status")}</th>
                        <th className="text-start px-4 py-3 font-medium text-slate-600">{isAr ? "المصدر" : "Source"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {regularAppts.map((a: any, i: number) => (
                        <tr key={a.id} className="border-b hover:bg-slate-50">
                          <td className="px-4 py-3 text-slate-400 text-xs">{i + 1}</td>
                          <td className="px-4 py-3 font-medium">{a.customer?.name || "—"}</td>
                          <td className="px-4 py-3 text-slate-500">{a.customer?.phone || "—"}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-xs">{new Date(a.scheduledDate).toLocaleDateString(isAr ? "ar-SA" : undefined)}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{a.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}</td>
                          <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{a.status}</span></td>
                          <td className="px-4 py-3 text-xs text-slate-600">{apptSourceLabel(a.createdByRole)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Urgent Appointments */}
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b bg-red-50 flex items-center gap-2">
                <span className="text-xs font-bold text-red-700 uppercase tracking-wide">
                  🚨 {isAr ? "المواعيد العاجلة" : "Urgent Appointments"} ({urgentAppts.length})
                </span>
                <span className="text-xs text-red-400">{isAr ? "المصدر: الإدارة" : "Source: Administration"}</span>
              </div>
              {urgentAppts.length === 0 ? (
                <p className="text-center py-8 text-slate-400 text-sm">{t("common.noRecords")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="text-start px-4 py-3 font-medium text-slate-600">#</th>
                        <th className="text-start px-4 py-3 font-medium text-slate-600">{isAr ? "موقع الزيارة" : "Visit Location"}</th>
                        <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.date")}</th>
                        <th className="text-start px-4 py-3 font-medium text-slate-600">{t("appointments.type")}</th>
                        <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.status")}</th>
                        <th className="text-start px-4 py-3 font-medium text-slate-600">{isAr ? "المصدر" : "Source"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {urgentAppts.map((a: any, i: number) => {
                        let loc: any = {};
                        try { loc = a.urgentLocation ? JSON.parse(a.urgentLocation) : {}; } catch {}
                        const locationText = [loc.city, loc.district, loc.street].filter(Boolean).join("، ") || "—";
                        return (
                          <tr key={a.id} className="border-b hover:bg-slate-50">
                            <td className="px-4 py-3 text-slate-400 text-xs">{i + 1}</td>
                            <td className="px-4 py-3 text-slate-700">{locationText}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-xs">{new Date(a.scheduledDate).toLocaleDateString(isAr ? "ar-SA" : undefined)}</td>
                            <td className="px-4 py-3 text-xs text-slate-500">{a.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}</td>
                            <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700">{a.status}</span></td>
                            <td className="px-4 py-3 text-xs text-slate-600">{apptSourceLabel(a.createdByRole)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </>}
    </div>
  );
}
