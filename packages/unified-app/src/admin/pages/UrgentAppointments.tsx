import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import toast from "react-hot-toast";

type Tab = "list" | "records";

const EMPTY_FORM = {
  scheduledDate: "", city: "", district: "", street: "",
  postalCode: "", buildingNo: "", floorNo: "", apartmentNo: "", notes: "",
};

export default function UrgentAppointments() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("list");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  useEffect(() => {
    window.dispatchEvent(new Event("clear-badge-urgent-admin"));
  }, []);

  const { data: apptData, isLoading: apptLoading } = useQuery({
    queryKey: ["urgent-appointments"],
    queryFn: () => api.get("/appointments", { params: { urgent: "true", limit: 200 } })
      .then(r => (r.data.data || []).filter((a: any) => a.createdByRole === 'ADMIN' || !a.createdByRole)),
  });

  const { data: visitData, isLoading: visitLoading } = useQuery({
    queryKey: ["urgent-visit-records"],
    queryFn: () => api.get("/urgent-visits").then(r => r.data.data || []),
    enabled: tab === "records",
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post("/appointments", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["urgent-appointments"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success(isAr ? "تم إنشاء الموعد العاجل" : "Urgent appointment created");
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
    },
    onError: () => toast.error(t("common.error")),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/appointments/${id}/approve-visibility`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["urgent-appointments"] });
      toast.success(isAr ? "تم إظهار الموعد للجدولة" : "Appointment visible to Scheduling");
    },
    onError: () => toast.error(t("common.error")),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.scheduledDate || !form.city || !form.district || !form.street) {
      toast.error(isAr ? "الحقول المطلوبة: المدينة، الحي، الشارع، التاريخ" : "Required: City, District, Street, Date");
      return;
    }
    const urgentLocation = JSON.stringify({
      city: form.city, district: form.district, street: form.street,
      postalCode: form.postalCode, buildingNo: form.buildingNo,
      floorNo: form.floorNo, apartmentNo: form.apartmentNo,
    });
    createMutation.mutate({
      scheduledDate: form.scheduledDate,
      type: "MAINTENANCE",
      notes: form.notes || undefined,
      urgentLocation,
      isUrgent: true,
      visibleToScheduling: false,
    });
  }

  function parseLocation(locStr: string | null | undefined) {
    if (!locStr) return null;
    try { return JSON.parse(locStr); } catch { return { city: locStr }; }
  }

  function locationText(a: any) {
    const loc = parseLocation(a.urgentLocation);
    if (!loc) return a.notes || "—";
    return [loc.city, loc.district, loc.street, loc.buildingNo].filter(Boolean).join("، ");
  }

  const PAYMENT_LABELS: Record<string, string> = {
    CASH: isAr ? "نقداً" : "Cash",
    BANK_TRANSFER: isAr ? "تحويل بنكي" : "Bank Transfer",
  };

  const SERVICE_LABELS: Record<string, string> = {
    INSTALLATION: isAr ? "تركيب" : "Installation",
    MAINTENANCE: isAr ? "صيانة" : "Maintenance",
    VISIT_ONLY: isAr ? "زيارة فقط" : "Visit Only",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">{t("urgentAppts.title")}</h1>
        <button onClick={() => setShowForm(v => !v)}
          style={{ backgroundColor: "#000080" }}
          className="text-white text-sm px-4 py-2 rounded-lg hover:opacity-90">
          🚨 {t("urgentAppts.newUrgent")}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold text-slate-700 mb-4">{t("urgentAppts.newUrgent")}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("common.date")} *</label>
              <input type="datetime-local" required value={form.scheduledDate}
                onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.city")} *</label>
                <input required value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.district")} *</label>
                <input required value={form.district} onChange={e => setForm(f => ({ ...f, district: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.street")} *</label>
                <input required value={form.street} onChange={e => setForm(f => ({ ...f, street: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.postalCode")}</label>
                <input value={form.postalCode} onChange={e => setForm(f => ({ ...f, postalCode: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.buildingNo")}</label>
                <input value={form.buildingNo} onChange={e => setForm(f => ({ ...f, buildingNo: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.floorNo")}</label>
                <input value={form.floorNo} onChange={e => setForm(f => ({ ...f, floorNo: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.apartmentNo")}</label>
                <input value={form.apartmentNo} onChange={e => setForm(f => ({ ...f, apartmentNo: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("common.notes")}</label>
                <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50">{t("common.cancel")}</button>
              <button type="submit" disabled={createMutation.isPending}
                style={{ backgroundColor: "#000080" }}
                className="text-white text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50">
                {createMutation.isPending ? "..." : t("urgentAppts.sendToTech")}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="flex gap-2 border-b pb-1">
        {(["list", "records"] as Tab[]).map(t2 => (
          <button key={t2} onClick={() => setTab(t2)}
            className={`px-4 py-2 text-sm rounded-t-lg font-medium transition-colors ${tab === t2 ? "bg-white border border-b-white text-slate-800" : "text-slate-500 hover:text-slate-700"}`}>
            {t2 === "list" ? (isAr ? "المواعيد العاجلة" : "Urgent Appointments") : (isAr ? "سجلات الزيارات" : "Visit Records")}
          </button>
        ))}
      </div>

      {tab === "list" && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {apptLoading ? (
            <p className="text-center py-10 text-slate-400">{t("common.loading")}</p>
          ) : !(apptData?.length) ? (
            <p className="text-center py-10 text-slate-400">{t("urgentAppts.noRecords")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-start px-4 py-3 font-medium text-slate-600">{isAr ? "الموقع" : "Location"}</th>
                    <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.date")}</th>
                    <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.notes")}</th>
                    <th className="text-start px-4 py-3 font-medium text-slate-600">{isAr ? "الرؤية" : "Visibility"}</th>
                    <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {apptData.map((a: any) => (
                    <tr key={a.id} className="border-b hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-sm">{locationText(a)}</div>
                        {a.urgentLocation && (() => {
                          const loc = parseLocation(a.urgentLocation);
                          if (!loc) return null;
                          return (
                            <div className="text-xs text-slate-400 mt-0.5">
                              {[loc.buildingNo && `${isAr ? "م" : "B"}${loc.buildingNo}`, loc.floorNo && `${isAr ? "ط" : "F"}${loc.floorNo}`, loc.apartmentNo && `${isAr ? "ش" : "A"}${loc.apartmentNo}`].filter(Boolean).join(" | ")}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{new Date(a.scheduledDate).toLocaleString(isAr ? "ar-SA" : undefined)}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs max-w-[180px] truncate">{a.notes || "—"}</td>
                      <td className="px-4 py-3">
                        {a.visibleToScheduling ? (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{t("urgentAppts.approved")}</span>
                        ) : (
                          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">{t("urgentAppts.hidden")}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {!a.visibleToScheduling && (
                          <button onClick={() => approveMutation.mutate(a.id)} disabled={approveMutation.isPending}
                            className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                            {t("urgentAppts.approve")}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "records" && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {visitLoading ? (
            <p className="text-center py-10 text-slate-400">{t("common.loading")}</p>
          ) : !(visitData?.length) ? (
            <p className="text-center py-10 text-slate-400">{t("urgentAppts.noRecords")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-start px-4 py-3 font-medium text-slate-600">{t("urgentAppts.customerName")}</th>
                    <th className="text-start px-4 py-3 font-medium text-slate-600">{t("urgentAppts.customerPhone")}</th>
                    <th className="text-start px-4 py-3 font-medium text-slate-600">{t("urgentAppts.serviceType")}</th>
                    <th className="text-start px-4 py-3 font-medium text-slate-600">{t("urgentAppts.paymentMethod")}</th>
                    <th className="text-start px-4 py-3 font-medium text-slate-600">{t("urgentAppts.amount")}</th>
                    <th className="text-start px-4 py-3 font-medium text-slate-600">{isAr ? "الفني" : "Technician"}</th>
                    <th className="text-start px-4 py-3 font-medium text-slate-600">{t("common.date")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visitData.map((v: any) => (
                    <tr key={v.id} className="border-b hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium">{v.customerName || v.appointment?.customer?.name || "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{v.customerPhone || "—"}</td>
                      <td className="px-4 py-3 text-xs font-medium">
                        {v.serviceType ? (SERVICE_LABELS[v.serviceType] || v.serviceType) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          v.paymentMethod === "CASH" ? "bg-green-100 text-green-700" :
                          v.paymentMethod === "BANK_TRANSFER" ? "bg-blue-100 text-blue-700" :
                          "bg-slate-100 text-slate-600"}`}>
                          {PAYMENT_LABELS[v.paymentMethod] || v.paymentMethod}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-800">{v.amount != null ? `${v.amount.toFixed(2)}` : "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{v.submittedBy?.name || "—"}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">{new Date(v.createdAt).toLocaleDateString(isAr ? "ar-SA" : undefined)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
