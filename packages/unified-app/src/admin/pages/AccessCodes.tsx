import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
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
import { TechnicianAccessCodeDialog } from "../components/TechnicianAccessCodeDialog";
import { TechnicianEmployee, useTechnicianEmployees } from "../hooks/useTechnicianEmployees";

// v4 Requirement #12: the Technicians department no longer has ONE shared code.
// It is replaced below by per-technician entries drawn from the same employee
// records the Employees page manages, so this list is removed from the generic
// department rotation form.
const DEPTS: { key: string; labelKey: string; icon: IconName }[] = [
  { key: "admin",      labelKey: "accessCodes.adminDept",      icon: "dashboard" },
  { key: "scheduling", labelKey: "accessCodes.schedulingDept", icon: "appointments" },
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

  // Same records, same hook, same cache entry as the Employees page -- never a
  // second technician list maintained here.
  const { list: technicianList, migration } = useTechnicianEmployees();
  const technicians: TechnicianEmployee[] = technicianList.data || [];
  // Once retired the shared login can never authenticate again, so its rotation
  // control is hidden -- rotating a permanently dead credential is meaningless.
  const sharedRetired = migration.data?.sharedLoginRetired === true;
  const [codeTarget, setCodeTarget] = useState<TechnicianEmployee | null>(null);

  const [forms, setForms]   = useState<Record<DeptKey, FormState>>({ admin: blank(), scheduling: blank(), technician: blank() });
  const [touched, setTouched] = useState<Record<DeptKey, Partial<Record<keyof FormState, boolean>>>>({ admin: {}, scheduling: {}, technician: {} });

  useEffect(() => {
    if (!socket) return;
    const onConfigUpdated = (data: any) => {
      // Branch on the payload's own `type`. This handler previously treated EVERY
      // config event as a department-code rotation, so another admin merely
      // renaming a technician told this one their access codes had changed
      // remotely -- and it invalidated ["access-codes"], a key no query in the
      // app defines, so the roster and migration panel never actually refreshed.
      if (data?.type === "technician-employees" || data?.type === "technician-cutover") {
        qc.invalidateQueries({ queryKey: ["technician-employees"] });
        qc.invalidateQueries({ queryKey: ["technician-migration"] });
        return;
      }

      if (data?.updatedDepts) {
        (data.updatedDepts as DeptKey[]).forEach(dept => {
          setForms(f => ({ ...f, [dept]: blank() }));
          setTouched(t => ({ ...t, [dept]: {} }));
        });
        toast(t("accessCodes.codesUpdatedRemotely"), { icon: "🔄" });
      }
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

        {/* ── Technicians: one entry per technician employee ── */}
        <section className="bg-surface border border-line rounded-md">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
            <span
              className="w-7 h-7 rounded-md bg-surface-subtle border border-line-subtle flex items-center justify-center text-fg-muted flex-shrink-0"
              aria-hidden="true"
            >
              <Icon name="technicians" className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-fg">{t("accessCodes.technicianDept")}</h3>
              <p className="text-2xs text-fg-muted">{t("accessCodes.technicianPerPersonDesc")}</p>
            </div>
            <Link
              to="/admin/employees"
              className="ms-auto flex-shrink-0 text-2xs text-accent hover:underline inline-flex items-center gap-1"
            >
              {t("employees.title")}
              <Icon name="chevronEnd" className="w-3 h-3 rtl:rotate-180" />
            </Link>
          </div>

          <div className="p-4 space-y-4">
            {/* The legacy shared department code is STILL ACCEPTED for login
                until cutover, so while that is true Administration must be able
                to rotate it -- otherwise a leaked shared code could not be
                changed during the exact window it still works. It disappears
                once retirement is recorded, because from then on it cannot
                authenticate anything. */}
            {!sharedRetired && (
              <div className="rounded-md border border-warning-border bg-warning-bg p-3 space-y-3">
                <p className="text-2xs text-warning-fg">{t("accessCodes.legacySharedStillActive")}</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {codeField("technician", "technician-current", t("accessCodes.currentCode"), "currentCode", "showCurrent",
                    (touched.technician?.currentCode && clientErrors(forms.technician).currentCode) || undefined)}
                  {codeField("technician", "technician-new", t("accessCodes.newCode"), "newCode", "showNew",
                    (touched.technician?.newCode && clientErrors(forms.technician).newCode) || undefined)}
                  {codeField("technician", "technician-confirm", t("accessCodes.confirmCode"), "confirmCode", "showConfirm",
                    (touched.technician?.confirmCode && clientErrors(forms.technician).confirmCode) || undefined)}
                </div>
                {forms.technician.serverError === "WRONG_CURRENT" && (
                  <p className="text-2xs text-danger-fg font-medium">{t("accessCodes.errWrongCurrent")}</p>
                )}
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    loading={updateCode.isPending && updateCode.variables?.dept === "technician"}
                    onClick={() => handleSubmit("technician")}
                  >
                    {t("accessCodes.updateCode")}
                  </Button>
                </div>
              </div>
            )}

            {technicians.length === 0 ? (
              <Callout tone="info">{t("employees.noneAddFromEmployees")}</Callout>
            ) : (
              <div className="divide-y divide-line-subtle -my-1">
                {technicians.map(tech => (
                  <div key={tech.id} className={cx("flex items-center gap-3 py-2.5", !tech.isActive && "opacity-60")}>
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.8125rem] font-medium text-fg truncate">{tech.name}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        {tech.hasAccessCode ? (
                          // Masked only -- the stored code is a one-way hash and
                          // is never sent to the client.
                          <Badge tone="success" dot>
                            <span className="font-mono tracking-[0.3em]" dir="ltr">••••</span>
                          </Badge>
                        ) : (
                          <Badge tone="warning" dot>{t("employees.noCodeYet")}</Badge>
                        )}
                        {!tech.isActive && <Badge tone="neutral">{t("common.inactive")}</Badge>}
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => setCodeTarget(tech)}>
                      {tech.hasAccessCode ? t("employees.changeAccessCode") : t("employees.setAccessCode")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <TechnicianAccessCodeDialog
        technician={codeTarget}
        open={!!codeTarget}
        onClose={() => setCodeTarget(null)}
      />
    </div>
  );
}
