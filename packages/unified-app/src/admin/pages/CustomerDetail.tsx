import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import toast from "react-hot-toast";
import { escapeHtml as esc } from "../../utils/htmlEscape";
import { formatGregorianDate, formatGregorianDateTime } from "../../utils/dateTimeInput";
import type { AxiosInstance } from "axios";
import { Button } from "../../ui/Button";
import { Badge } from "../../ui/Badge";
import { Callout, Loading, EmptyState } from "../../ui/Feedback";
import { Table, THead, TH, TBody, TR, TD } from "../../ui/Table";
import { Icon } from "../../ui/icons";

function formatCycle(cycle: string, freq: number, isAr: boolean) {
  const n = Number(freq) || 1;
  if (cycle === "DAILY") return isAr ? `كل ${n} يوم` : `Every ${n} day${n > 1 ? "s" : ""}`;
  if (cycle === "WEEKLY") return isAr ? `كل ${n} أسبوع` : `Every ${n} week${n > 1 ? "s" : ""}`;
  if (cycle === "MONTHLY") return isAr ? `كل ${n} شهر` : `Every ${n} month${n > 1 ? "s" : ""}`;
  return cycle;
}

// Never expose the raw stored tag (CASH / BANK_CARD_PERSONAL / BANK_CARD_COMMERCIAL)
// to the user -- always shown through its translated label.
function formatInstallationPaymentMethod(method: string, t: (key: string) => string) {
  if (method === "CASH") return t("customers.paymentCash");
  if (method === "BANK_CARD_PERSONAL") return t("customers.paymentBankPersonal");
  if (method === "BANK_CARD_COMMERCIAL") return t("customers.paymentBankCommercial");
  return method;
}

