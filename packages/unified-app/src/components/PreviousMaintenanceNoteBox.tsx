import { useTranslation } from "react-i18next";
import { Callout } from "../ui/Feedback";

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
    <Callout tone="info" title={t("appointments.previousMaintenanceNote")}>
      <p className="whitespace-pre-wrap">{note}</p>
    </Callout>
  );
}
