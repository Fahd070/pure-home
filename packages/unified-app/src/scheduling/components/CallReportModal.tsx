import React from "react";
import { useTranslation } from "react-i18next";
import CallReportForm, { CallReportPresetCustomer } from "./CallReportForm";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";
import { Modal } from "../../ui/Modal";

// Modification #11: modal wrapper around the shared CallReportForm, used by
// the Dashboard "Call Report" shortcut. The standalone Call Reports page keeps
// its own existing inline-panel presentation unchanged -- this is purely an
// alternate container around the exact same form/save logic.
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
