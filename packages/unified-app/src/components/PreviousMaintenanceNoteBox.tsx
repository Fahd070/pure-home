import { useTranslation } from "react-i18next";

// Modification #7: read-only display of the technician's "Next Maintenance Note"
// (Modification #6) from a customer's most recent completed appointment, shown
// while scheduling that customer's NEXT appointment -- hence the different label
// here ("Previous Maintenance Note"). Same stored data, viewed at a different
// point in time; never editable from this box, never copied into the new
// appointment. Renders nothing if there is no note (no empty-state placeholder).
export default function PreviousMaintenanceNoteBox({ note }: { note?: string | null }) {
  const { t } = useTranslation();
  if (!note) return null;
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
      <p className="font-medium text-blue-700 mb-1">{t("appointments.previousMaintenanceNote")}</p>
      <p className="text-slate-700 whitespace-pre-wrap">{note}</p>
    </div>
  );
}
