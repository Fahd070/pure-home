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
    ? ["#", "الاسم", "الجوال", "المدينة", "تاريخ التسجيل", "دورة الصيانة", "آخر صيانة", "الصيانة القادمة", "الحالة"]
    : ["#", "Name", "Phone", "City", "Reg. Date", "Cycle", "Last Maint.", "Next Maint.", "Status"];

  const rows = customers.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${c.name}</td>
      <td>${c.phone}</td>
      <td>${c.address?.city || "—"}</td>
      <td>${new Date(c.createdAt).toLocaleDateString(isAr ? "ar-SA" : undefined)}</td>
      <td>${formatCycle(c.maintenanceCycle, c.maintenanceFrequency, t)}</td>
      <td>${c.lastMaintenance ? new Date(c.lastMaintenance).toLocaleDateString(isAr ? "ar-SA" : undefined) : "—"}</td>
      <td>${c.nextMaintenance ? new Date(c.nextMaintenance).toLocaleDateString(isAr ? "ar-SA" : undefined) : "—"}</td>
      <td><span class="badge badge-${c.alertLevel || "ok"}">${
    c.alertLevel === "overdue"
      ? (isAr ? `متأخر ${c.overdueCount} يوم` : `Overdue ${c.overdueCount}d`)
      : c.daysUntil !== null
        ? (isAr ? `متبقي ${c.daysUntil} يوم` : `In ${c.daysUntil}d`)
        : "—"
  }</span></td>
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
  const [filters, setFilters] = useState({ dateFrom: "", dateTo: "", status: "ALL", search: "" });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [generating, setGenerating] = useState<"pdf" | "excel" | null>(null);

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
    }).then(r => r.data)
  });

  const customers: any[] = data?.data || [];
  const total = data?.meta?.total || 0;

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
        [isAr ? "دورة الصيانة" : "Cycle"]: formatCycle(c.maintenanceCycle, c.maintenanceFrequency, t),
        [isAr ? "آخر صيانة" : "Last Maint."]: c.lastMaintenance ? new Date(c.lastMaintenance).toLocaleDateString() : "",
        [isAr ? "الصيانة القادمة" : "Next Maint."]: c.nextMaintenance ? new Date(c.nextMaintenance).toLocaleDateString() : "",
        [isAr ? "أيام متبقية" : "Days Until"]: c.daysUntil ?? "",
        [isAr ? "الحالة" : "Status"]: c.alertLevel === "overdue" ? (isAr ? "متأخر" : "Overdue") : c.alertLevel === "soon" ? (isAr ? "قريب" : "Soon") : (isAr ? "طبيعي" : "OK"),
        [isAr ? "ملاحظات" : "Notes"]: c.notes || "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
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
    { value: "THIS_MONTH", label: t("reports.statusThisMonth") },
    { value: "NEXT_MONTH", label: t("reports.statusNextMonth") },
  ];

  return (
    <div className="space-y-4">
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
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
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
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("customers.maintenanceCycle")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("reports.lastMaintenance")}</th>
                  <th className="text-start px-4 py-3 font-medium text-slate-600">{t("reports.nextMaintenance")}</th>
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
                    <td className="px-4 py-3 text-xs font-medium text-slate-600">
                      {formatCycle(c.maintenanceCycle, c.maintenanceFrequency, t)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {c.lastMaintenance ? new Date(c.lastMaintenance).toLocaleDateString(isAr ? "ar-SA" : undefined) : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {c.nextMaintenance ? new Date(c.nextMaintenance).toLocaleDateString(isAr ? "ar-SA" : undefined) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <AlertBadge c={c} isAr={isAr} />
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
    </div>
  );
}
