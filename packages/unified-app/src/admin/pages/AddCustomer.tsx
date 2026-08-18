import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import toast from "react-hot-toast";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";
import { dateOnlyToApiDate } from "../../utils/dateTimeInput";
import { toDateInputValue } from "../../utils/dateTimeInput";
import { PHONE_RE } from "../../utils/phone";
import { isValidMaintenanceFrequency } from "../../utils/maintenanceFrequency";

const INSTALL_DATE_FIELD = "installation" + "Date";

export default function AddCustomer() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState<number | undefined>();
  const [installDate, setInstallDate] = useState("");
  const [form, setForm] = useState({
    name: "", phone: "", secondaryPhone: "", maintenanceCycle: "MONTHLY", maintenanceFrequency: 1, notes: "",
    city: "", district: "", street: "", postalCode: "", buildingNo: "", floorNo: "", apartmentNo: "",
    previousServiceType: "", previousServiceDate: "", previousServiceNote: "",
    // Optional installation-details section (Part 1). Deliberately kept out
    // of `previousServiceType`'s all-or-nothing group above -- each of these
    // three is independently optional, matching the user's requirement.
    installationNote: "", installationAmount: "", installationPaymentMethod: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.get(`/customers/${id}`).then(response => {
      const customer = response.data.data;
      setVersion(customer.version);
      setInstallDate(toDateInputValue(customer[INSTALL_DATE_FIELD]));
      setForm({ name: customer.name, phone: customer.phone, secondaryPhone: customer.secondaryPhone || "", maintenanceCycle: customer.maintenanceCycle, maintenanceFrequency: customer.maintenanceFrequency, notes: customer.notes || "", city: customer.address?.city || "", district: customer.address?.district || "", street: customer.address?.street || "", postalCode: customer.address?.postalCode || "", buildingNo: customer.address?.buildingNo || "", floorNo: customer.address?.floorNo || "", apartmentNo: customer.address?.apartmentNo || "", previousServiceType: customer.previousServiceType || "", previousServiceDate: toDateInputValue(customer.previousServiceDate), previousServiceNote: customer.previousServiceNote || "", installationNote: customer.installationNote || "", installationAmount: customer.installationAmount != null ? String(customer.installationAmount) : "", installationPaymentMethod: customer.installationPaymentMethod || "" });
    }).catch(() => toast.error(t("common.error"))).finally(() => setLoading(false));
  }, [id, t]);

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = t("common.name") + " required";
    if (!PHONE_RE.test(form.phone)) e.phone = t("customers.phoneInvalid");
    const trimmedSecondary = form.secondaryPhone.trim();
    if (trimmedSecondary) {
      if (!PHONE_RE.test(trimmedSecondary)) e.secondaryPhone = t("customers.secondaryPhoneInvalid");
      else if (trimmedSecondary === form.phone) e.secondaryPhone = t("customers.secondaryPhoneSameAsPrimary");
    }
    if (!isValidMaintenanceFrequency(Number(form.maintenanceFrequency))) e.maintenanceFrequency = t("customers.frequencyInvalid");
    if (!form.city.trim()) e.city = t("customers.city") + " required";
    if (!form.district.trim()) e.district = t("customers.district") + " required";
    // Previous Service is optional as a whole, but once any of its three
    // fields has content, type and date both become required -- a half-record
    // like a date with no type is rejected (note alone stays optional).
    const hasAnyPreviousService = !!form.previousServiceType || !!form.previousServiceDate || !!form.previousServiceNote.trim();
    if (hasAnyPreviousService) {
      if (!form.previousServiceType) e.previousServiceType = t("customers.previousServiceTypeRequired");
      if (!form.previousServiceDate) e.previousServiceDate = t("customers.previousServiceDateRequired");
    }
    // Installation cost has no dependency on the other installation fields --
    // it just needs to be a valid non-negative number when provided at all.
    if (form.installationAmount.trim()) {
      const n = Number(form.installationAmount);
      if (!Number.isFinite(n) || n < 0) e.installationAmount = t("customers.installationAmountInvalid");
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const { city, district, street, postalCode, buildingNo, floorNo, apartmentNo, name, phone, secondaryPhone, maintenanceCycle, maintenanceFrequency, notes, previousServiceType, previousServiceDate, previousServiceNote, installationNote, installationAmount, installationPaymentMethod } = form;
      const payload = {
        name, phone, secondaryPhone: secondaryPhone.trim() || undefined, maintenanceCycle, maintenanceFrequency: Number(maintenanceFrequency), notes: isEditing ? notes : notes || undefined,
        ...(isEditing ? { secondaryPhone: secondaryPhone.trim() } : {}),
        ...(isEditing ? { version } : {}),
        // Now collected on both create and edit (previously edit-only) --
        // same create-vs-edit convention as previousServiceDate just below:
        // omitted entirely when blank on create, explicitly cleared ("") when
        // blank on edit.
        [INSTALL_DATE_FIELD]: installDate ? (dateOnlyToApiDate(installDate) ?? undefined) : (isEditing ? "" : undefined),
        previousServiceType: isEditing ? previousServiceType : previousServiceType || undefined,
        previousServiceDate: previousServiceDate ? (dateOnlyToApiDate(previousServiceDate) ?? undefined) : isEditing ? "" : undefined,
        previousServiceNote: isEditing ? previousServiceNote.trim() : previousServiceNote.trim() || undefined,
        // Each of these three is independently optional -- an omitted key
        // (create) leaves the field unset, an explicit null/"" (edit) clears
        // a previously-set value, matching the backend's partial-update
        // convention used throughout this route (see previousService* above).
        installationNote: isEditing ? installationNote.trim() : installationNote.trim() || undefined,
        installationAmount: installationAmount.trim() !== "" ? Number(installationAmount) : (isEditing ? null : undefined),
        installationPaymentMethod: installationPaymentMethod || (isEditing ? null : undefined),
        address: { city, district, street, postalCode: isEditing ? postalCode : postalCode || undefined, buildingNo: isEditing ? buildingNo : buildingNo || undefined, floorNo: isEditing ? floorNo : floorNo || undefined, apartmentNo: isEditing ? apartmentNo : apartmentNo || undefined },
      };
      if (isEditing) await api.put(`/customers/${id}`, payload);
      else await api.post("/customers", payload);
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
        <h2 className="text-lg font-semibold">{isEditing ? t("customers.edit") : t("customers.add")}</h2>
      </div>
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {field("name", t("common.name"), "text", true)}
          {field("phone", t("customers.primaryPhone"), "text", true)}
        </div>
        <div className="grid grid-cols-2 gap-4">
          {field("secondaryPhone", t("customers.secondaryPhone"))}
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
            <input type="number" min={0.5} step={0.5} value={form.maintenanceFrequency} onChange={e => set("maintenanceFrequency", e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.maintenanceFrequency ? "border-red-400" : ""}`} />
            {errors.maintenanceFrequency && <p className="text-red-500 text-xs mt-1">{errors.maintenanceFrequency}</p>}
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
        {/* Optional installation-details section. All four fields are
            independently optional -- no field here requires another. */}
        <div className="flex items-center gap-2 border-t pt-3">
          <p className="text-sm font-semibold text-slate-600">{t("customers.installationSection")}</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t("reports.installationDate")}</label>
            <input type="date" lang="en-GB" dir="ltr" value={installDate} onChange={event => setInstallDate(event.target.value)}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("customers.installationCost")}</label>
            <input type="number" min={0} step="any" value={form.installationAmount} onChange={e => set("installationAmount", e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.installationAmount ? "border-red-400" : ""}`} />
            {errors.installationAmount && <p className="text-red-500 text-xs mt-1">{errors.installationAmount}</p>}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("customers.installationPaymentMethod")}</label>
          <select value={form.installationPaymentMethod} onChange={e => set("installationPaymentMethod", e.target.value)}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value=""></option>
            <option value="CASH">{t("customers.paymentCash")}</option>
            <option value="BANK_CARD_PERSONAL">{t("customers.paymentBankPersonal")}</option>
            <option value="BANK_CARD_COMMERCIAL">{t("customers.paymentBankCommercial")}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("customers.installationNote")}</label>
          <textarea value={form.installationNote} onChange={e => set("installationNote", e.target.value)} rows={3}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" />
        </div>
        {/* Optional: historical service that happened before this customer
            existed in the system. Entirely optional as a whole; once any of
            the three fields below has content, type + date become required
            (validated in validate() above). */}
        <div className="flex items-center gap-2 border-t pt-3">
          <p className="text-sm font-semibold text-slate-600">{t("customers.previousService")}</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t("customers.previousServiceType")}</label>
            <select value={form.previousServiceType} onChange={e => set("previousServiceType", e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.previousServiceType ? "border-red-400" : ""}`}>
              <option value=""></option>
              <option value="INSTALLATION">{t("customers.previousInstallation")}</option>
              <option value="MAINTENANCE">{t("customers.previousMaintenance")}</option>
            </select>
            {errors.previousServiceType && <p className="text-red-500 text-xs mt-1">{errors.previousServiceType}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("customers.previousServiceDate")}</label>
            <input type="date" lang="en-GB" dir="ltr" value={form.previousServiceDate}
              onChange={e => set("previousServiceDate", e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.previousServiceDate ? "border-red-400" : ""}`} />
            {errors.previousServiceDate && <p className="text-red-500 text-xs mt-1">{errors.previousServiceDate}</p>}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("customers.previousServiceNote")}</label>
          <textarea value={form.previousServiceNote} onChange={e => set("previousServiceNote", e.target.value)} rows={3}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" />
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
