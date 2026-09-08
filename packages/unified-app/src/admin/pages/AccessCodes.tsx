import React, { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Field";
import { Badge } from "../../ui/Badge";
import { PageHeader } from "../../ui/Surface";
import { Callout } from "../../ui/Feedback";
import { Icon, IconName } from "../../ui/icons";
import { cx } from "../../ui/cx";

const DEPTS: { key: string; labelKey: string; icon: IconName }[] = [
  { key: "admin",      labelKey: "accessCodes.adminDept",      icon: "dashboard" },
  { key: "scheduling", labelKey: "accessCodes.schedulingDept", icon: "appointments" },
  { key: "technician", labelKey: "accessCodes.technicianDept", icon: "technicians" },
];

type DeptKey = "admin" | "scheduling" | "technician";

interface FormState {
  currentCode: string;
  newCode:     string;
  confirmCode: string;
  showCurrent: boolean;
  showNew:     boolean;
  showConfirm: boolean;
  serverError: string; // error code: WRONG_CURRENT | MISMATCH | VALIDATION | SERVER
  success:     boolean;
}

const blank = (): FormState => ({
  currentCode: "", newCode: "", confirmCode: "",
  showCurrent: false, showNew: false, showConfirm: false,
  serverError: "", success: false,
});

function clientErrors(f: FormState): { currentCode?: string; newCode?: string; confirmCode?: string } {
  const e: { currentCode?: string; newCode?: string; confirmCode?: string } = {};
  if (!f.currentCode)                              e.currentCode = "accessCodes.errRequired";
  if (!f.newCode)                                  e.newCode     = "accessCodes.errRequired";
  else if (!/^\d{4}$/.test(f.newCode))             e.newCode     = "accessCodes.mustBe4Digits";
  if (!f.confirmCode)                              e.confirmCode = "accessCodes.errRequired";
  else if (f.newCode && f.newCode !== f.confirmCode) e.confirmCode = "accessCodes.errMismatch";
  return e;
}

export default function AccessCodes() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const socket = useSocket();

  const [forms, setForms]   = useState<Record<DeptKey, FormState>>({ admin: blank(), scheduling: blank(), technician: blank() });
  const [touched, setTouched] = useState<Record<DeptKey, Partial<Record<keyof FormState, boolean>>>>({ admin: {}, scheduling: {}, technician: {} });

  useEffect(() => {
    if (!socket) return;
    const onConfigUpdated = (data: any) => {
      if (data?.updatedDepts) {
        (data.updatedDepts as DeptKey[]).forEach(dept => {
          setForms(f => ({ ...f, [dept]: blank() }));
          setTouched(t => ({ ...t, [dept]: {} }));
        });
      }
      qc.invalidateQueries({ queryKey: ["access-codes"] });
      toast(t("accessCodes.codesUpdatedRemotely"), { icon: "🔄" });
    };
    socket.on("config:updated", onConfigUpdated);
    return () => { socket.off("config:updated", onConfigUpdated); };
  }, [socket, qc, t]);

  const updateCode = useMutation({
    mutationFn: ({ dept, currentCode, newCode, confirmCode }: { dept: DeptKey } & Pick<FormState, "currentCode" | "newCode" | "confirmCode">) =>
      api.put("/config/access-codes", { dept, currentCode, newCode, confirmCode }),
    onSuccess: (_res, { dept }) => {
      setForms(f => ({ ...f, [dept]: { ...blank(), success: true } }));
      setTouched(t => ({ ...t, [dept]: {} }));
      toast.success(t("accessCodes.codeSaved"));
      setTimeout(() => setForms(f => ({ ...f, [dept]: blank() })), 3500);
    },
    onError: (err: any, { dept }) => {
      const errorCode: string = err?.response?.data?.error || "SERVER";
      const isWrongCurrent = errorCode === "WRONG_CURRENT";
      setForms(f => ({
        ...f,
        [dept]: {
          ...f[dept],
          serverError: errorCode,
          success: false,
          currentCode: isWrongCurrent ? "" : f[dept].currentCode,
        },
      }));
      if (errorCode === "SERVER") toast.error(t("common.error"));
    },
  });

  const setField = (dept: DeptKey, field: keyof FormState, value: string | boolean) =>
    setForms(f => ({ ...f, [dept]: { ...f[dept], [field]: value, serverError: "", success: false } }));

  const markTouched = (dept: DeptKey, field: keyof FormState) =>
    setTouched(t => ({ ...t, [dept]: { ...t[dept], [field]: true } }));

  const handleSubmit = (dept: DeptKey) => {
    setTouched(t => ({ ...t, [dept]: { currentCode: true, newCode: true, confirmCode: true } }));
    if (Object.keys(clientErrors(forms[dept])).length > 0) return;
    const f = forms[dept];
    updateCode.mutate({ dept, currentCode: f.currentCode, newCode: f.newCode, confirmCode: f.confirmCode });
  };

  /**
   * One 4-digit code field with its show/hide toggle. The toggle used to be an
   * emoji that changed width between states, which nudged the input; it is now
   * a fixed-size icon button that also announces itself to a screen reader.
   */
  const codeField = (
    dk: DeptKey,
    id: string,
    label: string,
    valueKey: "currentCode" | "newCode" | "confirmCode",
    showKey: "showCurrent" | "showNew" | "showConfirm",
    error?: string,
  ) => {
    const form = forms[dk];
    return (
      <div>
        <label htmlFor={id} className="block text-xs font-medium text-fg-secondary mb-1.5">
          {label}<span className="text-danger-fg ms-0.5">*</span>
        </label>
        <div className="relative">
          <Input
            id={id}
            type={form[showKey] ? "text" : "password"}
            value={form[valueKey]}
            onChange={e => { if (/^\d{0,4}$/.test(e.target.value)) setField(dk, valueKey, e.target.value); }}
            onBlur={() => markTouched(dk, valueKey)}
            maxLength={4}
            placeholder="••••"
            dir="ltr"
            inputMode="numeric"
            invalid={!!error}
            className="font-mono tracking-[0.4em] text-center pe-9"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setField(dk, showKey, !form[showKey])}
            aria-label={form[showKey] ? "Hide code" : "Show code"}
            className="absolute end-1 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors"
          >
            <Icon name={form[showKey] ? "eyeOff" : "eye"} className="w-4 h-4" />
          </button>
        </div>
        {error && (
          <p className="text-2xs text-danger-fg mt-1.5 flex items-center gap-1">
            <Icon name="urgent" className="w-3 h-3" />
            {t(error)}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <PageHeader title={t("accessCodes.title")} subtitle={t("accessCodes.subtitle")} />

      <Callout tone="warning">{t("accessCodes.securityNote")}</Callout>

      <div className="space-y-3">
        {DEPTS.map(dept => {
          const dk    = dept.key as DeptKey;
          const form  = forms[dk];
          const touch = touched[dk];
          const errs  = clientErrors(form);
          const isPending = updateCode.isPending && updateCode.variables?.dept === dk;

          return (
            <section key={dk} className="bg-surface border border-line rounded-md">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
                <span
                  className="w-7 h-7 rounded-md bg-surface-subtle border border-line-subtle flex items-center justify-center text-fg-muted flex-shrink-0"
                  aria-hidden="true"
                >
                  <Icon name={dept.icon} className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-fg">{t(dept.labelKey)}</h3>
                  <p className="text-2xs text-fg-muted">{t("accessCodes.deptCodeDesc")}</p>
                </div>
                {form.success && (
                  <span className="ms-auto flex-shrink-0">
                    <Badge tone="success" dot>{t("accessCodes.codeSaved")}</Badge>
                  </span>
                )}
              </div>

              <div className="p-4">
                {form.success ? (
                  <Callout tone="success">{t("accessCodes.updateSuccess")}</Callout>
                ) : (
                  <div className="space-y-3">
                    {codeField(
                      dk, `${dk}-current`, t("accessCodes.currentCode"), "currentCode", "showCurrent",
                      (touch.currentCode && errs.currentCode) || undefined
                    )}
                    {form.serverError === "WRONG_CURRENT" && (
                      <p className="text-2xs text-danger-fg font-medium flex items-center gap-1">
                        <Icon name="urgent" className="w-3 h-3" />
                        {t("accessCodes.errWrongCurrent")}
                      </p>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {codeField(
                        dk, `${dk}-new`, t("accessCodes.newCode"), "newCode", "showNew",
                        (touch.newCode && errs.newCode) || undefined
                      )}
                      {codeField(
                        dk, `${dk}-confirm`, t("accessCodes.confirmCode"), "confirmCode", "showConfirm",
                        (touch.confirmCode && errs.confirmCode) || undefined
                      )}
                    </div>
                    {form.serverError === "MISMATCH" && (
                      <p className="text-2xs text-danger-fg font-medium flex items-center gap-1">
                        <Icon name="urgent" className="w-3 h-3" />
                        {t("accessCodes.errMismatch")}
                      </p>
                    )}

                    <div className="flex gap-2 justify-end pt-1">
                      <Button
                        variant="secondary"
                        onClick={() => { setForms(f => ({ ...f, [dk]: blank() })); setTouched(tt => ({ ...tt, [dk]: {} })); }}
                      >
                        {t("common.cancel")}
                      </Button>
                      <Button variant="primary" loading={isPending} onClick={() => handleSubmit(dk)}>
                        {t("accessCodes.updateCode")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
