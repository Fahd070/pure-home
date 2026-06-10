import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";

function formatCycle(cycle: string, freq: number, t: any) {
  const n = Number(freq) || 1;
  if (cycle === "DAILY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.day") : t("customers.days")}`;
  if (cycle === "WEEKLY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.week") : t("customers.weeks")}`;
  if (cycle === "MONTHLY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.month") : t("customers.months")}`;
  return cycle;
}

function MaintenanceBadge({ c, t }: { c: any; t: any }) {
  if (c.alertLevel === "overdue") return (
    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
      🔴 {t("countdown.overdueBy", { days: c.overdueCount })}
    </span>
  );
  if (c.alertLevel === "soon") {
    const label = c.daysUntil === 0 ? t("countdown.dueToday") : c.daysUntil === 1 ? t("countdown.dueTomorrow") : t("countdown.dueIn", { days: c.daysUntil });
    return (
      <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
        🟡 {label}
      </span>
    );
  }
  if (c.daysUntil !== null) return (
    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full whitespace-nowrap">
      🟢 {t("countdown.dueIn", { days: c.daysUntil })}
    </span>
  );
  return null;
}

async function exportCustomerPdf(c: any, isAr: boolean, t: any) {
  const dir = isAr ? "rtl" : "ltr";
  const fmtCycle = (cycle: string, freq: number) => {
    const n = Number(freq) || 1;
    if (cycle === "DAILY") return (isAr ? `كل ${n} يوم` : `Every ${n} day${n > 1 ? "s" : ""}`);
    if (cycle === "WEEKLY") return (isAr ? `كل ${n} أسبوع` : `Every ${n} week${n > 1 ? "s" : ""}`);
    if (cycle === "MONTHLY") return (isAr ? `كل ${n} شهر` : `Every ${n} month${n > 1 ? "s" : ""}`);
    return cycle;
  };
  const html = `<!DOCTYPE html><html dir="${dir}" lang="${isAr ? "ar" : "en"}"><head><meta charset="UTF-8">
