import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Modal } from "../../ui/Modal";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Field";
import { Callout } from "../../ui/Feedback";
import { Icon } from "../../ui/icons";
import { TechnicianEmployee, employeeErrorKey, useTechnicianEmployees } from "../hooks/useTechnicianEmployees";

/**
 * Set or replace one technician's access code.
 *
 * Shared by the Employees page and the Access Codes page so there is exactly one
 * credential-setting flow. Note what this dialog deliberately CANNOT do: show
 * the technician's existing code. Codes are stored as one-way hashes, so the
 * only honest options are "set a new one" or nothing -- there is no recovery
 * path to offer, and inventing one would mean storing codes reversibly.
 *
 * A newly typed code is visible to the administrator while they are entering it
 * (behind a show/hide toggle, defaulting to hidden), which is the one moment
 * showing it is legitimate: they have to be able to read it back to the
 * technician.
 */
export function TechnicianAccessCodeDialog({
  technician, open, onClose,
}: {
  technician: TechnicianEmployee | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { setAccessCode } = useTechnicianEmployees();
  const [newCode, setNewCode] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState("");

  // Never carry a typed code across technicians or reopenings.
  useEffect(() => {
    if (open) { setNewCode(""); setConfirmCode(""); setReveal(false); setError(""); }
  }, [open, technician?.id]);

  const valid = /^\d{4}$/.test(newCode) && newCode === confirmCode;

  function submit() {
    if (!technician || !valid) return;
    setError("");
    setAccessCode.mutate(
      { id: technician.id, newCode, confirmCode },
      {
        onSuccess: () => {
          toast.success(t("employees.codeSaved"));
          onClose();
        },
        onError: (err) => setError(employeeErrorKey(err)),
      }
    );
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-fg-secondary mb-1.5">
        {label}<span className="text-danger-fg ms-0.5">*</span>
      </label>
      <div className="relative">
        <Input
          id={id}
          type={reveal ? "text" : "password"}
          value={value}
          // Digits only, max four -- the same constraint the server enforces.
          onChange={e => { if (/^\d{0,4}$/.test(e.target.value)) { set(e.target.value); setError(""); } }}
          maxLength={4}
          placeholder="••••"
          dir="ltr"
          inputMode="numeric"
          autoComplete="off"
          className="font-mono tracking-[0.4em] text-center pe-9"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setReveal(r => !r)}
          aria-label={reveal ? t("employees.hideCode") : t("employees.showCode")}
          className="absolute end-1 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors"
        >
          <Icon name={reveal ? "eyeOff" : "eye"} className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnBackdrop={false}
      size="sm"
      title={technician ? `${t("employees.changeAccessCode")} — ${technician.name}` : t("employees.changeAccessCode")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!valid} loading={setAccessCode.isPending} onClick={submit}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Callout tone="info">{t("employees.codeCannotBeShown")}</Callout>
        {field("tech-new-code", t("accessCodes.newCode"), newCode, setNewCode)}
        {field("tech-confirm-code", t("accessCodes.confirmCode"), confirmCode, setConfirmCode)}
        {confirmCode && newCode !== confirmCode && (
          <p className="text-2xs text-danger-fg flex items-center gap-1">
            <Icon name="urgent" className="w-3 h-3" />
            {t("accessCodes.errMismatch")}
          </p>
        )}
        {error && (
          <p className="text-2xs text-danger-fg flex items-center gap-1">
            <Icon name="urgent" className="w-3 h-3" />
            {t(error)}
          </p>
        )}
      </div>
    </Modal>
  );
}
