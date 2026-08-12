import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";
import { dateOnlyToApiDate, formatGregorianDate, formatGregorianTime } from "../../utils/dateTimeInput";
import { isValidPrimaryPhone } from "../../utils/phone";

type Tab = "list" | "records";

const EMPTY_FORM = {
  date: "", customerName: "", customerPhone: "", city: "", district: "", street: "",
  postalCode: "", buildingNo: "", floorNo: "", apartmentNo: "", notes: "",
};

export default function UrgentAppointments() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const socket = useSocket();
  const [tab, setTab] = useState<Tab>("list");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [visitDetail, setVisitDetail] = useState<any | null>(null);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["urgent-appointments"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    };
    socket.on("appointment:deleted", refresh);
    socket.on("appointment:created", refresh);
    return () => {
      socket.off("appointment:deleted", refresh);
      socket.off("appointment:created", refresh);
    };
  }, [socket, qc]);

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
    onError: (err: any) => toast.error(err?.response?.data?.message || t("common.error")),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/appointments/${id}/approve-visibility`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["urgent-appointments"] });
      toast.success(isAr ? "تم إظهار الموعد للجدولة" : "Appointment visible to Scheduling");
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || t("common.error")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/appointments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["urgent-appointments"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success(isAr ? "تم حذف الموعد العاجل" : "Urgent appointment deleted");
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || t("common.error")),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const scheduledDate = dateOnlyToApiDate(form.date);
    const customerName = form.customerName.trim();
    const customerPhone = form.customerPhone.trim();
    if (!scheduledDate || !form.city || !form.district || !form.street) {
      toast.error(isAr ? "الحقول المطلوبة: المدينة، الحي، الشارع، التاريخ" : "Required: City, District, Street, Date");
      return;
    }
    if (!customerName) {
      toast.error(isAr ? "اسم العميل مطلوب" : "Customer name is required");
      return;
    }
    if (!isValidPrimaryPhone(customerPhone)) {
      toast.error(t("customers.phoneInvalid"));
      return;
    }
    const urgentLocation = JSON.stringify({
      city: form.city, district: form.district, street: form.street,
      postalCode: form.postalCode, buildingNo: form.buildingNo,
      floorNo: form.floorNo, apartmentNo: form.apartmentNo,
    });
    createMutation.mutate({
      scheduledDate,
      type: "MAINTENANCE",
      notes: form.notes || undefined,
      urgentLocation,
      isUrgent: true,
      visibleToScheduling: false,
      customerName,
      customerPhone,
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
    BANK_TRANSFER_COMMERCIAL: isAr ? "تحويل بنكي (تجاري)" : "Bank Transfer (Commercial)",
    BANK_TRANSFER_PERSONAL: isAr ? "تحويل بنكي (خاص)" : "Bank Transfer (Personal)",
  };

  const SERVICE_LABELS: Record<string, string> = {
    INSTALLATION: isAr ? "تركيب" : "Installation",
    MAINTENANCE: isAr ? "صيانة" : "Maintenance",
    VISIT_ONLY: isAr ? "زيارة فقط" : "Visit Only",
  };

  // Outstanding = unresolved urgent appointments (isUrgent, no urgentVisitRecord
  // submitted yet) -- state/data-driven, matches the badge in the sidebar (see
  // components/Sidebar.tsx), never a localStorage-only counter.
  const outstandingCount = (apptData || []).filter((a: any) => !a.urgentVisitRecord).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">{t("urgentAppts.title")}</h1>
          {outstandingCount > 0 && (
            <span className="text-xs bg-red-100 text-red-700 px-2.5 py-1 rounded-full font-semibold">
              {isAr ? `${outstandingCount} بانتظار الفني` : `${outstandingCount} awaiting technician`}
            </span>
          )}
        </div>
        <button onClick={() => setShowForm(v => !v)}
          style={{ backgroundColor: "#000080" }}
          className="text-white text-sm px-4 py-2 rounded-lg hover:opacity-90">
          🚨 {t("urgentAppts.newUrgent")}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="font-semibold text-slate-700">{t("urgentAppts.newUrgent")}</h2>
            <HelpButton titleAr={HELP["admin.urgentAppointments"].titleAr} contentAr={HELP["admin.urgentAppointments"].contentAr} />
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("common.date")} *</label>
              <input type="date" lang="en-GB" dir="ltr" required value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex items-center gap-1 text-xs font-semibold text-slate-600">
              {t("urgentAppts.customerInfo")}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.customerName")} *</label>
                <input required value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t("urgentAppts.customerPhone")} *</label>
                <input required dir="ltr" value={form.customerPhone} onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs font-semibold text-slate-600">
              {t("urgentAppts.locationInfo")}
              <HelpButton titleAr={HELP["form.urgentLocation"].titleAr} contentAr={HELP["form.urgentLocation"].contentAr} />
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
              <table className="w-full text-sm min-w-[560px]">
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
                      <td className="px-4 py-3 whitespace-nowrap" dir="ltr">{formatGregorianDate(a.scheduledDate)}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs max-w-[180px] truncate">{a.notes || "—"}</td>
                      <td className="px-4 py-3">
                        {a.visibleToScheduling ? (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{t("urgentAppts.approved")}</span>
                        ) : (
                          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">{t("urgentAppts.hidden")}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2 items-center">
                          {!a.visibleToScheduling && (
                            <button onClick={() => approveMutation.mutate(a.id)} disabled={approveMutation.isPending}
                              className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                              {t("urgentAppts.approve")}
                            </button>
                          )}
                          <button
                            onClick={() => {
                              if (window.confirm(isAr ? "هل تريد حذف هذا الموعد العاجل؟ سيتم حذف جميع السجلات المرتبطة به." : "Delete this urgent appointment? All related records will be removed.")) {
                                deleteMutation.mutate(a.id);
                              }
                            }}
                            disabled={deleteMutation.isPending}
                            className="text-xs bg-red-600 text-white px-3 py-1 rounded-lg hover:bg-red-700 disabled:opacity-50">
                            {isAr ? "حذف" : "Delete"}
                          </button>
                        </div>
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
              <table className="w-full text-sm min-w-[600px]">
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
                    <tr key={v.id} className="border-b hover:bg-slate-50 cursor-pointer" onClick={() => setVisitDetail(v)}>
                      <td className="px-4 py-3 font-medium">{v.customerName || v.appointment?.customer?.name || "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{v.customerPhone || "—"}</td>
                      <td className="px-4 py-3 text-xs font-medium">
                        {v.serviceType ? (SERVICE_LABELS[v.serviceType] || v.serviceType) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {v.paymentMethod ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            v.paymentMethod === "CASH" ? "bg-green-100 text-green-700" :
                            "bg-blue-100 text-blue-700"}`}>
                            {PAYMENT_LABELS[v.paymentMethod] || v.paymentMethod}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-800">{v.amount != null ? `${v.amount.toFixed(2)}` : "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{v.submittedBy?.name || "—"}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs" dir="ltr">{formatGregorianDate(v.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {visitDetail && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
          onClick={() => setVisitDetail(null)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b flex justify-between items-center shrink-0 bg-gradient-to-r from-orange-50 to-white rounded-t-xl">
              <h3 className="font-bold text-slate-800 text-base">
                {isAr ? "تفاصيل الزيارة العاجلة" : "Urgent Visit Details"}
              </h3>
              <button onClick={() => setVisitDetail(null)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 shrink-0">
                ✕
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-5">

              {/* Section 1 — Visit Information */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2.5">
                  {isAr ? "معلومات الزيارة" : "Visit Information"}
                </p>
                <div className="bg-slate-50 rounded-xl p-4 space-y-2.5">
                  <div className="flex gap-2">
                    <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "اسم الفني" : "Technician"}:</span>
                    <span className="font-semibold text-slate-800 text-sm">{visitDetail.submittedBy?.name || "—"}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "اسم العميل" : "Customer"}:</span>
                    <span className="text-slate-700 text-xs">{visitDetail.customerName || visitDetail.appointment?.customer?.name || "—"}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "رقم الجوال" : "Phone"}:</span>
                    <span className="text-slate-700 text-xs">{visitDetail.customerPhone || "—"}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "الموقع" : "Location"}:</span>
                    <span className="text-slate-700 text-xs">{visitDetail.appointment ? locationText(visitDetail.appointment) : "—"}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "نوع الخدمة" : "Service Type"}:</span>
                    <span className="text-slate-700 text-xs">{visitDetail.serviceType ? (SERVICE_LABELS[visitDetail.serviceType] || visitDetail.serviceType) : "—"}</span>
                  </div>
                  {visitDetail.appointment?.scheduledDate && (
                    <div className="flex gap-2">
                      <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "تاريخ الموعد" : "Appointment Date"}:</span>
                      <span className="text-slate-700 text-xs" dir="ltr">
                        {formatGregorianDate(visitDetail.appointment.scheduledDate)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Section 2 — Details (only when present -- customerDetails/serviceNotes are the
                  only two free-text fields the active technician form actually populates) */}
              {(visitDetail.customerDetails || visitDetail.serviceNotes) && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2.5">
                    {isAr ? "التفاصيل" : "Details"}
                  </p>
                  <div className="bg-blue-50/60 rounded-xl p-4 space-y-2.5 border border-blue-100">
                    {visitDetail.customerDetails && (
                      <div className="flex gap-2">
                        <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "تفاصيل العميل" : "Customer Details"}:</span>
                        <span className="text-slate-700 text-xs break-words">{visitDetail.customerDetails}</span>
                      </div>
                    )}
                    {visitDetail.serviceNotes && (
                      <div className="flex gap-2">
                        <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "ملاحظات الخدمة" : "Service Notes"}:</span>
                        <span className="text-slate-700 text-xs break-words">{visitDetail.serviceNotes}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Section 3 — Payment (Admin-only page -- API already returns raw values, no Scheduling exposure here) */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2.5">
                  {isAr ? "معلومات الدفع" : "Payment Information"}
                </p>
                <div className="bg-green-50/70 rounded-xl p-4 space-y-2.5 border border-green-100">
                  <div className="flex gap-2 items-center">
                    <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "المبلغ" : "Amount"}:</span>
                    <span className="font-bold text-green-700 text-base">
                      {visitDetail.amount != null ? visitDetail.amount.toFixed(2) : "0.00"} {isAr ? "ريال" : "SAR"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-400 min-w-[120px] shrink-0 text-xs">{isAr ? "طريقة الدفع" : "Payment Method"}:</span>
                    <span className="text-slate-700 text-xs">
                      {visitDetail.serviceType === "VISIT_ONLY"
                        ? (isAr ? "غير مطلوب (زيارة فقط)" : "N/A (Visit Only)")
                        : (PAYMENT_LABELS[visitDetail.paymentMethod] || visitDetail.paymentMethod || "—")}
                    </span>
                  </div>
                </div>
              </div>

            </div>
            <div className="p-4 border-t shrink-0 flex items-center justify-between">
              <span className="text-xs text-slate-400" dir="ltr">
                {isAr ? "أُرسلت في: " : "Submitted: "}{formatGregorianDate(visitDetail.createdAt)} {formatGregorianTime(visitDetail.createdAt)}
              </span>
              <button onClick={() => setVisitDetail(null)}
                className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 font-medium transition-colors">
                {isAr ? "إغلاق" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