<style>
body{font-family:Tahoma,Arial,sans-serif;margin:24px;font-size:12px;direction:${dir};color:#333}
.hdr{border-bottom:3px solid #000080;margin-bottom:14px;padding-bottom:10px}
.brand{font-size:18px;font-weight:bold;color:#000080}
.cname{font-size:16px;font-weight:bold;margin:8px 0 4px}
.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:bold}
.badge-ok{background:#dcfce7;color:#166534}.badge-soon{background:#fef3c7;color:#92400e}.badge-overdue{background:#fee2e2;color:#991b1b}
.sec{margin-top:14px}.sec-t{font-weight:bold;color:#000080;border-bottom:1px solid #ddd;padding-bottom:4px;margin-bottom:8px;font-size:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.lbl{color:#888;font-size:9px;margin-bottom:2px}.val{font-size:11px;font-weight:500}
.ftr{margin-top:20px;border-top:1px solid #eee;padding-top:8px;color:#999;font-size:9px;text-align:center}
</style></head><body>
<div class="hdr"><div class="brand">Pure Home</div><div style="color:#666;font-size:10px">${new Date().toLocaleDateString(isAr ? "ar-SA" : undefined)}</div></div>
<div class="cname">${c.name}</div>
<span class="badge badge-${c.alertLevel || "ok"}">${c.alertLevel === "overdue" ? (isAr ? "متأخر" : "Overdue") : c.alertLevel === "soon" ? (isAr ? "قادم قريباً" : "Upcoming Soon") : (isAr ? "طبيعي" : "OK")}</span>
<div class="sec"><div class="sec-t">${isAr ? "معلومات التواصل" : "Contact Info"}</div>
<div class="grid">
<div><div class="lbl">${isAr ? "الجوال" : "Phone"}</div><div class="val">${c.phone}</div></div>
<div><div class="lbl">${isAr ? "المدينة" : "City"}</div><div class="val">${c.address?.city || "—"}</div></div>
<div><div class="lbl">${isAr ? "الحي" : "District"}</div><div class="val">${c.address?.district || "—"}</div></div>
<div><div class="lbl">${isAr ? "الشارع" : "Street"}</div><div class="val">${c.address?.street || "—"}</div></div>
</div></div>
<div class="sec"><div class="sec-t">${isAr ? "معلومات الصيانة" : "Maintenance Info"}</div>
<div class="grid">
<div><div class="lbl">${isAr ? "تاريخ التسجيل" : "Registered"}</div><div class="val">${new Date(c.createdAt).toLocaleDateString(isAr ? "ar-SA" : undefined)}</div></div>
<div><div class="lbl">${isAr ? "دورة الصيانة" : "Cycle"}</div><div class="val">${fmtCycle(c.maintenanceCycle, c.maintenanceFrequency)}</div></div>
<div><div class="lbl">${isAr ? "آخر صيانة" : "Last Maintenance"}</div><div class="val">${c.lastMaintenance ? new Date(c.lastMaintenance).toLocaleDateString(isAr ? "ar-SA" : undefined) : "—"}</div></div>
<div><div class="lbl">${isAr ? "الصيانة القادمة" : "Next Maintenance"}</div><div class="val">${c.nextMaintenance ? new Date(c.nextMaintenance).toLocaleDateString(isAr ? "ar-SA" : undefined) : "—"}</div></div>
</div></div>
${c.notes ? `<div class="sec"><div class="sec-t">${isAr ? "ملاحظات" : "Notes"}</div><p style="font-size:11px;margin:0">${c.notes}</p></div>` : ""}
<div class="ftr">Pure Home System — ${new Date().toLocaleString()}</div>
</body></html>`;
  const filePath = await (window as any).electron.printToPDF(html, `customer-${c.id}-${Date.now()}.pdf`);
  return filePath;
}

export default function Customers() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const socket = useSocket();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState("");
  const [exportingXlsx, setExportingXlsx] = useState(false);

  useEffect(() => {
    window.dispatchEvent(new Event("clear-badge-customers-admin"));
  }, []);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    };
    socket.on("customer:created", refresh);
    socket.on("customer:updated", refresh);
    socket.on("customers:bulk-deleted", refresh);
    socket.on("customer:deleted", refresh);
    return () => {
      socket.off("customer:created", refresh);
      socket.off("customer:updated", refresh);
      socket.off("customers:bulk-deleted", refresh);
      socket.off("customer:deleted", refresh);
    };
  }, [socket, qc]);

  const { data, isLoading } = useQuery({
    queryKey: ["customers", search, page],
    queryFn: () => api.get("/customers", { params: { search, page, limit: 20, includeSchedule: true } }).then(r => r.data)
  });

  const toggle = useMutation({
    mutationFn: (id: string) => api.patch(`/customers/${id}/toggle-active`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customers"] }); toast.success(t("common.success")); }
  });

  const deleteCustomer = useMutation({
    mutationFn: (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      qc.invalidateQueries({ queryKey: ["dashboard-activity"] });
      toast.success(t("customers.deleted"));
      setDeleteTarget(null);
    },
    onError: () => toast.error(t("common.error"))
  });

  async function exportAllToExcel() {
    setExportingXlsx(true);
    try {
      const { data: resp } = await api.get("/customers", { params: { limit: 2000, includeSchedule: true } });
      const all: any[] = resp.data || [];
      const XLSX = await import("xlsx");
      const rows = all.map((c: any) => ({
        [isAr ? "الاسم" : "Name"]: c.name,
        [isAr ? "الجوال" : "Phone"]: c.phone,
        [isAr ? "المدينة" : "City"]: c.address?.city || "",
        [isAr ? "الحي" : "District"]: c.address?.district || "",
        [isAr ? "الشارع" : "Street"]: c.address?.street || "",
        [isAr ? "تاريخ التسجيل" : "Reg. Date"]: new Date(c.createdAt).toLocaleDateString(),
        [isAr ? "تاريخ التركيب" : "Install Date"]: c.installationDate ? new Date(c.installationDate).toLocaleDateString() : "",
        [isAr ? "دورة الصيانة" : "Cycle"]: formatCycle(c.maintenanceCycle, c.maintenanceFrequency, t),
        [isAr ? "آخر صيانة" : "Last Maint."]: c.lastMaintenance ? new Date(c.lastMaintenance).toLocaleDateString() : "",
        [isAr ? "الصيانة القادمة" : "Next Maint."]: c.nextMaintenance ? new Date(c.nextMaintenance).toLocaleDateString() : "",
        [isAr ? "الحالة" : "Status"]: c.isActive ? (isAr ? "نشط" : "Active") : (isAr ? "غير نشط" : "Inactive"),
        [isAr ? "ملاحظات" : "Notes"]: c.notes || "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, isAr ? "العملاء" : "Customers");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `customers-${new Date().toISOString().slice(0,10)}.xlsx`; a.click();
      URL.revokeObjectURL(url);
      toast.success(t("reports.savedTo"));
    } catch {
      toast.error(t("common.error"));
    } finally { setExportingXlsx(false); }
  }

  const deleteAllCustomers = useMutation({
    mutationFn: () => api.delete("/customers"),
    onSuccess: (res) => {
      const count = res.data.data.count;
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      qc.invalidateQueries({ queryKey: ["dashboard-activity"] });
      toast.success(`${count} ${t("customers.allDeleted")}`);
      setShowDeleteAll(false);
      setDeleteAllConfirmText("");
    },
    onError: () => toast.error(t("common.error"))
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder={t("common.search")}
          className="border rounded-lg px-3 py-2 flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={() => navigate("/admin/customers/add")} style={{ backgroundColor: "#000080" }} className="text-white px-4 py-2 rounded-lg hover:opacity-90 text-sm font-medium">
          + {t("customers.add")}
        </button>
        {(data?.meta?.total ?? 0) > 0 && (
          <>
            <button onClick={exportAllToExcel} disabled={exportingXlsx}
              className="text-sm bg-green-700 text-white px-3 py-2 rounded-lg hover:bg-green-800 disabled:opacity-50 font-medium">
              📊 {exportingXlsx ? t("reports.generating") : t("reports.exportCustomers")}
            </button>
            <button onClick={() => { setShowDeleteAll(true); setDeleteAllConfirmText(""); }}
              className="text-xs text-red-600 border border-red-300 px-3 py-2 rounded-lg hover:bg-red-50 transition-colors font-medium">
              🗑 {t("customers.deleteAll")}
            </button>
          </>
        )}
      </div>
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? <p className="text-center py-8 text-slate-400">{t("common.loading")}</p> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-start px-4 py-3">{t("common.name")}</th>
                <th className="text-start px-4 py-3">{t("common.phone")}</th>
                <th className="text-start px-4 py-3">{t("customers.maintenanceCycle")}</th>
                <th className="text-start px-4 py-3">{t("reports.installationDate")}</th>
                <th className="text-start px-4 py-3">{t("reports.lastMaintenance")}</th>
                <th className="text-start px-4 py-3">{t("reports.nextMaintenance")}</th>
                <th className="text-start px-4 py-3">{t("common.status")}</th>
                <th className="text-start px-4 py-3">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.data || []).map((c: any) => (
                <tr key={c.id} className="border-b hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium cursor-pointer text-blue-700 hover:underline" onClick={() => navigate(`/admin/customers/${c.id}`)}>{c.name}</td>
                  <td className="px-4 py-3">{c.phone}</td>
                  <td className="px-4 py-3 text-xs font-medium text-slate-600">{formatCycle(c.maintenanceCycle, c.maintenanceFrequency, t)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {c.installationDate ? new Date(c.installationDate).toLocaleDateString(isAr ? "ar-SA" : undefined) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {c.lastMaintenance ? new Date(c.lastMaintenance).toLocaleDateString(isAr ? "ar-SA" : undefined) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <MaintenanceBadge c={c} t={t} />
                      {c.nextMaintenance && (
                        <p className="text-xs text-slate-400">{new Date(c.nextMaintenance).toLocaleDateString(isAr ? "ar-SA" : undefined)}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${c.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                      {c.isActive ? t("common.active") : t("common.inactive")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => toggle.mutate(c.id)} className="text-xs text-slate-500 hover:text-slate-700">{t("customers.toggleActive")}</button>
                      <button onClick={() => {
                        exportCustomerPdf(c, isAr, t)
                          .then(fp => toast.success(`${t("reports.savedTo")}: ${fp}`))
                          .catch(() => toast.error(t("common.error")));
                      }} className="text-xs text-blue-600 hover:text-blue-800">📄</button>
                      <button onClick={() => setDeleteTarget({ id: c.id, name: c.name })}
                        className="text-xs text-red-500 hover:text-red-700 border border-red-200 px-2 py-0.5 rounded hover:bg-red-50">
                        {t("common.delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data?.meta && (
        <div className="flex justify-center gap-2">
          <button disabled={page === 1} onClick={() => setPage(p => p-1)} className="px-3 py-1 text-sm border rounded disabled:opacity-40">‹</button>
          <span className="px-3 py-1 text-sm">{page} / {Math.ceil(data.meta.total / 20) || 1}</span>
          <button disabled={page * 20 >= data.meta.total} onClick={() => setPage(p => p+1)} className="px-3 py-1 text-sm border rounded disabled:opacity-40">›</button>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-80 shadow-xl">
            <h3 className="font-semibold mb-2 text-red-700">{t("customers.deleteCustomer")}</h3>
            <p className="text-sm text-slate-600 mb-1">{t("customers.deleteConfirm")}</p>
            <p className="font-bold text-slate-800 mb-4">"{deleteTarget.name}"</p>
            <p className="text-xs text-slate-400 mb-4">{t("customers.deleteWarning")}</p>
            <div className="flex gap-2">
              <button onClick={() => deleteCustomer.mutate(deleteTarget.id)} disabled={deleteCustomer.isPending}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">
                {deleteCustomer.isPending ? t("customers.deleting") : t("customers.yesDelete")}
              </button>
              <button onClick={() => setDeleteTarget(null)} className="flex-1 border py-2 rounded-lg text-sm hover:bg-slate-50">{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}

      {showDeleteAll && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-96 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center text-red-600 text-lg">⚠️</div>
              <div>
                <h3 className="font-bold text-red-700">{t("customers.deleteAllTitle")}</h3>
                <p className="text-xs text-slate-500">{data?.meta?.total ?? 0} {t("customers.willBeDeleted")}</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 mb-3">{t("customers.deleteAllWarning")}</p>
            <p className="text-sm font-medium text-slate-700 mb-2">{t("customers.typeDeleteToConfirm")}</p>
            <input
              value={deleteAllConfirmText}
              onChange={e => setDeleteAllConfirmText(e.target.value)}
              placeholder="DELETE"
              className="w-full border-2 border-red-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500 mb-4 font-mono"
            />
            <div className="flex gap-2">
              <button
                onClick={() => deleteAllCustomers.mutate()}
                disabled={deleteAllConfirmText !== "DELETE" || deleteAllCustomers.isPending}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium">
                {deleteAllCustomers.isPending ? t("customers.deleting") : t("customers.deleteAllConfirmBtn")}
              </button>
              <button onClick={() => { setShowDeleteAll(false); setDeleteAllConfirmText(""); }} className="flex-1 border py-2 rounded-lg text-sm hover:bg-slate-50">{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
