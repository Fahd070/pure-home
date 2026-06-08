import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";

const DEPTS = [
  { key: "admin",      labelKey: "accessCodes.adminDept",     icon: "🏢", color: "border-blue-500 bg-blue-50" },
  { key: "scheduling", labelKey: "accessCodes.schedulingDept", icon: "📅", color: "border-green-500 bg-green-50" },
  { key: "technician", labelKey: "accessCodes.technicianDept", icon: "🔧", color: "border-orange-500 bg-orange-50" },
] as const;

type DeptKey = "admin" | "scheduling" | "technician";

export default function AccessCodes() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const socket = useSocket();
  const [codes, setCodes] = useState<Record<DeptKey, string>>({ admin: "", scheduling: "", technician: "" });
  const [visible, setVisible] = useState<Record<DeptKey, boolean>>({ admin: false, scheduling: false, technician: false });
  const [editing, setEditing] = useState<Record<DeptKey, string>>({ admin: "", scheduling: "", technician: "" });
  const [dirty, setDirty] = useState<Record<DeptKey, boolean>>({ admin: false, scheduling: false, technician: false });

  const { data, isLoading } = useQuery({
    queryKey: ["access-codes"],
    queryFn: () => api.get("/config/access-codes").then(r => r.data.data as Record<DeptKey, string>),
  });

  useEffect(() => {
    if (data) {
      setCodes(data);
      setEditing({ admin: data.admin, scheduling: data.scheduling, technician: data.technician });
      setDirty({ admin: false, scheduling: false, technician: false });
    }
  }, [data]);

  useEffect(() => {
    if (!socket) return;
    const onConfigUpdated = () => {
      qc.invalidateQueries({ queryKey: ["access-codes"] });
      toast(t("accessCodes.codesUpdatedRemotely"), { icon: "🔄" });
    };
    socket.on("config:updated", onConfigUpdated);
    return () => socket.off("config:updated", onConfigUpdated);
  }, [socket, qc, t]);

  const updateSingle = useMutation({
    mutationFn: ({ dept, code }: { dept: DeptKey; code: string }) =>
      api.put("/config/access-codes", { [dept]: code }),
    onSuccess: (_, { dept }) => {
      qc.invalidateQueries({ queryKey: ["access-codes"] });
      setDirty(d => ({ ...d, [dept]: false }));
      toast.success(t("accessCodes.codeSaved"));
    },
    onError: () => toast.error(t("common.error")),
  });

  const updateAll = useMutation({
    mutationFn: () => api.put("/config/access-codes", editing),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["access-codes"] });
      setDirty({ admin: false, scheduling: false, technician: false });
      toast.success(t("accessCodes.allSaved"));
    },
    onError: () => toast.error(t("common.error")),
  });

  const handleChange = (dept: DeptKey, val: string) => {
    if (!/^\d{0,4}$/.test(val)) return;
    setEditing(e => ({ ...e, [dept]: val }));
    setDirty(d => ({ ...d, [dept]: val !== codes[dept] }));
  };

  const anyDirty = Object.values(dirty).some(Boolean);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-slate-400">{t("common.loading")}</div>;
  }

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

      <div className="space-y-4">
        {DEPTS.map(dept => {
          const deptKey = dept.key as DeptKey;
          const val = editing[deptKey];
          const isValid = /^\d{4}$/.test(val);
          const isDirty = dirty[deptKey];
          const isVis = visible[deptKey];
          return (
            <div key={deptKey} className={`bg-white rounded-xl border-l-4 shadow-sm p-5 ${dept.color}`}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">{dept.icon}</span>
                <div>
                  <h3 className="font-semibold text-slate-800">{t(dept.labelKey)}</h3>
                  <p className="text-xs text-slate-400">{t("accessCodes.deptCodeDesc")}</p>
                </div>
                {isDirty && (
                  <span className="ml-auto text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
                    {t("accessCodes.unsaved")}
                  </span>
                )}
              </div>
              <div className="flex gap-3 items-center">
                <div className="relative flex-1">
                  <input
                    type={isVis ? "text" : "password"}
                    value={val}
                    onChange={e => handleChange(deptKey, e.target.value)}
                    maxLength={4}
                    placeholder="••••"
                    className={`w-full border rounded-lg px-3 py-2.5 text-lg font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                      isDirty && !isValid ? "border-red-400 focus:ring-red-400" : isDirty ? "border-blue-400" : "border-slate-200"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setVisible(v => ({ ...v, [deptKey]: !v[deptKey] }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">
                    {isVis ? "🙈" : "👁"}
                  </button>
                </div>
                <button
                  onClick={() => updateSingle.mutate({ dept: deptKey, code: val })}
                  disabled={!isDirty || !isValid || updateSingle.isPending}
                  className="px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {t("accessCodes.save")}
                </button>
                {isDirty && (
                  <button
                    onClick={() => { setEditing(e => ({ ...e, [deptKey]: codes[deptKey] })); setDirty(d => ({ ...d, [deptKey]: false })); }}
                    className="px-3 py-2.5 border border-slate-200 text-slate-500 rounded-lg text-sm hover:bg-slate-50 transition-colors">
                    {t("common.cancel")}
                  </button>
                )}
              </div>
              {isDirty && !isValid && val.length > 0 && (
                <p className="text-xs text-red-500 mt-2">{t("accessCodes.mustBe4Digits")}</p>
              )}
            </div>
          );
        })}
      </div>

      {anyDirty && (
        <div className="bg-white rounded-xl shadow-sm p-4 flex items-center justify-between border border-blue-200">
          <p className="text-sm text-slate-600">{t("accessCodes.unsavedChanges")}</p>
          <div className="flex gap-2">
            <button
              onClick={() => { setEditing({ admin: codes.admin, scheduling: codes.scheduling, technician: codes.technician }); setDirty({ admin: false, scheduling: false, technician: false }); }}
              className="px-4 py-2 border rounded-lg text-sm text-slate-600 hover:bg-slate-50">
              {t("common.cancel")}
            </button>
            <button
              onClick={() => updateAll.mutate()}
              disabled={!Object.entries(dirty).filter(([,v]) => v).every(([k]) => /^\d{4}$/.test(editing[k as DeptKey])) || updateAll.isPending}
              className="px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-medium hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed">
              {updateAll.isPending ? t("common.loading") : t("accessCodes.saveAll")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
