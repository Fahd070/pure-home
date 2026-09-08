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
import { Button } from "../../ui/Button";
import { Input, Select, Textarea, Field } from "../../ui/Field";
import { Icon } from "../../ui/icons";

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
    <Field label={label} htmlFor={`cust-${k}`} required={required} error={errors[k]}>
      <Input
        id={`cust-${k}`}
        type={type}
        value={(form as any)[k]}
        onChange={e => set(k, e.target.value)}
        invalid={!!errors[k]}
      />
    </Field>
  );

  /** A titled block of related fields, with optional contextual help. */
  const section = (title: React.ReactNode, help?: React.ReactNode, hint?: React.ReactNode) => (
    <div className="flex items-center gap-2 pt-1">
      <h3 className="text-2xs font-semibold uppercase tracking-wide text-fg-muted">{title}</h3>
      {help}
      {hint && <span className="text-2xs text-fg-muted font-normal">{hint}</span>}
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-fg-muted hover:text-fg text-2xs inline-flex items-center gap-1.5 transition-colors"
        >
          <Icon name="chevronStart" className="w-3.5 h-3.5 rtl:rotate-180" />
          {t("common.back")}
        </button>
        <h2 className="text-base font-semibold text-fg">{isEditing ? t("customers.edit") : t("customers.add")}</h2>
      </div>

      <form onSubmit={handleSubmit} className="bg-surface border border-line rounded-md">
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {field("name", t("common.name"), "text", true)}
            {field("phone", t("customers.primaryPhone"), "text", true)}
            {field("secondaryPhone", t("customers.secondaryPhone"))}
          </div>

          {section(
            t("customers.maintenanceCycle"),
            <HelpButton titleAr={HELP["form.maintenanceCycle"].titleAr} contentAr={HELP["form.maintenanceCycle"].contentAr} />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t("customers.maintenanceCycle")} htmlFor="cust-cycle">
              <Select id="cust-cycle" value={form.maintenanceCycle} onChange={e => set("maintenanceCycle", e.target.value)}>
                <option value="DAILY">{t("customers.daily")}</option>
                <option value="WEEKLY">{t("customers.weekly")}</option>
                <option value="MONTHLY">{t("customers.monthly")}</option>
              </Select>
            </Field>
            <Field label={t("customers.frequency")} htmlFor="cust-frequency" error={errors.maintenanceFrequency}>
              <Input
                id="cust-frequency" type="number" min={0.5} step={0.5} dir="ltr"
                className="tabular-nums"
                value={form.maintenanceFrequency}
                onChange={e => set("maintenanceFrequency", e.target.value)}
                invalid={!!errors.maintenanceFrequency}
              />
            </Field>
          </div>

          {section(
            t("customers.address"),
            <HelpButton titleAr={HELP["form.customerAddress"].titleAr} contentAr={HELP["form.customerAddress"].contentAr} />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {field("city", t("customers.city"), "text", true)}
            {field("district", t("customers.district"), "text", true)}
            {field("street", t("customers.street"))}
            {field("postalCode", t("customers.postalCode"))}
            {field("buildingNo", t("customers.buildingNo"))}
            {field("floorNo", t("customers.floorNo"))}
            {field("apartmentNo", t("customers.apartmentNo"))}
          </div>

          <Field label={t("common.notes")} htmlFor="cust-notes">
            <Textarea
              id="cust-notes"
              rows={6}
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
              placeholder={t("customers.enterNotes")}
              className="min-h-[120px]"
            />
          </Field>

          {/* Optional installation-details section. All four fields are
              independently optional -- no field here requires another. */}
          {section(t("customers.installationSection"))}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t("reports.installationDate")} htmlFor="cust-install-date">
              <Input
                id="cust-install-date" type="date" lang="en-GB" dir="ltr"
                value={installDate}
                onChange={event => setInstallDate(event.target.value)}
              />
            </Field>
            <Field label={t("customers.installationCost")} htmlFor="cust-install-amount" error={errors.installationAmount}>
              <Input
                id="cust-install-amount" type="number" min={0} step="any" dir="ltr"
                className="tabular-nums"
                value={form.installationAmount}
                onChange={e => set("installationAmount", e.target.value)}
                invalid={!!errors.installationAmount}
              />
            </Field>
            <Field label={t("customers.installationPaymentMethod")} htmlFor="cust-install-payment">
              <Select id="cust-install-payment" value={form.installationPaymentMethod} onChange={e => set("installationPaymentMethod", e.target.value)}>
                <option value=""></option>
                <option value="CASH">{t("customers.paymentCash")}</option>
                <option value="BANK_CARD_PERSONAL">{t("customers.paymentBankPersonal")}</option>
                <option value="BANK_CARD_COMMERCIAL">{t("customers.paymentBankCommercial")}</option>
              </Select>
            </Field>
            <Field className="sm:col-span-2" label={t("customers.installationNote")} htmlFor="cust-install-note">
              <Textarea
                id="cust-install-note" rows={3}
                value={form.installationNote}
                onChange={e => set("installationNote", e.target.value)}
              />
            </Field>
          </div>

          {/* Optional: historical service that happened before this customer
              existed in the system. Entirely optional as a whole; once any of
              the three fields below has content, type + date become required
              (validated in validate() above). */}
          {section(t("customers.previousService"))}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t("customers.previousServiceType")} htmlFor="cust-prev-type" error={errors.previousServiceType}>
              <Select
                id="cust-prev-type"
                value={form.previousServiceType}
                onChange={e => set("previousServiceType", e.target.value)}
                invalid={!!errors.previousServiceType}
              >
                <option value=""></option>
                <option value="INSTALLATION">{t("customers.previousInstallation")}</option>
                <option value="MAINTENANCE">{t("customers.previousMaintenance")}</option>
              </Select>
            </Field>
            <Field label={t("customers.previousServiceDate")} htmlFor="cust-prev-date" error={errors.previousServiceDate}>
              <Input
                id="cust-prev-date" type="date" lang="en-GB" dir="ltr"
                value={form.previousServiceDate}
                onChange={e => set("previousServiceDate", e.target.value)}
                invalid={!!errors.previousServiceDate}
              />
            </Field>
            <Field className="sm:col-span-2" label={t("customers.previousServiceNote")} htmlFor="cust-prev-note">
              <Textarea
                id="cust-prev-note" rows={3}
                value={form.previousServiceNote}
                onChange={e => set("previousServiceNote", e.target.value)}
              />
            </Field>
          </div>
        </div>

        {/* Actions stay pinned to the end of the form panel, so on a long form
            the reader always finds Save in the same place. */}
        <div className="px-4 py-2.5 border-t border-line bg-surface-subtle flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" loading={loading}>{t("common.save")}</Button>
        </div>
      </form>
    </div>
  );
}
