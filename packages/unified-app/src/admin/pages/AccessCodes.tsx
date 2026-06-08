import React, { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";

const DEPTS = [
  { key: "admin",      labelKey: "accessCodes.adminDept",     icon: "🏢", accent: "border-blue-500",   ring: "focus:ring-blue-400",  badge: "bg-blue-100 text-blue-700"   },
  { key: "scheduling", labelKey: "accessCodes.schedulingDept", icon: "📅", accent: "border-green-500",  ring: "focus:ring-green-400", badge: "bg-green-100 text-green-700" },
  { key: "technician", labelKey: "accessCodes.technicianDept", icon: "🔧", accent: "border-orange-500", ring: "focus:ring-orange-400",badge: "bg-orange-100 text-orange-700"},
] as const;

type DeptKey = "admin" | "scheduling" | "technician";

interface FormState {
  currentCode: string;
  newCode: string;
  confirmCode: string;
  showCurrent: boolean;
  showNew: boolean;
  showConfirm: boolean;
  serverError: string;
  success: boolean;
}

const blankForm = (): FormState => ({
  currentCode: "", newCode: "", confirmCode: "",
  showCurrent: false, showNew: false, showConfirm: false,
  serverError: "", success: false,
});

function validate(f: FormState): { currentCode?: string; newCode?: string; confirmCode?: string } {
  const e: { currentCode?: string; newCode?: string; confirmCode?: string } = {};
  if (!f.currentCode) e.currentCode = "accessCodes.errRequired";
  if (!f.newCode) e.newCode = "accessCodes.errRequired";
  else if (!/^\d{4}$/.test(f.newCode)) e.newCode = "accessCodes.mustBe4Digits";
  if (!f.confirmCode) e.confirmCode = "accessCodes.errRequired";
  else if (f.newCode && f.confirmCode && f.newCode !== f.confirmCode) e.confirmCode = "accessCodes.errMismatch";
  return e;
}

export default function AccessCodes() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const socket = useSocket();

  const [forms, setForms] = useState<Record<DeptKey, FormState>>({
    admin:      blankForm(),
    scheduling: blankForm(),
    technician: blankForm(),
  });
  const [touched, setTouched] = useState<Record<DeptKey, Partial<Record<keyof FormState, boolean>>>>({
    admin: {}, scheduling: {}, technician: {},
  });

  useEffect(() => {
    if (!socket) return;
    const onConfigUpdated = (data: any) => {
      if (data?.updatedDepts) {
        data.updatedDepts.forEach((dept: DeptKey) => {
          setForms(f => ({ ...f, [dept]: blankForm() }));
          setTouched(t => ({ ...t, [dept]: {} }));
        });
      }
      toast(t("accessCodes.codesUpdatedRemotely"), { icon: "🔄" });
      qc.invalidateQueries({ queryKey: ["access-codes"] });
    };
    socket.on("config:updated", onConfigUpdated);
    return () => socket.off("config:updated", onConfigUpdated);
  }, [socket, qc, t]);

  const updateCode = useMutation({
    mutationFn: ({ dept, currentCode, newCode, confirmCode }: { dept: DeptKey } & Pick<FormState, "currentCode" | "newCode" | "confirmCode">) =>
      api.put("/config/access-codes", { dept, currentCode, newCode, confirmCode }),
    onSuccess: (_, { dept }) => {
      setForms(f => ({ ...f, [dept]: { ...blankForm(), success: true } }));
      setTouched(t => ({ ...t, [dept]: {} }));
      toast.success(t("accessCodes.codeSaved"));
      setTimeout(() => setForms(f => ({ ...f, [dept]: blankForm() })), 3000);
    },
    onError: (err: any, { dept }) => {
      const msg = err?.response?.data?.error || t("common.error");
      const isWrongCurrent = msg.toLowerCase().includes("incorrect") || msg.toLowerCase().includes("current");
      setForms(f => ({
        ...f,
        [dept]: { ...f[dept], serverError: msg, success: false, currentCode: isWrongCurrent ? "" : f[dept].currentCode },
      }));
    },
  });

  const setField = (dept: DeptKey, field: keyof FormState, value: string | boolean) => {
    setForms(f => ({ ...f, [dept]: { ...f[dept], [field]: value, serverError: "", success: false } }));
  };

  const markTouched = (dept: DeptKey, field: keyof FormState) => {
    setTouched(t => ({ ...t, [dept]: { ...t[dept], [field]: true } }));
  };

  const handleSubmit = (dept: DeptKey) => {
    setTouched(t => ({ ...t, [dept]: { currentCode: true, newCode: true, confirmCode: true } }));
    const errs = validate(forms[dept]);
    if (Object.keys(errs).length > 0) return;
    const f = forms[dept];
    updateCode.mutate({ dept, currentCode: f.currentCode, newCode: f.newCode, confirmCode: f.confirmCode });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-slate-800">{t("accessCodes.title")}</h1>
        <p className="text-sm text-slate-500 mt-1">{t("accessCodes.subtitle")}</p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
        <span className="text-amber-500 text-lg flex-shrink-0">⚠️</span>
        <p className="text-sm text-amber-700">{t("accessCodes.securityNote")}</p>
      </div>

      <div className="space-y-5">
        {DEPTS.map(dept => {
          const deptKey = dept.key as DeptKey;
          const form = forms[deptKey];
          const touch = touched[deptKey];
          const errs = validate(form);
          const isPending = updateCode.isPending && updateCode.variables?.dept === deptKey;

          return (
            <div key={deptKey} className={`bg-white rounded-xl border-l-4 shadow-sm p-5 ${dept.accent}`}>
              {/* Header */}
              <div className="flex items-center gap-3 mb-5">
                <span className="text-2xl">{dept.icon}</span>
                <div>
                  <h3 className="font-semibold text-slate-800">{t(dept.labelKey)}</h3>
                  <p className="text-xs text-slate-400">{t("accessCodes.deptCodeDesc")}</p>
                </div>
                {form.success && (
                  <span className={`ml-auto text-xs px-2.5 py-1 rounded-full font-medium ${dept.badge}`}>
                    ✓ {t("accessCodes.codeSaved")}
                  </span>
                )}
              </div>

              {form.success ? (
                <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                  <span className="text-green-500 text-lg">✓</span>
                  <p className="text-sm text-green-700 font-medium">{t("accessCodes.updateSuccess")}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Current Code */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t("accessCodes.currentCode")} <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={form.showCurrent ? "text" : "password"}
                        value={form.currentCode}
                        onChange={e => { if (/^\d{0,4}$/.test(e.target.value)) setField(deptKey, "currentCode", e.target.value); }}
                        onBlur={() => markTouched(deptKey, "currentCode")}
                        maxLength={4}
                        placeholder="••••"
                        className={`w-full border rounded-lg px-3 py-2.5 text-base font-mono tracking-widest focus:outline-none focus:ring-2 pr-10 ${dept.ring} ${
                          touch.currentCode && (errs.currentCode || form.serverError) ? "border-red-400" : "border-slate-200"
                        }`}
                      />
                      <button type="button" tabIndex={-1}
                        onClick={() => setField(deptKey, "showCurrent", !form.showCurrent)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">
                        {form.showCurrent ? "🙈" : "👁"}
                      </button>
                    </div>
                    {touch.currentCode && errs.currentCode && (
                      <p className="text-xs text-red-500 mt-1">{t(errs.currentCode)}</p>
                    )}
                    {form.serverError && (
                      <p className="text-xs text-red-600 mt-1 font-medium">⚠ {t("accessCodes.errWrongCurrent")}</p>
                    )}
                  </div>

                  {/* New Code */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t("accessCodes.newCode")} <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={form.showNew ? "text" : "password"}
                        value={form.newCode}
                        onChange={e => { if (/^\d{0,4}$/.test(e.target.value)) setField(deptKey, "newCode", e.target.value); }}
                        onBlur={() => markTouched(deptKey, "newCode")}
                        maxLength={4}
                        placeholder="••••"
                        className={`w-full border rounded-lg px-3 py-2.5 text-base font-mono tracking-widest focus:outline-none focus:ring-2 pr-10 ${dept.ring} ${
                          touch.newCode && errs.newCode ? "border-red-400" : "border-slate-200"
                        }`}
                      />
                      <button type="button" tabIndex={-1}
                        onClick={() => setField(deptKey, "showNew", !form.showNew)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">
                        {form.showNew ? "🙈" : "👁"}
                      </button>
                    </div>
                    {touch.newCode && errs.newCode && (
                      <p className="text-xs text-red-500 mt-1">{t(errs.newCode)}</p>
                    )}
                  </div>

                  {/* Confirm Code */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t("accessCodes.confirmCode")} <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={form.showConfirm ? "text" : "password"}
                        value={form.confirmCode}
                        onChange={e => { if (/^\d{0,4}$/.test(e.target.value)) setField(deptKey, "confirmCode", e.target.value); }}
                        onBlur={() => markTouched(deptKey, "confirmCode")}
                        maxLength={4}
                        placeholder="••••"
                        className={`w-full border rounded-lg px-3 py-2.5 text-base font-mono tracking-widest focus:outline-none focus:ring-2 pr-10 ${dept.ring} ${
                          touch.confirmCode && errs.confirmCode ? "border-red-400" : "border-slate-200"
                        }`}
                      />
                      <button type="button" tabIndex={-1}
                        onClick={() => setField(deptKey, "showConfirm", !form.showConfirm)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">
                        {form.showConfirm ? "🙈" : "👁"}
                      </button>
                    </div>
                    {touch.confirmCode && errs.confirmCode && (
                      <p className="text-xs text-red-500 mt-1">{t(errs.confirmCode)}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleSubmit(deptKey)}
                      disabled={isPending}
                      className="flex-1 bg-blue-700 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      {isPending ? t("common.loading") : t("accessCodes.updateCode")}
                    </button>
                    <button
                      onClick={() => { setForms(f => ({ ...f, [deptKey]: blankForm() })); setTouched(t => ({ ...t, [deptKey]: {} })); }}
                      className="px-4 py-2.5 border border-slate-200 text-slate-500 rounded-lg text-sm hover:bg-slate-50 transition-colors">
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
