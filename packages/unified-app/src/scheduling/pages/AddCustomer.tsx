import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import toast from "react-hot-toast";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";

const PHONE_RE = /^05\d{8}$/;

export default function SchedAddCustomer() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: "", phone: "", maintenanceCycle: "MONTHLY", maintenanceFrequency: 1, notes: "",
    installationDate: "", maintenanceDate: "", nextMaintenanceDate: "",
    city: "", district: "", street: "", postalCode: "", buildingNo: "", floorNo: "", apartmentNo: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = t("common.name") + " required";
    if (!PHONE_RE.test(form.phone)) e.phone = t("customers.phoneInvalid");
    if (!form.city.trim()) e.city = t("customers.city") + " required";
    if (!form.district.trim()) e.district = t("customers.district") + " required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const { city, district, street, postalCode, buildingNo, floorNo, apartmentNo,
        name, phone, maintenanceCycle, maintenanceFrequency, notes,
        installationDate, maintenanceDate, nextMaintenanceDate } = form;

      await api.post("/customer-approvals", {
        name, phone,
        maintenanceCycle,
        maintenanceFrequency: Number(maintenanceFrequency),
        notes: notes || undefined,
        installationDate: installationDate || undefined,
        maintenanceDate: maintenanceDate || undefined,
        nextMaintenanceDate: nextMaintenanceDate || undefined,
        address: {
          city, district, street,
          postalCode: postalCode || undefined,
          buildingNo: buildingNo || undefined,
          floorNo: floorNo || undefined,
          apartmentNo: apartmentNo || undefined,
        },
      });
      setSubmitted(true);
      toast.success(t("approvals.sentForApproval"));
    } catch (err: any) {
      toast.error(err.response?.data?.message || t("common.error"));
    } finally { setLoading(false); }
  }

  const field = (k: string, label: string, type = "text", required = false) => (
    <div>
      <label className="block text-sm font-medium mb-1">{label}{required && <span className="text-red-500"> *</span>}</label>
      <input type={type} value={(form as any)[k]} onChange={e => set(k, e.target.value)}
        className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 ${errors[k] ? "border-red-400" : ""}`} />
      {errors[k] && <p className="text-red-500 text-xs mt-1">{errors[k]}</p>}
    </div>
  );

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm p-10 text-center">
          <p className="text-5xl mb-4">✅</p>
          <h2 className="text-lg font-bold text-green-700 mb-2">{t("approvals.sentForApproval")}</h2>
          <p className="text-slate-500 text-sm mb-6">{t("approvals.pendingApprovalNotice")}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => { setSubmitted(false); setForm({ name:"",phone:"",maintenanceCycle:"MONTHLY",maintenanceFrequency:1,notes:"",installationDate:"",maintenanceDate:"",nextMaintenanceDate:"",city:"",district:"",street:"",postalCode:"",buildingNo:"",floorNo:"",apartmentNo:"" }); }}
              className="bg-green-700 text-white px-6 py-2 rounded-lg font-medium hover:bg-green-800"
            >
              {isAr ? "إضافة طلب آخر" : "Add Another Request"}
            </button>
            <button onClick={() => navigate("/scheduling/customers")} className="border px-6 py-2 rounded-lg hover:bg-slate-50">
              {t("common.back")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(-1)} className="text-slate-500 hover:text-slate-700">← {t("common.back")}</button>
        <h2 className="text-lg font-semibold">{t("customers.add")}</h2>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-start gap-2 text-sm text-amber-800">
        <span className="text-base flex-shrink-0">ℹ️</span>
        <span>{t("approvals.pendingApprovalNotice")}</span>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {field("name", t("common.name"), "text", true)}
          {field("phone", t("common.phone"), "text", true)}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1 flex items-center gap-1">
              {t("customers.maintenanceCycle")}
              <HelpButton titleAr={HELP["form.maintenanceCycle"].titleAr} contentAr={HELP["form.maintenanceCycle"].contentAr} />
            </label>
            <select value={form.maintenanceCycle} onChange={e => set("maintenanceCycle", e.target.value)}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="DAILY">{t("customers.daily")}</option>
              <option value="WEEKLY">{t("customers.weekly")}</option>
              <option value="MONTHLY">{t("customers.monthly")}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("customers.frequency")}</label>
            <input type="number" min={1} value={form.maintenanceFrequency} onChange={e => set("maintenanceFrequency", e.target.value)}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
        </div>

        <div className="border-t pt-3">
          <p className="text-sm font-semibold text-slate-600 mb-3">{isAr ? "التواريخ المقترحة (اختياري)" : "Proposed Dates (optional)"}</p>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t("approvals.installationDate")}</label>
              <input type="date" value={form.installationDate} onChange={e => set("installationDate", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("approvals.maintenanceDate")}</label>
                <input type="date" value={form.maintenanceDate} onChange={e => set("maintenanceDate", e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("approvals.nextMaintenanceDate")}</label>
                <input type="date" value={form.nextMaintenanceDate} onChange={e => set("nextMaintenanceDate", e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t pt-3">
          <p className="text-sm font-semibold text-slate-600">{t("customers.address")}</p>
          <HelpButton titleAr={HELP["form.customerAddress"].titleAr} contentAr={HELP["form.customerAddress"].contentAr} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          {field("city", t("customers.city"), "text", true)}
          {field("district", t("customers.district"), "text", true)}
          {field("street", t("customers.street"))}
          {field("postalCode", t("customers.postalCode"))}
          {field("buildingNo", t("customers.buildingNo"))}
          {field("floorNo", t("customers.floorNo"))}
          {field("apartmentNo", t("customers.apartmentNo"))}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("common.notes")}</label>
          <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={4}
            placeholder={t("customers.enterNotes")}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 resize-y min-h-[80px]" />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading}
            className="bg-green-700 text-white px-6 py-2 rounded-lg font-medium hover:bg-green-800 disabled:opacity-50">
            {loading ? t("common.loading") : (isAr ? "إرسال للموافقة" : "Send for Approval")}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="border px-6 py-2 rounded-lg hover:bg-slate-50">
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </div>
  );
}
