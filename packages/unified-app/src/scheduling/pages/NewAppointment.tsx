import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import toast from "react-hot-toast";
import PreviousMaintenanceNoteBox from "../../components/PreviousMaintenanceNoteBox";
import { dateOnlyToApiDate } from "../../utils/dateTimeInput";
import { Button } from "../../ui/Button";
import { Input, Select, Textarea, Field } from "../../ui/Field";
import { Icon } from "../../ui/icons";

export default function NewAppointment() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [form, setForm] = useState({ type: "MAINTENANCE", date: "", notes: "" });

  const { data: customers } = useQuery({
    queryKey: ["customers-search", customerSearch],
    queryFn: () => api.get("/customers", { params: { search: customerSearch, limit: 10 } }).then(r => r.data.data),
    enabled: customerSearch.length > 1
  });

  // Modification #7: keyed on the selected customer's id, so react-query's own
  // cache identity guarantees a stale response for a previously-selected
  // customer can never render under a newly-selected one.
  const { data: prevNote } = useQuery({
    queryKey: ["latest-maintenance-note", selectedCustomer?.id],
    queryFn: () => api.get(`/customers/${selectedCustomer.id}/latest-maintenance-note`).then(r => r.data.data.nextMaintenanceNote),
    enabled: !!selectedCustomer,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCustomer) { toast.error("Select a customer"); return; }
    const scheduledDate = dateOnlyToApiDate(form.date);
    if (!scheduledDate) { toast.error("Select a date"); return; }
    setLoading(true);
    try {
      await api.post("/appointments", { customerId: selectedCustomer.id, type: form.type, scheduledDate, notes: form.notes || undefined });
      toast.success(t("common.success"));
      navigate("/scheduling/appointments");
    } catch (err: any) {
      toast.error(err.response?.data?.message || t("common.error"));
    } finally { setLoading(false); }
  }

  return (
    <div className="max-w-xl mx-auto space-y-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-fg-muted hover:text-fg text-2xs inline-flex items-center gap-1.5 transition-colors"
        >
          <Icon name="chevronStart" className="w-3.5 h-3.5 rtl:rotate-180" />
          {t("common.back")}
        </button>
        <h2 className="text-base font-semibold text-fg">{t("appointments.new")}</h2>
      </div>

      <form onSubmit={handleSubmit} className="bg-surface border border-line rounded-md">
        <div className="p-4 space-y-3">
          <div>
            <span className="block text-xs font-medium text-fg-secondary mb-1.5">
              {t("appointments.customer")}<span className="text-danger-fg ms-0.5">*</span>
            </span>

            {selectedCustomer ? (
              <div className="flex items-center justify-between gap-2 border border-accent-border bg-accent-subtle rounded px-2.5 h-control">
                <span className="text-[0.8125rem] font-medium text-fg truncate">
                  {selectedCustomer.name} <span className="text-fg-muted" dir="ltr">{selectedCustomer.phone}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedCustomer(null)}
                  aria-label={t("common.cancel")}
                  className="text-fg-muted hover:text-fg flex-shrink-0"
                >
                  <Icon name="close" className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Icon name="search" className="w-3.5 h-3.5 text-fg-muted absolute top-1/2 -translate-y-1/2 start-2.5 pointer-events-none z-10" />
                <Input
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                  placeholder={t("common.search")}
                  aria-label={t("appointments.customer")}
                  className="ps-8"
                />
                {customers && customers.length > 0 && (
                  <div className="absolute top-full start-0 end-0 mt-1 bg-surface border border-line rounded shadow-lg z-20 max-h-52 overflow-y-auto">
                    {customers.map((c: any) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setSelectedCustomer(c); setCustomerSearch(""); }}
                        className="w-full text-start px-2.5 py-2 text-[0.8125rem] hover:bg-surface-hover border-b border-line-subtle last:border-b-0 flex items-center gap-2"
                      >
                        <span className="font-medium text-fg truncate">{c.name}</span>
                        <span className="text-fg-muted text-2xs" dir="ltr">{c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {selectedCustomer && <PreviousMaintenanceNoteBox note={prevNote} />}

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("appointments.type")} htmlFor="new-appt-type">
              <Select id="new-appt-type" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="MAINTENANCE">{t("appointments.maintenance")}</option>
                <option value="INSTALLATION">{t("appointments.installation")}</option>
              </Select>
            </Field>

            <Field label={t("common.date")} htmlFor="new-appt-date" required>
              <Input
                id="new-appt-date" type="date" lang="en-GB" dir="ltr"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              />
            </Field>
          </div>

          <Field label={t("common.notes")} htmlFor="new-appt-notes">
            <Textarea
              id="new-appt-notes" rows={3}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </Field>
        </div>

        <div className="px-4 py-2.5 border-t border-line bg-surface-subtle flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" loading={loading}>{t("common.save")}</Button>
        </div>
      </form>
    </div>
  );
}
