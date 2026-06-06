import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import toast from "react-hot-toast";

function formatCycle(cycle: string, freq: number, isAr: boolean) {
  const n = Number(freq) || 1;
  if (cycle === "DAILY") return isAr ? `كل ${n} يوم` : `Every ${n} day${n > 1 ? "s" : ""}`;
  if (cycle === "WEEKLY") return isAr ? `كل ${n} أسبوع` : `Every ${n} week${n > 1 ? "s" : ""}`;
  if (cycle === "MONTHLY") return isAr ? `كل ${n} شهر` : `Every ${n} month${n > 1 ? "s" : ""}`;
  return cycle;
}

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["customer", id], queryFn: () => api.get(`/customers/${id}`).then(r => r.data.data) });

  if (isLoading) return <p className="text-center py-12">{t("common.loading")}</p>;
  if (!data) return <p className="text-center py-12">{t("common.error")}</p>;

  const c = data;
  const addr = c.address;

  async function handleExportPdf() {
    const dir = isAr ? "rtl" : "ltr";
    const apptRows = (c.appointments || []).map((a: any) => `
      <tr>
        <td>${new Date(a.scheduledDate).toLocaleDateString(isAr ? "ar-SA" : undefined)}</td>
        <td>${a.type === "INSTALLATION" ? (isAr ? "تركيب" : "Installation") : (isAr ? "صيانة" : "Maintenance")}</td>
        <td>${a.status}</td>
        <td>${a.task?.technician?.name || "—"}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html><html dir="${dir}" lang="${isAr ? "ar" : "en"}"><head><meta charset="UTF-8">
<style>
body{font-family:Tahoma,Arial,sans-serif;margin:24px;font-size:12px;direction:${dir};color:#333}
.hdr{border-bottom:3px solid #000080;margin-bottom:14px;padding-bottom:10px}
.brand{font-size:18px;font-weight:bold;color:#000080}
.cname{font-size:16px;font-weight:bold;margin:8px 0 4px}
.active-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:bold;background:#dcfce7;color:#166534}
.inactive-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:bold;background:#f1f5f9;color:#64748b}
.sec{margin-top:14px}.sec-t{font-weight:bold;color:#000080;border-bottom:1px solid #ddd;padding-bottom:4px;margin-bottom:8px;font-size:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.lbl{color:#888;font-size:9px;margin-bottom:2px}.val{font-size:11px;font-weight:500}
table{width:100%;border-collapse:collapse;font-size:10px;margin-top:4px}
th{background:#000080;color:#fff;padding:5px 8px;text-align:${dir === "rtl" ? "right" : "left"}}
td{padding:4px 8px;border-bottom:1px solid #eee}
tr:nth-child(even){background:#f9f9f9}
.ftr{margin-top:20px;border-top:1px solid #eee;padding-top:8px;color:#999;font-size:9px;text-align:center}
</style></head><body>
<div class="hdr"><div class="brand">Pure Home</div><div style="color:#666;font-size:10px">${new Date().toLocaleDateString(isAr ? "ar-SA" : undefined)}</div></div>
<div class="cname">${c.name}</div>
<span class="${c.isActive ? "active-badge" : "inactive-badge"}">${c.isActive ? (isAr ? "نشط" : "Active") : (isAr ? "غير نشط" : "Inactive")}</span>
<div class="sec"><div class="sec-t">${isAr ? "معلومات التواصل" : "Contact Info"}</div>
<div class="grid">
<div><div class="lbl">${isAr ? "الجوال" : "Phone"}</div><div class="val">${c.phone}</div></div>
<div><div class="lbl">${isAr ? "المدينة" : "City"}</div><div class="val">${addr?.city || "—"}</div></div>
<div><div class="lbl">${isAr ? "الحي" : "District"}</div><div class="val">${addr?.district || "—"}</div></div>
<div><div class="lbl">${isAr ? "الشارع" : "Street"}</div><div class="val">${addr?.street || "—"}</div></div>
${addr?.buildingNo ? `<div><div class="lbl">${isAr ? "رقم المبنى" : "Building"}</div><div class="val">${addr.buildingNo}${addr.floorNo ? ` — ${isAr ? "طابق" : "Floor"} ${addr.floorNo}` : ""}</div></div>` : ""}
</div></div>
<div class="sec"><div class="sec-t">${isAr ? "معلومات الصيانة" : "Maintenance Info"}</div>
<div class="grid">
<div><div class="lbl">${isAr ? "تاريخ التسجيل" : "Registered"}</div><div class="val">${new Date(c.createdAt).toLocaleDateString(isAr ? "ar-SA" : undefined)}</div></div>
<div><div class="lbl">${isAr ? "دورة الصيانة" : "Cycle"}</div><div class="val">${formatCycle(c.maintenanceCycle, c.maintenanceFrequency, isAr)}</div></div>
</div></div>
${c.notes ? `<div class="sec"><div class="sec-t">${isAr ? "ملاحظات" : "Notes"}</div><p style="font-size:11px;margin:0">${c.notes}</p></div>` : ""}
${(c.appointments || []).length > 0 ? `
<div class="sec"><div class="sec-t">${isAr ? "سجل المواعيد" : "Appointment History"}</div>
<table><thead><tr>
<th>${isAr ? "التاريخ" : "Date"}</th><th>${isAr ? "النوع" : "Type"}</th><th>${isAr ? "الحالة" : "Status"}</th><th>${isAr ? "الفني" : "Technician"}</th>
</tr></thead><tbody>${apptRows}</tbody></table></div>` : ""}
<div class="ftr">Pure Home System — ${new Date().toLocaleString()}</div>
</body></html>`;

    try {
      const filePath = await (window as any).electron.printToPDF(html, `customer-${c.id}-detail-${Date.now()}.pdf`);
      toast.success(`${t("reports.savedTo")}: ${filePath}`);
    } catch {
      toast.error(t("common.error"));
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="text-slate-500 hover:text-slate-700">← {t("common.back")}</button>
        <button onClick={handleExportPdf}
          style={{ backgroundColor: "#000080" }}
          className="text-white text-sm px-4 py-1.5 rounded-lg hover:opacity-90 flex items-center gap-1.5">
          📄 {t("reports.exportCustomerPdf")}
        </button>
      </div>
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold">{c.name}</h2>
            <p className="text-slate-500">{c.phone}</p>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${c.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
            {c.isActive ? t("common.active") : t("common.inactive")}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-slate-400">{t("customers.maintenanceCycle")}: </span>{c.maintenanceCycle}</div>
          <div><span className="text-slate-400">{t("customers.frequency")}: </span>{c.maintenanceFrequency}</div>
        </div>
        {addr && (
          <div className="mt-4 p-3 bg-slate-50 rounded-lg text-sm">
            <p className="font-medium mb-1">{t("customers.address")}</p>
            <p>{addr.city}، {addr.district}، {addr.street}</p>
            {addr.buildingNo && <p>{t("customers.buildingNo")}: {addr.buildingNo} {addr.floorNo && `| ${t("customers.floorNo")}: ${addr.floorNo}`}</p>}
          </div>
        )}
        {c.notes && <p className="mt-3 text-sm text-slate-500">{c.notes}</p>}
      </div>
      {c.appointments?.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h3 className="font-semibold mb-3">{t("nav.appointments")}</h3>
          <div className="space-y-2">
            {c.appointments.map((a: any) => (
              <div key={a.id} className="flex justify-between text-sm py-2 border-b last:border-0">
                <span>{new Date(a.scheduledDate).toLocaleDateString()} — {a.type}</span>
                <span className="text-slate-500">{a.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
