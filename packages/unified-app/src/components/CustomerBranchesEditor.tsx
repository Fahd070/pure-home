import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/Button";
import { Input, Textarea, Field } from "../ui/Field";
import { Icon } from "../ui/icons";

/**
 * v4 Requirement #8: optional branch detail records for ONE customer.
 *
 * Shared by the Administration and Scheduling customer forms so there is one
 * implementation of the shape, the validation and the wording -- the two forms
 * are otherwise separate files that have historically drifted.
 *
 * The domain rule is visible in the UI as well as the data model: this is a
 * section INSIDE one customer's form. There is no path here that creates another
 * customer, and the copy says "branches of this customer", never anything that
 * reads as a separate account.
 */

export interface BranchDraft {
  branchName: string;
  supervisorName: string;
  supervisorMobile: string;
  notes: string;
}

const EMPTY_BRANCH: BranchDraft = { branchName: "", supervisorName: "", supervisorMobile: "", notes: "" };

/** Matches customers.ts's PHONE_RE. Duplicated deliberately, same convention as AddCustomer's own phone check. */
const PHONE_RE = /^05\d{8}$/;

export function branchErrors(branches: BranchDraft[], t: (k: string) => string): Record<number, { branchName?: string; supervisorMobile?: string }> {
  const out: Record<number, { branchName?: string; supervisorMobile?: string }> = {};
  branches.forEach((b, i) => {
    const e: { branchName?: string; supervisorMobile?: string } = {};
    if (!b.branchName.trim()) e.branchName = t("customers.branchNameRequired");
    const mobile = b.supervisorMobile.trim();
    if (mobile && !PHONE_RE.test(mobile)) e.supervisorMobile = t("customers.invalidPhone");
    if (Object.keys(e).length) out[i] = e;
  });
  return out;
}

export function CustomerBranchesEditor({
  enabled, branches, errors, onToggle, onChange,
}: {
  enabled: boolean;
  branches: BranchDraft[];
  errors: Record<number, { branchName?: string; supervisorMobile?: string }>;
  onToggle: (enabled: boolean) => void;
  onChange: (branches: BranchDraft[]) => void;
}) {
  const { t } = useTranslation();

  const update = (i: number, key: keyof BranchDraft, value: string) =>
    onChange(branches.map((b, idx) => (idx === i ? { ...b, [key]: value } : b)));

  const add = () => onChange([...branches, { ...EMPTY_BRANCH }]);
  const remove = (i: number) => onChange(branches.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-3">
      {/* The optional question the requirement specifies, asked once.
          Unchecking HIDES the rows but keeps them in state, so a misclick does
          not silently destroy typed work -- re-checking restores exactly what
          was there. The form only submits an empty array when the box is
          genuinely left unchecked at save time, which is what actually clears
          stored branches. */}
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => {
            const on = e.target.checked;
            onToggle(on);
            // Seed one blank row only when turning it on with nothing to show.
            if (on && branches.length === 0) onChange([{ ...EMPTY_BRANCH }]);
          }}
          className="mt-0.5 w-4 h-4 accent-[var(--color-button)] flex-shrink-0"
        />
        <span className="min-w-0">
          <span className="block text-xs font-medium text-fg">{t("customers.hasBranches")}</span>
          <span className="block text-2xs text-fg-muted mt-0.5">{t("customers.branchesHint")}</span>
        </span>
      </label>

      {enabled && (
        <div className="space-y-3">
          {branches.map((b, i) => (
            <div key={i} className="border border-line rounded-md bg-surface-subtle p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-2xs font-semibold uppercase tracking-wide text-fg-muted">
                  {t("customers.branch")} {i + 1}
                </p>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={t("common.delete")}
                  className="w-6 h-6 rounded flex items-center justify-center text-fg-muted hover:text-danger-fg hover:bg-danger-bg transition-colors"
                >
                  <Icon name="close" className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t("customers.branchName")} htmlFor={`branch-name-${i}`} required error={errors[i]?.branchName}>
                  <Input
                    id={`branch-name-${i}`}
                    value={b.branchName}
                    onChange={e => update(i, "branchName", e.target.value)}
                    invalid={!!errors[i]?.branchName}
                  />
                </Field>
                <Field label={t("customers.branchSupervisor")} htmlFor={`branch-sup-${i}`}>
                  <Input
                    id={`branch-sup-${i}`}
                    value={b.supervisorName}
                    onChange={e => update(i, "supervisorName", e.target.value)}
                  />
                </Field>
                <Field label={t("customers.branchSupervisorMobile")} htmlFor={`branch-mob-${i}`} error={errors[i]?.supervisorMobile}>
                  <Input
                    id={`branch-mob-${i}`}
                    value={b.supervisorMobile}
                    onChange={e => update(i, "supervisorMobile", e.target.value.replace(/\D/g, "").slice(0, 10))}
                    dir="ltr"
                    inputMode="numeric"
                    placeholder="05XXXXXXXX"
                    invalid={!!errors[i]?.supervisorMobile}
                  />
                </Field>
                <Field className="sm:col-span-2" label={t("customers.branchNotes")} htmlFor={`branch-notes-${i}`}>
                  <Textarea
                    id={`branch-notes-${i}`}
                    rows={2}
                    value={b.notes}
                    onChange={e => update(i, "notes", e.target.value)}
                  />
                </Field>
              </div>
            </div>
          ))}

          <Button type="button" variant="secondary" size="sm" onClick={add}>
            <Icon name="add" className="w-3.5 h-3.5" />
            {t("customers.addBranch")}
          </Button>
        </div>
      )}
    </div>
  );
}
