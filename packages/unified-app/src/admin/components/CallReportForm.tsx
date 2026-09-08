import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useAuthStore } from "../store/authStore";
import toast from "react-hot-toast";
import { dateOnlyToApiDate } from "../../utils/dateTimeInput";
import { Button } from "../../ui/Button";
import { Input, Textarea, Field } from "../../ui/Field";
import { Icon } from "../../ui/icons";
import { cx } from "../../ui/cx";

export interface CallReportPresetCustomer {
  id: string;
  name: string;
  phone: string;
}

const EMPTY = { customerId: "", date: "", notes: "", employeeName: "", unregisteredName: "", unregisteredPhone: "" };

// Dashboard parity fix: the Admin department's own copy of Modification #11's
// shared call-report form, mirroring scheduling/components/CallReportForm.tsx
// exactly (same POST /call-reports endpoint, same validation, same save path)
// but pointed at Admin's own api client/auth store -- api client and authStore
// are genuinely separate per-department modules throughout this codebase (each
// carries a different department's auth token), so a single cross-department
// import isn't an option; this follows the same established per-department
// duplication convention already used for admin/pages/CallReports.tsx vs
// scheduling/pages/CallReports.tsx. Used by both the standalone Call Reports
// page and the new Admin Dashboard "Call Report" shortcut, so there remains
// exactly one Admin-side create path, never a second diverging form.
export default function CallReportForm({
  presetCustomer, onSaved, onCancel,
}: {
  /** When set (Dashboard shortcut), pre-fills and locks out unregistered-customer mode -- the row's customer is already known. */
  presetCustomer?: CallReportPresetCustomer | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [unregisteredMode, setUnregisteredMode] = useState(false);
  const [form, setForm] = useState({
    ...EMPTY,
    employeeName: user?.name || "",
    customerId: presetCustomer?.id || "",
  });
  const [formSearch, setFormSearch] = useState(presetCustomer ? `${presetCustomer.name} — ${presetCustomer.phone}` : "");

  const { data: customersData } = useQuery({
    queryKey: ["customers-select-admin"],
    queryFn: () => api.get("/customers", { params: { limit: 500 } }).then(r => r.data.data || []),
    enabled: !presetCustomer,
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post("/call-reports", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["call-reports"] });
      toast.success(t("callReports.saved"));
      onSaved();
    },
    onError: () => toast.error(t("common.error")),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hasCustomer = unregisteredMode
      ? (form.unregisteredName.trim().length > 0)
      : !!form.customerId;
    const callDate = dateOnlyToApiDate(form.date);
    if (!hasCustomer || !callDate || !form.employeeName) return;
    if (unregisteredMode) {
      createMutation.mutate({
        unregisteredName: form.unregisteredName,
        unregisteredPhone: form.unregisteredPhone || undefined,
        callDate,
        notes: form.notes || undefined,
        employeeName: form.employeeName,
      });
    } else {
      createMutation.mutate({
        customerId: form.customerId,
        callDate,
        notes: form.notes || undefined,
        employeeName: form.employeeName,
      });
    }
  }

  const allCustomers: any[] = customersData || [];
  const filteredFormCustomers = useMemo(() => {
    if (!formSearch.trim()) return allCustomers;
    const q = formSearch.toLowerCase();
    return allCustomers.filter((c: any) => c.name?.toLowerCase().includes(q) || c.phone?.includes(q) || c.secondaryPhone?.includes(q));
  }, [allCustomers, formSearch]);

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="sm:col-span-2">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-xs font-medium text-fg-secondary">{t("callReports.customer")}</span>
          {!presetCustomer && (
            <button
              type="button"
              onClick={() => {
                setUnregisteredMode(v => !v);
                setForm(f => ({ ...f, customerId: "", unregisteredName: "", unregisteredPhone: "" }));
                setFormSearch("");
              }}
              className={cx(
                "text-2xs px-2 h-6 inline-flex items-center gap-1 rounded border transition-colors",
                unregisteredMode
                  ? "bg-warning-bg border-warning-border text-warning-fg"
                  : "bg-surface border-line text-fg-secondary hover:bg-surface-hover"
              )}
            >
              <Icon name={unregisteredMode ? "close" : "add"} className="w-3 h-3" />
              {t("callReports.unregisteredCustomer")}
            </button>
          )}
        </div>

        {presetCustomer ? (
          <div className="border border-accent-border bg-accent-subtle rounded px-2.5 h-control flex items-center gap-2 text-[0.8125rem]">
            <Icon name="check" className="w-3.5 h-3.5 text-accent-subtlefg flex-shrink-0" />
            <span className="font-medium text-fg truncate">{presetCustomer.name}</span>
            <span className="text-fg-muted" dir="ltr">{presetCustomer.phone}</span>
          </div>
        ) : unregisteredMode ? (
          <div className="space-y-2">
            <div className="bg-warning-bg border border-warning-border text-warning-fg rounded px-2.5 py-2 text-2xs">
              {t("callReports.unregisteredGuidance")}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={form.unregisteredName}
                onChange={e => setForm(f => ({ ...f, unregisteredName: e.target.value }))}
                placeholder={t("callReports.unregisteredName")}
                aria-label={t("callReports.unregisteredName")}
              />
              <Input
                value={form.unregisteredPhone}
                onChange={e => setForm(f => ({ ...f, unregisteredPhone: e.target.value }))}
                placeholder={t("callReports.unregisteredPhone")}
                aria-label={t("callReports.unregisteredPhone")}
                dir="ltr"
              />
            </div>
          </div>
        ) : (
          <>
            <div className="relative">
              <Icon name="search" className="w-3.5 h-3.5 text-fg-muted absolute top-1/2 -translate-y-1/2 start-2.5 pointer-events-none" />
              <Input
                value={formSearch}
                onChange={e => { setFormSearch(e.target.value); setForm(f => ({ ...f, customerId: "" })); }}
                placeholder={isAr ? "ابحث بالاسم أو الجوال..." : "Search by name or phone..."}
                aria-label={t("callReports.customer")}
                className="ps-8"
              />
            </div>

            {formSearch && !form.customerId && (
              <div className="mt-1 border border-line rounded max-h-44 overflow-y-auto bg-surface shadow-md">
                {filteredFormCustomers.length === 0 ? (
                  <p className="text-2xs text-fg-muted px-2.5 py-2">{t("common.noRecords")}</p>
                ) : filteredFormCustomers.slice(0, 8).map((c: any) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setForm(f => ({ ...f, customerId: c.id })); setFormSearch(`${c.name} — ${c.phone}`); }}
                    className="w-full text-start px-2.5 py-2 text-[0.8125rem] hover:bg-surface-hover border-b border-line-subtle last:border-b-0 flex items-center gap-2"
                  >
                    <span className="font-medium text-fg truncate">{c.name}</span>
                    <span className="text-fg-muted text-2xs" dir="ltr">{c.phone}</span>
                  </button>
                ))}
              </div>
            )}

            {form.customerId && (
              <p className="text-2xs text-success-fg mt-1 flex items-center gap-1">
                <Icon name="check" className="w-3 h-3" />
                {isAr ? "تم اختيار العميل" : "Customer selected"}
              </p>
            )}
          </>
        )}
      </div>

      <Field label={t("common.date")} htmlFor="call-date">
        <Input
          id="call-date" type="date" lang="en-GB" dir="ltr" required
          value={form.date}
          onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
        />
      </Field>

      <Field label={t("callReports.employeeName")} htmlFor="call-employee">
        <Input
          id="call-employee"
          value={form.employeeName}
          onChange={e => setForm(f => ({ ...f, employeeName: e.target.value }))}
        />
      </Field>

      <Field className="sm:col-span-2" label={t("callReports.notes")} htmlFor="call-notes">
        <Textarea
          id="call-notes" rows={4}
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
        />
      </Field>

      <div className="sm:col-span-2 flex gap-2 justify-end pt-1">
        <Button type="button" variant="secondary" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button
          type="submit"
          variant="primary"
          loading={createMutation.isPending}
          disabled={(!unregisteredMode && !form.customerId) || (unregisteredMode && !form.unregisteredName.trim())}
        >
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
