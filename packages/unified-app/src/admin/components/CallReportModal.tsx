import React from "react";
import { useTranslation } from "react-i18next";
import CallReportForm, { CallReportPresetCustomer } from "./CallReportForm";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";
import { Modal } from "../../ui/Modal";

// Dashboard parity fix: Admin's own copy of Modification #11's modal wrapper
// (scheduling/components/CallReportModal.tsx), around Admin's own CallReportForm.
// Admin is already authorized by the same existing Call Reports subsystem
// (POST/GET /call-reports are requireRole('ADMIN','SCHEDULING')), so this is a
// same-authorization UI parity fix, not a new grant.
export default function CallReportModal({
  customer, onClose,
}: {
  customer: CallReportPresetCustomer;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open
      onClose={onClose}
      closeOnBackdrop={false}
      size="md"
      title={
        <span className="flex items-center gap-2">
          {t("callReports.action")} — {customer.name}
          <HelpButton titleAr={HELP["form.callReport"].titleAr} contentAr={HELP["form.callReport"].contentAr} />
        </span>
      }
    >
      <CallReportForm presetCustomer={customer} onSaved={onClose} onCancel={onClose} />
    </Modal>
  );
}
