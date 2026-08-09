import React from "react";
import { useTranslation } from "react-i18next";
import CallReportForm, { CallReportPresetCustomer } from "./CallReportForm";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-800">📞 {t("callReports.action")} — {customer.name}</h3>
            <HelpButton titleAr={HELP["form.callReport"].titleAr} contentAr={HELP["form.callReport"].contentAr} />
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center">✕</button>
        </div>
        <div className="p-4">
          <CallReportForm presetCustomer={customer} onSaved={onClose} onCancel={onClose} />
        </div>
      </div>
    </div>
  );
}
