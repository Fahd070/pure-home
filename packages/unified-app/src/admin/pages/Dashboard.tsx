import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";

// ── Drill-down modal ──────────────────────────────────────────────────────────
function DrillModal({ title, endpoint, onClose }: { title: string; endpoint: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => { const tm = setTimeout(() => setDebouncedSearch(search), 300); return () => clearTimeout(tm); }, [search]);
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const { data, isLoading } = useQuery({
    queryKey: [endpoint, debouncedSearch, page],
    queryFn: () => api.get(`/dashboard/${endpoint}`, { params: { search: debouncedSearch, page, limit: 15 } }).then(r => r.data)
  });

  const items = data?.data || [];
  const total = data?.meta?.total || 0;
  const pages = Math.ceil(total / 15) || 1;
  const isAppointmentList = ["this-month","next-month","overdue","today","urgent"].includes(endpoint);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-bold text-lg text-slate-800">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500">✕</button>
        </div>
        <div className="p-4 border-b">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("dashboard.search")}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? <p className="text-center py-8 text-slate-400 text-sm">{t("dashboard.loading")}</p> : items.length === 0 ? (
            <p className="text-center py-8 text-slate-400 text-sm">{t("dashboard.noRecords")}</p>
          ) : isAppointmentList ? (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0"><tr>
                <th className="text-start px-4 py-2 font-medium text-slate-600">{t("appointments.customer")}</th>
                <th className="text-start px-4 py-2 font-medium text-slate-600">{t("common.phone")}</th>
                <th className="text-start px-4 py-2 font-medium text-slate-600">{t("common.date")}</th>
                <th className="text-start px-4 py-2 font-medium text-slate-600">{t("appointments.type")}</th>
                <th className="text-start px-4 py-2 font-medium text-slate-600">{t("common.status")}</th>
              </tr></thead>
              <tbody>{items.map((a: any) => {
                const taskStatus: string | undefined = a.task?.status;
                const taskColors: Record<string, string> = {
                  PENDING_APPROVAL: "bg-yellow-100 text-yellow-700",
                  APPROVED: "bg-blue-100 text-blue-700",
                  IN_PROGRESS: "bg-indigo-100 text-indigo-700",
                  COMPLETED: "bg-green-100 text-green-700",
                  POSTPONED: "bg-orange-100 text-orange-700",
                };
                let loc: any = {};
                try { loc = a.urgentLocation ? JSON.parse(a.urgentLocation) : {}; } catch {}
                const displayName = a.customer?.name || [loc.city, loc.district].filter(Boolean).join("، ") || "Urgent Visit";
                const displayPhone = a.customer?.phone || "—";
                return (
                  <tr key={a.id} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium">{displayName}</td>
                    <td className="px-4 py-2.5 text-slate-500">{displayPhone}</td>
                    <td className="px-4 py-2.5">{new Date(a.scheduledDate).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 text-xs font-medium text-slate-600">{a.type}</td>
                    <td className="px-4 py-2.5">
                      {taskStatus ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${taskColors[taskStatus] || "bg-slate-100 text-slate-600"}`}>
                          {taskStatus.replace(/_/g, " ")}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{a.status}</span>
                      )}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0"><tr>
                <th className="text-start px-4 py-2 font-medium text-slate-600">{t("common.name")}</th>
                <th className="text-start px-4 py-2 font-medium text-slate-600">{t("common.phone")}</th>
                <th className="text-start px-4 py-2 font-medium text-slate-600">{t("customers.maintenanceCycle")}</th>
                <th className="text-start px-4 py-2 font-medium text-slate-600">{t("customers.city")}</th>
              </tr></thead>
              <tbody>{items.map((c: any) => (
                <tr key={c.id} className="border-b hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium">{c.name}</td>
                  <td className="px-4 py-2.5 text-slate-500">{c.phone}</td>
                  <td className="px-4 py-2.5 text-xs">{c.maintenanceCycle}</td>
                  <td className="px-4 py-2.5 text-slate-500">{c.address?.city || "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
        {total > 15 && (
          <div className="flex items-center justify-between p-3 border-t text-sm">
            <span className="text-slate-500">{total} {t("common.total")}</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p-1)} className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-slate-50">‹</button>
              <span className="px-2 py-1">{page}/{pages}</span>
              <button disabled={page >= pages} onClick={() => setPage(p => p+1)} className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-slate-50">›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, color, onClick }: { label: string; value: number; color: string; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button onClick={onClick} className={`bg-white rounded-xl p-4 border-s-4 shadow-sm text-start hover:shadow-md hover:-translate-y-0.5 transition-all w-full ${color}`}>
      <p className="text-2xl font-bold text-slate-800">{value ?? "—"}</p>
      <p className="text-slate-500 text-sm mt-1">{label}</p>
      <p className="text-xs text-blue-500 mt-2">{t("dashboard.clickToView")}</p>
    </button>
  );
}

function prevWeekRange() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
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
  const payLabels: Record<string, string> = { CASH: isAr ? "نقداً" : "Cash", BANK_TRANSFER: isAr ? "تحويل بنكي" : "Bank Transfer" };
  const typeLabels: Record<string, string> = { INSTALLATION: isAr ? "تركيب" : "Installation", MAINTENANCE: isAr ? "صيانة" : "Maintenance", VISIT_ONLY: isAr ? "زيارة فقط" : "Visit Only" };
  const headers = isAr
    ? ["#", "اسم العميل", "الجوال", "نوع الخدمة", "التاريخ", "الفني", "طريقة الدفع", "المبلغ (ريال)"]
    : ["#", "Customer", "Phone", "Service Type", "Date", "Technician", "Payment", "Amount (SAR)"];
  const tableRows = rows.map((r, i) => `<tr>
    <td style="text-align:center;color:#888">${i + 1}</td>
    <td>${r.customerName}</td>
    <td>${r.customerPhone}</td>
    <td>${typeLabels[r.appointmentType] || r.appointmentType}</td>
    <td style="white-space:nowrap">${new Date(r.date).toLocaleDateString(isAr ? "ar-SA" : undefined)}</td>
    <td>${r.technicianName}</td>
    <td>${payLabels[r.paymentMethod] || r.paymentMethod}</td>
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
  <div class="print-date">${isAr ? "تاريخ الطباعة" : "Printed"}: ${new Date().toLocaleDateString(isAr ? "ar-SA" : undefined)}</div>
</div>
<table>
  <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
  <tbody>${tableRows || `<tr><td colspan="8" style="text-align:center;color:#bbb;padding:20px">${isAr ? "لا توجد بيانات في هذه الفترة" : "No data for this period"}</td></tr>`}</tbody>
</table>
<div class="grand-box">
  <span class="grand-lbl">${isAr ? "إجمالي المبيعات" : "Total Sales"} &nbsp;·&nbsp; ${rows.length} ${isAr ? "سجل" : "records"}</span>
  <span class="grand-val">${totalAmount.toFixed(2)} <span style="font-size:13px;opacity:0.85">${isAr ? "ريال" : "SAR"}</span></span>
</div>
<div class="ftr">Pure Home System — ${new Date().toLocaleString()}</div>
</div>
</body></html>`;
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const socket = useSocket();
  const [modal, setModal] = useState<{ title: string; endpoint: string } | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [generatingSales, setGeneratingSales] = useState<string | null>(null);

  const { data: stats } = useQuery({ queryKey: ["dashboard-stats"], queryFn: () => api.get("/dashboard/stats").then(r => r.data.data) });
  const { data: activity } = useQuery({ queryKey: ["dashboard-activity"], queryFn: () => api.get("/dashboard/activity").then(r => r.data.data) });

  useEffect(() => {
    if (!socket) return;
    const refresh = () => { qc.invalidateQueries({ queryKey: ["dashboard-stats"] }); qc.invalidateQueries({ queryKey: ["dashboard-activity"] }); };
    socket.on("task:completed", refresh); socket.on("task:approved", refresh); socket.on("task:postponed", refresh);
    socket.on("appointment:created", refresh); socket.on("appointment:deleted", refresh);
    socket.on("customer:created", refresh); socket.on("customer:deleted", refresh); socket.on("customers:bulk-deleted", refresh);
    return () => {
      socket.off("task:completed", refresh); socket.off("task:approved", refresh); socket.off("task:postponed", refresh);
      socket.off("appointment:created", refresh); socket.off("appointment:deleted", refresh);
      socket.off("customer:created", refresh); socket.off("customer:deleted", refresh); socket.off("customers:bulk-deleted", refresh);
    };
  }, [socket, qc]);

  const deleteActivity = useMutation({
    mutationFn: (customerId: string) => api.delete(`/dashboard/activity/${customerId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard-activity"] })
  });

  const clearAllActivity = useMutation({
    mutationFn: () => api.delete("/dashboard/activity"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dashboard-activity"] }); setConfirmClearAll(false); toast.success(t("dashboard.cleared")); }
  });

  const statusColor: Record<string, string> = {
    COMPLETED: "text-green-600 bg-green-50", IN_PROGRESS: "text-blue-600 bg-blue-50",
    POSTPONED: "text-orange-600 bg-orange-50", PENDING_APPROVAL: "text-yellow-600 bg-yellow-50",
    APPROVED: "text-purple-600 bg-purple-50", NO_TASK: "text-slate-400 bg-slate-50"
  };

  const statusLabel: Record<string, string> = {
    COMPLETED: t("tasks.completed"), IN_PROGRESS: t("tasks.inProgress"),
    POSTPONED: t("tasks.postponed"), PENDING_APPROVAL: t("tasks.pendingApproval"),
    APPROVED: t("tasks.approved"), NO_TASK: "—"
  };

  async function generateSalesReport(period: "weekly" | "monthly", format: "pdf" | "excel") {
    const key = `${period}-${format}`;
    setGeneratingSales(key);
    try {
      const isAr = document.documentElement.lang === "ar" || document.documentElement.dir === "rtl";
      const { from, to } = period === "weekly" ? prevWeekRange() : prevMonthRange();
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);

      const periodLabel = period === "weekly"
        ? (isAr
            ? `الأسبوع الماضي: ${from.toLocaleDateString("ar-SA")} — ${to.toLocaleDateString("ar-SA")}`
            : `Previous Week: ${from.toLocaleDateString("en-GB")} — ${to.toLocaleDateString("en-GB")}`)
        : (isAr
            ? `الشهر الماضي: ${from.toLocaleDateString("ar-SA", { month: "long", year: "numeric" })}`
            : `Previous Month: ${from.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`);

      const { data: salesData } = await api.get("/reports/sales", { params: { from: fromStr, to: toStr } });
      const rows: any[] = salesData.data || [];
      const totalAmount: number = salesData.meta?.totalAmount || 0;

      if (format === "pdf") {
        const html = buildSalesPdfHtml(rows, isAr, periodLabel, totalAmount);
        const filePath = await (window as any).electron.printToPDF(html, `sales-${period}-${Date.now()}.pdf`);
        toast.success(`Saved: ${filePath}`);
      } else {
        const XLSX = await import("xlsx");
        const payLabels: Record<string, string> = { CASH: isAr ? "نقداً" : "Cash", BANK_TRANSFER: isAr ? "تحويل بنكي" : "Bank Transfer" };
        const typeLabels: Record<string, string> = { INSTALLATION: isAr ? "تركيب" : "Installation", MAINTENANCE: isAr ? "صيانة" : "Maintenance", VISIT_ONLY: isAr ? "زيارة فقط" : "Visit Only" };
        const excelRows = [
          ...rows.map((r: any) => ({
            [isAr ? "اسم العميل" : "Customer"]: r.customerName,
            [isAr ? "الجوال" : "Phone"]: r.customerPhone,
            [isAr ? "نوع الخدمة" : "Service Type"]: typeLabels[r.appointmentType] || r.appointmentType,
            [isAr ? "التاريخ" : "Date"]: new Date(r.date).toLocaleDateString(),
            [isAr ? "الفني" : "Technician"]: r.technicianName,
            [isAr ? "طريقة الدفع" : "Payment"]: payLabels[r.paymentMethod] || r.paymentMethod,
            [isAr ? "المبلغ (ريال)" : "Amount (SAR)"]: Number(r.amount),
          })),
          {
            [isAr ? "اسم العميل" : "Customer"]: isAr ? "الإجمالي" : "TOTAL",
            [isAr ? "الجوال" : "Phone"]: "", [isAr ? "نوع الخدمة" : "Service Type"]: "",
            [isAr ? "التاريخ" : "Date"]: "", [isAr ? "الفني" : "Technician"]: "",
            [isAr ? "طريقة الدفع" : "Payment"]: "", [isAr ? "المبلغ (ريال)" : "Amount (SAR)"]: totalAmount,
          },
        ];
        const ws = XLSX.utils.json_to_sheet(excelRows);
        ws['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 14 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, isAr ? "المبيعات" : "Sales");
        const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
        const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `sales-${period}-${Date.now()}.xlsx`; a.click();
        URL.revokeObjectURL(url);
        toast.success(isAr ? "تم التنزيل" : "Downloaded");
      }
    } catch {
      toast.error(t("common.error"));
    } finally { setGeneratingSales(null); }
  }

  const cards = [
    { label: t("dashboard.customers"),            key: "total",          endpoint: "customers-list",          color: "border-blue-500" },
    { label: t("dashboard.completedMaintenance"),  key: "completed",      endpoint: "completed-maintenance",   color: "border-green-500" },
    { label: t("dashboard.thisMonth"),             key: "thisMonth",      endpoint: "this-month",              color: "border-indigo-500" },
    { label: t("dashboard.nextMonth"),             key: "nextMonth",      endpoint: "next-month",              color: "border-purple-500" },
    { label: t("dashboard.dueToday"),              key: "todayCount",     endpoint: "today",                   color: "border-orange-500" },
    { label: t("dashboard.suspendedPostponed"),    key: "pending",        endpoint: "postponed",               color: "border-yellow-500" },
    { label: t("dashboard.overdueMaintenance"),    key: "pendingApproval",endpoint: "overdue",                 color: "border-red-500" },
    { label: t("dashboard.urgentAppointments"),    key: "urgentCount",    endpoint: "urgent",                  color: "border-rose-500" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {cards.map(c => (
          <StatCard key={c.key} label={c.label} value={stats?.[c.key]} color={c.color}
            onClick={() => setModal({ title: c.label, endpoint: c.endpoint })} />
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-800">{t("dashboard.recentActivity")}</h3>
          {(activity || []).length > 0 && (
            <button onClick={() => setConfirmClearAll(true)} className="text-xs text-red-500 hover:text-red-700 border border-red-200 px-3 py-1 rounded-lg hover:bg-red-50 transition-colors">
              {t("dashboard.clearAll")}
            </button>
          )}
        </div>
        <div className="space-y-1">
          {(activity || []).length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-6">{t("dashboard.noRecentActivity")}</p>
          ) : (activity || []).map((a: any) => (
            <div key={a.customerId} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-slate-50 group">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-sm flex-shrink-0">
                  {a.customerName?.[0]}
                </div>
                <div>
                  <p className="font-medium text-sm text-slate-800">{a.customerName}</p>
                  <p className="text-xs text-slate-400">{a.phone}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColor[a.status] || ""}`}>
                  {statusLabel[a.status] || a.status.replace(/_/g, " ")}
                </span>
                <button onClick={() => deleteActivity.mutate(a.customerId)}
                  className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded hover:bg-red-100 text-red-400 hover:text-red-600 text-xs flex items-center justify-center transition-all">
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sales Reports */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <h3 className="font-semibold text-slate-800 mb-3">
          {t ? (document.documentElement.dir === "rtl" ? "تقارير المبيعات" : "Sales Reports") : "Sales Reports"}
        </h3>
        <p className="text-xs text-slate-400 mb-3">
          {document.documentElement.dir === "rtl"
            ? "تقارير الأسبوع والشهر الماضيَين — كاملة فقط"
            : "Previous complete week & month reports only"}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <button onClick={() => generateSalesReport("weekly", "pdf")} disabled={generatingSales !== null}
            style={{ backgroundColor: "#000080" }}
            className="text-white text-xs px-3 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1">
            {generatingSales === "weekly-pdf" ? "..." : "📄 " + (document.documentElement.dir === "rtl" ? "PDF أسبوعي" : "Weekly PDF")}
          </button>
          <button onClick={() => generateSalesReport("monthly", "pdf")} disabled={generatingSales !== null}
            style={{ backgroundColor: "#000080" }}
            className="text-white text-xs px-3 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1">
            {generatingSales === "monthly-pdf" ? "..." : "📄 " + (document.documentElement.dir === "rtl" ? "PDF شهري" : "Monthly PDF")}
          </button>
          <button onClick={() => generateSalesReport("weekly", "excel")} disabled={generatingSales !== null}
            className="bg-green-700 text-white text-xs px-3 py-2 rounded-lg hover:bg-green-800 disabled:opacity-50 flex items-center justify-center gap-1">
            {generatingSales === "weekly-excel" ? "..." : "📊 " + (document.documentElement.dir === "rtl" ? "Excel أسبوعي" : "Weekly Excel")}
          </button>
          <button onClick={() => generateSalesReport("monthly", "excel")} disabled={generatingSales !== null}
            className="bg-green-700 text-white text-xs px-3 py-2 rounded-lg hover:bg-green-800 disabled:opacity-50 flex items-center justify-center gap-1">
            {generatingSales === "monthly-excel" ? "..." : "📊 " + (document.documentElement.dir === "rtl" ? "Excel شهري" : "Monthly Excel")}
          </button>
        </div>
      </div>

      {modal && <DrillModal title={modal.title} endpoint={modal.endpoint} onClose={() => setModal(null)} />}

      {confirmClearAll && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-80 shadow-xl">
            <h3 className="font-semibold mb-2">{t("dashboard.clearAllConfirm")}</h3>
            <p className="text-sm text-slate-500 mb-4">{t("dashboard.clearAllDesc")}</p>
            <div className="flex gap-2">
              <button onClick={() => clearAllActivity.mutate()} disabled={clearAllActivity.isPending}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">
                {clearAllActivity.isPending ? t("common.loading") : t("dashboard.clearAll")}
              </button>
              <button onClick={() => setConfirmClearAll(false)} className="flex-1 border py-2 rounded-lg text-sm hover:bg-slate-50">{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}