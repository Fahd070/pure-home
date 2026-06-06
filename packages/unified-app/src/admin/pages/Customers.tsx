import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
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
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    window.dispatchEvent(new Event("clear-badge-customers-admin"));
  }, []);

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

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder={t("common.search")}
          className="border rounded-lg px-3 py-2 flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={() => navigate("/admin/customers/add")} style={{ backgroundColor: "#000080" }} className="text-white px-4 py-2 rounded-lg hover:opacity-90 text-sm font-medium">
          + {t("customers.add")}
        </button>
      </div>
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? <p className="text-center py-8 text-slate-400">{t("common.loading")}</p> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-start px-4 py-3">{t("common.name")}</th>
                <th className="text-start px-4 py-3">{t("common.phone")}</th>
                <th className="text-start px-4 py-3">{t("customers.maintenanceCycle")}</th>
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
    </div>
  );
}
