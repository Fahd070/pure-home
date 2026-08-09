import React, { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";

// Modification #10: dedicated Admin-only page for appointments Scheduling/
// Maintenance has exported (Modification #5) and that are still awaiting
// Admin approval. Reuses Modification #5's existing backend entirely -- the
// new GET /appointments/pending-export-approval query and the PATCH
// /appointments/:id/approve-export action are unchanged from Modification #5;
// this page is only a dedicated UI surface for them (previously, approval was
// only reachable from inside the general Admin Appointments table).
export default function AppointmentAcceptance() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const socket = useSocket();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["pending-export-approval"],
    queryFn: () => api.get("/appointments/pending-export-approval").then(r => r.data.data),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/appointments/${id}/approve-export`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-export-approval"] });
      toast.success(t("appointments.approveExportSuccess"));
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || t("appointments.approveExportError")),
  });

  // The same appointment:status event Modification #5 already emits both when
  // Scheduling exports (so this list picks up new pending items live) and when
  // an appointment is approved from elsewhere -- e.g. a second Admin's tab, or
  // this page's own approval, which already invalidates via onSuccess above.
  useEffect(() => {
    if (!socket) return;
    const refresh = () => qc.invalidateQueries({ queryKey: ["pending-export-approval"] });
    socket.on("appointment:status", refresh);
    return () => { socket.off("appointment:status", refresh); };
  }, [socket, qc]);

  const appointments: any[] = data || [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">{t("nav.appointmentAcceptance")}</h1>
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <p className="text-center py-8 text-slate-400">{t("common.loading")}</p>
        ) : isError ? (
          <p className="text-center py-8 text-red-400">{t("common.error")}</p>
        ) : appointments.length === 0 ? (
          <p className="text-center py-8 text-slate-400">{t("appointments.noAppointmentsAwaitingApproval")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-start px-4 py-3">{t("appointments.customer")}</th>
                  <th className="text-start px-4 py-3">{t("appointments.type")}</th>
                  <th className="text-start px-4 py-3">{t("common.date")}</th>
                  <th className="text-start px-4 py-3">{isAr ? "الموقع" : "Location"}</th>
                  <th className="text-start px-4 py-3">{t("appointments.technician")}</th>
                  <th className="text-start px-4 py-3">{t("common.notes")}</th>
                  <th className="text-start px-4 py-3">{t("appointments.approveExport")}</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((a: any) => {
                  const addr = a.customer?.address;
                  const approving = approveMutation.isPending && approveMutation.variables === a.id;
                  return (
                    <tr key={a.id} className="border-b hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium">{a.customer?.name || "—"}</p>
                        <p className="text-slate-400 text-xs">{a.customer?.phone}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {a.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {new Date(a.scheduledDate).toLocaleString(isAr ? "ar-SA" : undefined)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {addr ? [addr.city, addr.district].filter(Boolean).join("، ") : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{a.technician?.name || "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-[160px] truncate">{a.notes || "—"}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => approveMutation.mutate(a.id)}
                          disabled={approving}
                          className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 whitespace-nowrap disabled:opacity-50 transition-colors">
                          {approving ? t("common.loading") : t("appointments.approveExport")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