export default function CustomerDetail({ apiClient = api, queryScope = "admin" }: { apiClient?: AxiosInstance; queryScope?: "admin" | "scheduling" }) {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["customer", queryScope, id], queryFn: () => apiClient.get(`/customers/${id}`).then(r => r.data.data) });

  if (isLoading) return <Loading label={t("common.loading")} />;
  if (!data) return <Callout tone="danger">{t("common.error")}</Callout>;

  const c = data;
  const addr = c.address;
  const lastMaintenance = (c.appointments || []).find((appointment: any) => appointment.workStatus === "COMPLETED");

  async function handleExportPdf() {
    const dir = isAr ? "rtl" : "ltr";
    const apptRows = (c.appointments || []).map((a: any) => `
      <tr>
        <td dir="ltr">${formatGregorianDate(a.scheduledDate)}</td>
        <td>${a.type === "INSTALLATION" ? (isAr ? "تركيب" : "Installation") : (isAr ? "صيانة" : "Maintenance")}</td>
        <td>${esc(a.status)}</td>
        <td>${esc(a.task?.technician?.name) || "—"}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html><html dir="${dir}" lang="${isAr ? "ar" : "en"}"><head><meta charset="UTF-8">
<style>
body{font-family:Tahoma,Arial,sans-serif;margin:24px;font-size:12px;direction:${dir};color:#333}
.hdr{border-bottom:3px solid #000080;margin-bottom:14px;padding-bottom:10px}
.brand{font-size:18px;font-weight:bold;color:#000080}
.cname{font-size:16px;font-weight:bold;margin:8px 0 4px}
.active-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:bold;background:#dcfce7;color:#166534}
.inactive-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:bold;background:#f1f5f9;color:#64748b}
.sec{margin-top:14px}.sec-t{font-weight:bold;color:#000080;border-bottom:1px solid #ddd;padding-bottom:4px;margin-bottom:8px;font-size:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.lbl{color:#888;font-size:9px;margin-bottom:2px}.val{font-size:11px;font-weight:500}
table{width:100%;border-collapse:collapse;font-size:10px;margin-top:4px}
th{background:#000080;color:#fff;padding:5px 8px;text-align:${dir === "rtl" ? "right" : "left"}}
td{padding:4px 8px;border-bottom:1px solid #eee}
tr:nth-child(even){background:#f9f9f9}
.ftr{margin-top:20px;border-top:1px solid #eee;padding-top:8px;color:#999;font-size:9px;text-align:center}
</style></head><body>
<div class="hdr"><div class="brand">Pure Home</div><div style="color:#666;font-size:10px">${formatGregorianDate(new Date(), { utc: false })}</div></div>
<div class="cname">${esc(c.name)}</div>
<span class="${c.isActive ? "active-badge" : "inactive-badge"}">${c.isActive ? (isAr ? "نشط" : "Active") : (isAr ? "غير نشط" : "Inactive")}</span>
<div class="sec"><div class="sec-t">${isAr ? "معلومات التواصل" : "Contact Info"}</div>
<div class="grid">
<div><div class="lbl">${isAr ? (c.secondaryPhone ? "الجوال الأساسي" : "الجوال") : (c.secondaryPhone ? "Primary Mobile" : "Phone")}</div><div class="val">${esc(c.phone)}</div></div>
${c.secondaryPhone ? `<div><div class="lbl">${isAr ? "الجوال الإضافي" : "Additional Mobile"}</div><div class="val">${esc(c.secondaryPhone)}</div></div>` : ""}
<div><div class="lbl">${isAr ? "المدينة" : "City"}</div><div class="val">${esc(addr?.city) || "—"}</div></div>
<div><div class="lbl">${isAr ? "الحي" : "District"}</div><div class="val">${esc(addr?.district) || "—"}</div></div>
<div><div class="lbl">${isAr ? "الشارع" : "Street"}</div><div class="val">${esc(addr?.street) || "—"}</div></div>
${addr?.buildingNo ? `<div><div class="lbl">${isAr ? "رقم المبنى" : "Building"}</div><div class="val">${esc(addr.buildingNo)}${addr.floorNo ? ` — ${isAr ? "طابق" : "Floor"} ${esc(addr.floorNo)}` : ""}</div></div>` : ""}
</div></div>
<div class="sec"><div class="sec-t">${isAr ? "معلومات الصيانة" : "Maintenance Info"}</div>
<div class="grid">
<div><div class="lbl">${isAr ? "تاريخ التسجيل" : "Registered"}</div><div class="val" dir="ltr">${formatGregorianDate(c.createdAt)}</div></div>
<div><div class="lbl">${isAr ? "دورة الصيانة" : "Cycle"}</div><div class="val">${formatCycle(c.maintenanceCycle, c.maintenanceFrequency, isAr)}</div></div>
</div></div>
${c.previousServiceType ? `<div class="sec"><div class="sec-t">${isAr ? "الخدمة السابقة" : "Previous Service"}</div>
<div class="grid">
<div><div class="lbl">${isAr ? "الخدمة السابقة" : "Previous Service"}</div><div class="val">${c.previousServiceType === "INSTALLATION" ? (isAr ? "تركيب سابق" : "Previous Installation") : (isAr ? "صيانة سابقة" : "Previous Maintenance")}</div></div>
<div><div class="lbl">${isAr ? "تاريخ الخدمة السابقة" : "Previous Service Date"}</div><div class="val" dir="ltr">${formatGregorianDate(c.previousServiceDate)}</div></div>
</div>${c.previousServiceNote ? `<p style="font-size:11px;margin:6px 0 0">${esc(c.previousServiceNote)}</p>` : ""}</div>` : ""}
${c.notes ? `<div class="sec"><div class="sec-t">${isAr ? "ملاحظات" : "Notes"}</div><p style="font-size:11px;margin:0">${esc(c.notes)}</p></div>` : ""}
${(c.appointments || []).length > 0 ? `
<div class="sec"><div class="sec-t">${isAr ? "سجل المواعيد" : "Appointment History"}</div>
<table><thead><tr>
<th>${isAr ? "التاريخ" : "Date"}</th><th>${isAr ? "النوع" : "Type"}</th><th>${isAr ? "الحالة" : "Status"}</th><th>${isAr ? "الفني" : "Technician"}</th>
</tr></thead><tbody>${apptRows}</tbody></table></div>` : ""}
<div class="ftr">Pure Home System — ${formatGregorianDateTime(new Date(), { utc: false })}</div>
</body></html>`;

    try {
      const filePath = await (window as any).electron.printToPDF(html, `customer-${c.id}-detail-${Date.now()}.pdf`);
      toast.success(`${t("reports.savedTo")}: ${filePath}`);
    } catch {
      toast.error(t("common.error"));
    }
  }

  /** One label/value pair in the customer summary grid. */
  const detail = (label: React.ReactNode, value: React.ReactNode) => (
    <div className="min-w-0">
      <dt className="text-2xs uppercase tracking-wide text-fg-muted">{label}</dt>
      <dd className="text-[0.8125rem] text-fg mt-0.5">{value}</dd>
    </div>
  );

  /** A bordered sub-panel for one optional group of customer facts. */
  const panel = (title: React.ReactNode, children: React.ReactNode) => (
    <div className="bg-surface-subtle border border-line-subtle rounded-md p-3">
      <p className="text-2xs uppercase tracking-wide text-fg-muted mb-2">{title}</p>
      <div className="space-y-1 text-[0.8125rem]">{children}</div>
    </div>
  );

  const line = (label: React.ReactNode, value: React.ReactNode) => (
    <p><span className="text-fg-muted">{label}: </span>{value}</p>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-fg-muted hover:text-fg text-2xs inline-flex items-center gap-1.5 transition-colors"
        >
          <Icon name="chevronStart" className="w-3.5 h-3.5 rtl:rotate-180" />
          {t("common.back")}
        </button>
        <Button variant="secondary" onClick={handleExportPdf}>
          <Icon name="download" className="w-3.5 h-3.5" />
          {t("reports.exportCustomerPdf")}
        </Button>
      </div>

      <div className="bg-surface border border-line rounded-md">
        <div className="flex items-start justify-between gap-4 p-4 border-b border-line">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fg truncate">{c.name}</h2>
            <p className="text-xs text-fg-secondary mt-1">
              {c.secondaryPhone ? `${t("customers.primaryPhone")}: ${c.phone}` : c.phone}
            </p>
            {c.secondaryPhone && (
              <p className="text-xs text-fg-secondary">{t("customers.secondaryPhone")}: {c.secondaryPhone}</p>
            )}
          </div>
          <Badge tone={c.isActive ? "success" : "neutral"} dot>
            {c.isActive ? t("common.active") : t("common.inactive")}
          </Badge>
        </div>

        <div className="p-4 space-y-4">
          <dl className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {detail(t("customers.maintenanceCycle"), formatCycle(c.maintenanceCycle, c.maintenanceFrequency, isAr))}
            {detail(t("customers.frequency"), <span className="tabular-nums">{c.maintenanceFrequency}</span>)}
            {detail(t("reports.registrationDate"), <span dir="ltr" className="tabular-nums">{formatGregorianDate(c.createdAt)}</span>)}
            {detail(
              t("reports.lastMaintenance"),
              <span dir="ltr" className="tabular-nums">
                {lastMaintenance ? formatGregorianDate(lastMaintenance.actualCompletionDate || lastMaintenance.scheduledDate) : "—"}
              </span>
            )}
            {detail(
              t("reports.nextMaintenance"),
              <span dir="ltr" className="tabular-nums">{c.nextMaintenance ? formatGregorianDate(c.nextMaintenance) : "—"}</span>
            )}
          </dl>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {addr && panel(t("customers.address"), (
              <>
                <p>{addr.city}، {addr.district}، {addr.street}</p>
                {addr.buildingNo && (
                  <p>
                    {t("customers.buildingNo")}: {addr.buildingNo}
                    {addr.floorNo && ` | ${t("customers.floorNo")}: ${addr.floorNo}`}
                  </p>
                )}
                {addr.apartmentNo && <p>{t("customers.apartmentNo")}: {addr.apartmentNo}</p>}
                {addr.postalCode && <p>{t("customers.postalCode")}: {addr.postalCode}</p>}
              </>
            ))}

            {(c.installationDate || c.installationNote || c.installationAmount != null || c.installationPaymentMethod) &&
              panel(t("customers.installationSection"), (
                <>
                  {c.installationDate && line(
                    t("reports.installationDate"),
                    <span dir="ltr" className="tabular-nums">{formatGregorianDate(c.installationDate)}</span>
                  )}
                  {c.installationAmount != null && line(
                    t("customers.installationCost"),
                    <span className="tabular-nums">{c.installationAmount}</span>
                  )}
                  {c.installationPaymentMethod && line(
                    t("customers.installationPaymentMethod"),
                    formatInstallationPaymentMethod(c.installationPaymentMethod, t)
                  )}
                  {c.installationNote && line(t("customers.installationNote"), c.installationNote)}
                </>
              ))}

            {c.previousServiceType && panel(t("customers.previousService"), (
              <>
                {line(
                  t("customers.previousService"),
                  c.previousServiceType === "INSTALLATION" ? t("customers.previousInstallation") : t("customers.previousMaintenance")
                )}
                {line(
                  t("customers.previousServiceDate"),
                  <span dir="ltr" className="tabular-nums">{formatGregorianDate(c.previousServiceDate)}</span>
                )}
                {c.previousServiceNote && line(t("customers.previousServiceNote"), c.previousServiceNote)}
              </>
            ))}

            {/* Requirement #8: branch detail records, shown under the ONE
                customer they belong to. The count is stated up front because
                "how many branches?" is the question the requirement asks. */}
            {Array.isArray(c.branches) && c.branches.length > 0 && panel(
              `${t("customers.branches")} (${c.branches.length})`,
              <div className="space-y-2.5">
                {c.branches.map((b: any, i: number) => (
                  <div key={b.id || i} className="border border-line-subtle rounded bg-surface-subtle px-3 py-2">
                    <p className="text-[0.8125rem] font-medium text-fg">{b.branchName}</p>
                    {b.supervisorName && (
                      <p className="text-2xs text-fg-secondary mt-0.5">
                        {t("customers.branchSupervisor")}: {b.supervisorName}
                      </p>
                    )}
                    {b.supervisorMobile && (
                      <p className="text-2xs text-fg-secondary mt-0.5">
                        {t("customers.branchSupervisorMobile")}: <span dir="ltr" className="tabular-nums">{b.supervisorMobile}</span>
                      </p>
                    )}
                    {b.notes && <p className="text-2xs text-fg-muted mt-1 whitespace-pre-wrap">{b.notes}</p>}
                  </div>
                ))}
              </div>
            )}

            {c.notes && panel(t("common.notes"), <p className="whitespace-pre-wrap">{c.notes}</p>)}
          </div>
        </div>
      </div>

      <div className="bg-surface border border-line rounded-md overflow-hidden">
        <h3 className="text-sm font-semibold text-fg px-4 py-3 border-b border-line">{t("nav.appointments")}</h3>
        {!c.appointments?.length ? (
          <EmptyState icon={<Icon name="appointments" className="w-5 h-5" />} title={t("common.noRecords")} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH width="7rem">{t("common.date")}</TH>
                <TH>{t("appointments.type")}</TH>
                <TH width="10rem">{t("common.status")}</TH>
              </tr>
            </THead>
            <TBody>
              {c.appointments.map((a: any) => (
                <TR key={a.id}>
                  <TD className="tabular-nums whitespace-nowrap"><span dir="ltr">{formatGregorianDate(a.scheduledDate)}</span></TD>
                  <TD>{a.type}</TD>
                  <TD className="text-fg-secondary">{a.status}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  );
}
