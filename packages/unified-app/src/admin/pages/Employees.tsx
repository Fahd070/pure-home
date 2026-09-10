import React, { useState } from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";
import { PageHeader } from "../../ui/Surface";
import { Button } from "../../ui/Button";
import { Input, Field } from "../../ui/Field";
import { Badge } from "../../ui/Badge";
import { Modal } from "../../ui/Modal";
import { Callout, EmptyState, Loading } from "../../ui/Feedback";
import { Icon } from "../../ui/icons";
import { cx } from "../../ui/cx";
import { TechnicianAccessCodeDialog } from "../components/TechnicianAccessCodeDialog";
import {
  TechnicianEmployee,
  employeeErrorKey,
  useTechnicianEmployees,
} from "../hooks/useTechnicianEmployees";

/**
 * Administration -> Employees.
 *
 * Manages the technician accounts that authentication, appointment assignment
 * and audit attribution all already use -- the same records the Access Codes
 * page shows, through the same hook. This page never creates a parallel
 * employee list.
 *
 * Every technician created here receives TECHNICIAN permissions from the
 * existing role model. There is deliberately no role selector: the server
 * hardcodes the role, so this screen cannot be used to grant stronger access.
 */
export default function Employees() {
  const { t } = useTranslation();
  const { list, migration, completeCutover, create, update } = useTechnicianEmployees();
  const qc = useQueryClient();
  const socket = useSocket();

  // Another administrator adding, renaming or configuring a technician -- or
  // completing the cutover -- must be reflected here without a manual refresh.
  useEffect(() => {
    if (!socket) return;
    const onConfigUpdated = (data: any) => {
      if (data?.type !== "technician-employees" && data?.type !== "technician-cutover") return;
      qc.invalidateQueries({ queryKey: ["technician-employees"] });
      qc.invalidateQueries({ queryKey: ["technician-migration"] });
    };
    socket.on("config:updated", onConfigUpdated);
    return () => { socket.off("config:updated", onConfigUpdated); };
  }, [socket, qc]);

  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCode, setAddCode] = useState("");
  const [addError, setAddError] = useState("");

  const [renameTarget, setRenameTarget] = useState<TechnicianEmployee | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [codeTarget, setCodeTarget] = useState<TechnicianEmployee | null>(null);
  const [showCutover, setShowCutover] = useState(false);

  // The list contains ONLY real individual technician employees -- the server
  // excludes the legacy shared account, which is a migration bridge rather than
  // an employee identity.
  const employees = list.data || [];
  // Authoritative migration state, from the server. Never re-derived here:
  // retirement is durable one-way state and eligibility deliberately excludes
  // the legacy account, neither of which a roster snapshot can express.
  const retired = migration.data?.sharedLoginRetired === true;
  const canCutover = migration.data?.canCompleteCutover === true;
  const withoutCode = migration.data?.techniciansWithoutCode ?? 0;

  function submitAdd() {
    const name = addName.trim();
    if (!name) return;
    if (addCode && !/^\d{4}$/.test(addCode)) { setAddError("accessCodes.mustBe4Digits"); return; }
    setAddError("");
    create.mutate(
      { name, ...(addCode ? { accessCode: addCode } : {}) },
      {
        onSuccess: () => {
          toast.success(t("employees.created"));
          setShowAdd(false); setAddName(""); setAddCode("");
        },
        onError: (err) => setAddError(employeeErrorKey(err)),
      }
    );
  }

  function submitRename() {
    const name = renameValue.trim();
    if (!renameTarget || !name) return;
    update.mutate(
      { id: renameTarget.id, name },
      {
        onSuccess: () => { toast.success(t("employees.renamed")); setRenameTarget(null); },
        onError: (err) => toast.error(t(employeeErrorKey(err))),
      }
    );
  }

  function toggleActive(emp: TechnicianEmployee) {
    update.mutate(
      { id: emp.id, isActive: !emp.isActive },
      {
        onSuccess: () => toast.success(t(emp.isActive ? "employees.deactivated" : "employees.reactivated")),
        onError: (err) => toast.error(t(employeeErrorKey(err))),
      }
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title={t("employees.title")}
        subtitle={t("employees.subtitle")}
        actions={
          <Button variant="primary" onClick={() => { setShowAdd(true); setAddError(""); }}>
            <Icon name="add" className="w-3.5 h-3.5" />
            {t("employees.addTechnician")}
          </Button>
        }
      />

      {/* The transition state, stated where the administrator is actually making
          the decision rather than buried in a release note. The shared code is
          retired only once EVERY active technician has a personal code, so
          partial setup is a safe, explicitly-communicated state rather than a
          lockout. */}
      {/* Migration status panel -- deliberately NOT an employee card. The legacy
          shared login is a temporary bridge, so its state is reported here as
          setup information rather than as a technician row in the list. */}
      <section className="bg-surface border border-line rounded-md">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
          <span
            className="w-7 h-7 rounded-md bg-surface-subtle border border-line-subtle flex items-center justify-center text-fg-muted flex-shrink-0"
            aria-hidden="true"
          >
            <Icon name="accessCodes" className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-fg">{t("employees.legacyAccessTitle")}</h3>
          </div>
          <Badge tone={retired ? "neutral" : "warning"} dot>
            {retired ? t("employees.legacyRetired") : t("employees.legacyActive")}
          </Badge>
        </div>

        {!retired && (
          <div className="p-4 space-y-3">
            <p className="text-xs text-fg-secondary">{t("employees.legacyAccessDesc")}</p>

            {withoutCode > 0 && (
              <Callout tone="warning">
                {t("employees.cutoverBlockedMissingCodes", { count: withoutCode })}
              </Callout>
            )}
            {employees.length === 0 && (
              <Callout tone="info">{t("employees.cutoverBlockedNoTechnicians")}</Callout>
            )}

            <div className="flex justify-end">
              <Button
                variant="primary"
                disabled={!canCutover}
                onClick={() => setShowCutover(true)}
              >
                {t("employees.completeCutover")}
              </Button>
            </div>
          </div>
        )}
      </section>

      {list.isLoading ? (
        <Loading />
      ) : employees.length === 0 ? (
        <EmptyState icon={<Icon name="technicians" className="w-5 h-5" />} title={t("employees.none")} />
      ) : (
        <div className="bg-surface border border-line rounded-md divide-y divide-line-subtle">
          {employees.map(emp => (
            <div
              key={emp.id}
              className={cx(
                "flex flex-wrap items-center gap-3 px-4 py-3",
                !emp.isActive && "opacity-60"
              )}
            >
              <span
                className="w-8 h-8 rounded-md bg-surface-subtle border border-line-subtle flex items-center justify-center text-fg-muted flex-shrink-0"
                aria-hidden="true"
              >
                <Icon name="technicians" className="w-4 h-4" />
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-[0.8125rem] font-medium text-fg truncate">{emp.name}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {emp.hasAccessCode ? (
                    // Masked state only. The real code is unreadable by design.
                    <Badge tone="success" dot>
                      <span className="font-mono tracking-[0.3em]" dir="ltr">••••</span>
                    </Badge>
                  ) : (
                    <Badge tone="warning" dot>{t("employees.noCodeYet")}</Badge>
                  )}
                  {!emp.isActive && <Badge tone="neutral">{t("common.inactive")}</Badge>}
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Button
                  size="sm" variant="secondary"
                  onClick={() => { setRenameTarget(emp); setRenameValue(emp.name); }}
                >
                  {t("employees.rename")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setCodeTarget(emp)}>
                  {emp.hasAccessCode ? t("employees.changeAccessCode") : t("employees.setAccessCode")}
                </Button>
                <Button
                  size="sm"
                  variant={emp.isActive ? "secondary" : "primary"}
                  loading={update.isPending && update.variables?.id === emp.id}
                  onClick={() => toggleActive(emp)}
                >
                  {emp.isActive ? t("employees.deactivate") : t("employees.reactivate")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add technician */}
      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        closeOnBackdrop={false}
        size="sm"
        title={t("employees.addTechnician")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowAdd(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={!addName.trim()} loading={create.isPending} onClick={submitAdd}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t("employees.name")} htmlFor="emp-name" required>
            <Input id="emp-name" value={addName} onChange={e => { setAddName(e.target.value); setAddError(""); }} autoFocus />
          </Field>
          <Field label={t("employees.accessCodeOptional")} htmlFor="emp-code">
            <Input
              id="emp-code" type="password" value={addCode}
              onChange={e => { if (/^\d{0,4}$/.test(e.target.value)) { setAddCode(e.target.value); setAddError(""); } }}
              maxLength={4} placeholder="••••" dir="ltr" inputMode="numeric" autoComplete="off"
              className="font-mono tracking-[0.4em] text-center"
            />
          </Field>
          <p className="text-2xs text-fg-muted">{t("employees.accessCodeLaterHint")}</p>
          {addError && (
            <p className="text-2xs text-danger-fg flex items-center gap-1">
              <Icon name="urgent" className="w-3 h-3" />
              {t(addError)}
            </p>
          )}
        </div>
      </Modal>

      {/* Rename */}
      <Modal
        open={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        size="sm"
        title={t("employees.rename")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameTarget(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={!renameValue.trim()} loading={update.isPending} onClick={submitRename}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <Field label={t("employees.name")} htmlFor="emp-rename" required>
          <Input id="emp-rename" value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus />
        </Field>
      </Modal>

      {/* Deliberately a confirmation, not a one-click action: this is
          irreversible and disables access for anyone still on the shared code. */}
      <Modal
        open={showCutover}
        onClose={() => setShowCutover(false)}
        closeOnBackdrop={false}
        size="sm"
        title={t("employees.completeCutover")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCutover(false)}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              loading={completeCutover.isPending}
              onClick={() =>
                completeCutover.mutate(undefined, {
                  onSuccess: () => { toast.success(t("employees.cutoverDone")); setShowCutover(false); },
                  onError: (err) => toast.error(t(employeeErrorKey(err))),
                })
              }
            >
              {t("employees.confirmCutover")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Callout tone="warning">{t("employees.cutoverWarning")}</Callout>
          <ul className="text-xs text-fg-secondary list-disc ps-5 space-y-1">
            <li>{t("employees.cutoverPoint1")}</li>
            <li>{t("employees.cutoverPoint2")}</li>
            <li>{t("employees.cutoverPoint3")}</li>
          </ul>
        </div>
      </Modal>

      <TechnicianAccessCodeDialog
        technician={codeTarget}
        open={!!codeTarget}
        onClose={() => setCodeTarget(null)}
      />
    </div>
  );
}
