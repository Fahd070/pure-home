import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import toast from "react-hot-toast";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";

const PHONE_RE = /^05\d{8}$/;

export default function AddCustomer() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "", phone: "", maintenanceCycle: "MONTHLY", maintenanceFrequency: 1, notes: "",
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
      const { city, district, street, postalCode, buildingNo, floorNo, apartmentNo, name, phone, maintenanceCycle, maintenanceFrequency, notes } = form;
      await api.post("/customers", { name, phone, maintenanceCycle, maintenanceFrequency: Number(maintenanceFrequency), notes: notes || undefined, address: { city, district, street, postalCode: postalCode || undefined, buildingNo: buildingNo || undefined, floorNo: floorNo || undefined, apartmentNo: apartmentNo || undefined } });
      toast.success(t("common.success"));
      navigate("/admin/customers");
    } catch (err: any) {
      toast.error(err.response?.data?.message || t("common.error"));
    } finally { setLoading(false); }
  }

  const field = (k: string, label: string, type = "text", required = false) => (
    <div>
      <label className="block text-sm font-medium mb-1">{label}{required && <span className="text-red-500"> *</span>}</label>
      <input type={type} value={(form as any)[k]} onChange={e => set(k, e.target.value)}
        className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors[k] ? "border-red-400" : ""}`} />
      {errors[k] && <p className="text-red-500 text-xs mt-1">{errors[k]}</p>}
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(-1)} className="text-slate-500 hover:text-slate-700">← {t("common.back")}</button>
        <h2 className="text-lg font-semibold">{t("customers.add")}</h2>
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
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="DAILY">{t("customers.daily")}</option>
              <option value="WEEKLY">{t("customers.weekly")}</option>
              <option value="MONTHLY">{t("customers.monthly")}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("customers.frequency")}</label>
            <input type="number" min={1} value={form.maintenanceFrequency} onChange={e => set("maintenanceFrequency", e.target.value)}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
        {/* Large resizable notes textarea */}
        <div>
          <label className="block text-sm font-medium mb-1">{t("common.notes")}</label>
          <textarea
            value={form.notes}
            onChange={e => set("notes", e.target.value)}
            rows={6}
            placeholder={t("customers.enterNotes")}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y min-h-[120px]"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading} className="bg-blue-700 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-800 disabled:opacity-50">
            {loading ? t("common.loading") : t("common.save")}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="border px-6 py-2 rounded-lg hover:bg-slate-50">
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </div>
  );
}