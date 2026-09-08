import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import toast from "react-hot-toast";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";
import { formatGregorianDate, todayDateOnly } from "../../utils/dateTimeInput";
import { Button } from "../../ui/Button";
import { Input, Select, Field } from "../../ui/Field";
import { Badge, Tone } from "../../ui/Badge";
import { PageHeader } from "../../ui/Surface";
import { EmptyState, Loading } from "../../ui/Feedback";
import { TableShell, Table, THead, TH, TBody, TR, TD } from "../../ui/Table";
import { Icon } from "../../ui/icons";

const CATEGORIES = ["fuel","tools","materials","food","transport","other"] as const;
const EMPTY = { amount: "", category: "fuel", description: "", date: todayDateOnly(), customCategory: "" };

const STATUS_TONE: Record<string, Tone> = {
  PENDING: "pending",
  APPROVED: "success",
  REJECTED: "danger",
};

export default function TechExpenses() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const { data, isLoading } = useQuery({
    queryKey: ["tech-expenses"],
    queryFn: () => api.get("/expenses").then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post("/expenses", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tech-expenses"] });
      toast.success(t("expenses.saved"));
      setShowForm(false);
      setForm({ ...EMPTY });
    },
    onError: () => toast.error(t("common.error")),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0 || !form.date) return;
    if (form.category === "other" && !form.customCategory.trim()) {
      toast.error(isAr ? "يرجى تحديد الفئة عند اختيار 'أخرى'" : "Please specify the category when selecting 'Other'");
      return;
    }
    const finalCategory = form.category === "other" ? form.customCategory.trim() : form.category;
    createMutation.mutate({
      amount,
      category: finalCategory,
      description: form.description || undefined,
      date: form.date,
    });
  }

  const expenses: any[] = data?.data || [];
  const total: number = data?.meta?.totalAmount || 0;

  const CATEGORY_LABEL: Record<string, string> = {
    fuel: isAr ? "وقود" : "Fuel",
    tools: isAr ? "أدوات" : "Tools",
    materials: isAr ? "مواد" : "Materials",
    food: isAr ? "طعام" : "Food",
    transport: isAr ? "مواصلات" : "Transport",
    other: isAr ? "أخرى" : "Other",
  };

  const STATUS_LABEL: Record<string, string> = {
    PENDING: isAr ? "بانتظار الموافقة" : "Pending",
    APPROVED: isAr ? "موافق عليه" : "Approved",
    REJECTED: isAr ? "مرفوض" : "Rejected",
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("expenses.title")}
        subtitle={
          <span className="tabular-nums">
            {isAr ? `الإجمالي: ${total.toFixed(2)} ريال` : `Total: ${total.toFixed(2)} SAR`}
          </span>
        }
        actions={
          <Button variant={showForm ? "secondary" : "primary"} onClick={() => setShowForm(v => !v)}>
            <Icon name={showForm ? "close" : "add"} className="w-3.5 h-3.5" />
            {showForm ? t("common.cancel") : t("expenses.newExpense")}
          </Button>
        }
      />

      {showForm && (
        <div className="bg-surface border border-line rounded-md">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
            <h2 className="text-sm font-semibold text-fg">{t("expenses.newExpense")}</h2>
            <HelpButton titleAr={HELP["form.expenseSubmit"].titleAr} contentAr={HELP["form.expenseSubmit"].contentAr} />
          </div>

          <form onSubmit={handleSubmit}>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label={t("expenses.amount")} htmlFor="exp-amount">
                <Input
                  id="exp-amount" type="number" step="0.01" min="0.01" required dir="ltr"
                  className="tabular-nums"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                />
              </Field>

              <Field label={t("expenses.category")} htmlFor="exp-category">
                <Select
                  id="exp-category"
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value, customCategory: e.target.value !== "other" ? "" : f.customCategory }))}
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                </Select>
              </Field>

              <Field label={t("expenses.date")} htmlFor="exp-date">
                <Input
                  id="exp-date" type="date" required lang="en-GB" dir="ltr"
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                />
              </Field>

              <Field label={t("expenses.description")} htmlFor="exp-desc">
                <Input
                  id="exp-desc"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </Field>

              {form.category === "other" && (
                <Field
                  className="sm:col-span-2 lg:col-span-4"
                  label={isAr ? "تحديد الفئة" : "Specify Category"}
                  htmlFor="exp-custom"
                  required
                >
                  <Input
                    id="exp-custom"
                    required
                    value={form.customCategory}
                    onChange={e => setForm(f => ({ ...f, customCategory: e.target.value }))}
                    placeholder={isAr ? "اكتب الفئة هنا..." : "Enter category here..."}
                  />
                </Field>
              )}
            </div>

            <div className="px-4 py-2.5 border-t border-line bg-surface-subtle flex gap-2 justify-end">
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" loading={createMutation.isPending}>
                {t("common.save")}
              </Button>
            </div>
          </form>
        </div>
      )}

      {isLoading ? (
        <Loading label={t("common.loading")} />
      ) : !expenses.length ? (
        <div className="bg-surface border border-line rounded-md">
          <EmptyState
            icon={<Icon name="expenses" className="w-5 h-5" />}
            title={t("expenses.noExpenses")}
          />
        </div>
      ) : (
        <TableShell>
          <Table>
            <THead>
              <tr>
                <TH>{t("expenses.category")}</TH>
                <TH align="end" width="7rem">{t("expenses.amount")}</TH>
                <TH width="7rem">{t("expenses.date")}</TH>
                <TH>{t("expenses.description")}</TH>
                <TH width="9rem">{t("common.status")}</TH>
              </tr>
            </THead>
            <TBody>
              {expenses.map((e: any) => (
                <TR key={e.id}>
                  <TD className="font-medium">{CATEGORY_LABEL[e.category] || e.category}</TD>
                  {/* Money right-aligned and tabular so columns of figures
                      line up digit-for-digit and can be scanned down. */}
                  <TD align="end" className="font-semibold tabular-nums">{e.amount.toFixed(2)}</TD>
                  <TD className="text-fg-secondary tabular-nums whitespace-nowrap">
                    <span dir="ltr">{formatGregorianDate(e.date)}</span>
                  </TD>
                  <TD className="text-fg-secondary max-w-[280px] truncate" title={e.description || undefined}>
                    {e.description || "—"}
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[e.status] ?? "neutral"} dot>
                      {STATUS_LABEL[e.status] || e.status}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableShell>
      )}
    </div>
  );
}
