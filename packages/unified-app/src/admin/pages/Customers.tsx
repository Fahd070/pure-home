import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import toast from "react-hot-toast";
import { escapeHtml as esc } from "../../utils/htmlEscape";
import { formatGregorianDate, formatGregorianDateTime } from "../../utils/dateTimeInput";
import { HistoryModal } from "../../scheduling/pages/CustomerList";
import { Button } from "../../ui/Button";
import { Input, Field } from "../../ui/Field";
import { Badge } from "../../ui/Badge";
import { Toolbar } from "../../ui/Surface";
import { EmptyState, Loading, Callout } from "../../ui/Feedback";
import { TableShell, Table, THead, TH, TBody, TR, TD } from "../../ui/Table";
import { Pagination } from "../../ui/Pagination";
import { MaintenanceBadge, maintenanceRowClass } from "../../components/MaintenancePriority";
import { fetchAllPages } from "../../utils/fetchAllPages";
import { Modal, ConfirmDialog } from "../../ui/Modal";
import { Icon } from "../../ui/icons";

const CUSTOMERS_PER_PAGE = 20;

function formatCycle(cycle: string, freq: number, t: any) {
  const n = Number(freq) || 1;
  if (cycle === "DAILY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.day") : t("customers.days")}`;
  if (cycle === "WEEKLY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.week") : t("customers.weeks")}`;
  if (cycle === "MONTHLY") return `${t("customers.every")} ${n} ${n === 1 ? t("customers.month") : t("customers.months")}`;
  return cycle;
}

async function exportCustomerPdf(c: any, isAr: boolean, t: any) {
  const dir = isAr ? "rtl" : "ltr";
  const fmtCycle = (cycle: string, freq: number) => {
    const n = Number(freq) || 1;
    if (cycle === "DAILY") return (isAr ? `كل ${n} يوم` : `Every ${n} day${n > 1 ? "s" : ""}`);
    if (cycle === "WEEKLY") return (isAr ? `كل ${n} أسبوع` : `Every ${n} week${n > 1 ? "s" : ""}`);
    if (cycle === "MONTHLY") return (isAr ? `كل ${n} شهر` : `Every ${n} month${n > 1 ? "s" : ""}`);
    return cycle;
  };
  const html = `<!DOCTYPE html><html dir="${dir}" lang="${isAr ? "ar" : "en"}"><head><meta charset="UTF-8">
<style>
body{font-family:Tahoma,Arial,sans-serif;margin:24px;font-size:12px;direction:${dir};color:#333}
.hdr{border-bottom:3px solid #000080;margin-bottom:14px;padding-bottom:10px}
.brand{font-size:18px;font-weight:bold;color:#000080}
.cname{font-size:16px;font-weight:bold;margin:8px 0 4px}
.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:bold}
.badge-ok{background:#dcfce7;color:#166534}.badge-soon{background:#fef3c7;color:#92400e}.badge-overdue{background:#fee2e2;color:#991b1b}
.sec{margin-top:14px}.sec-t{font-weight:bold;color:#000080;border-bottom:1px solid #ddd;padding-bottom:4px;margin-bottom:8px;font-size:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.lbl{color:#888;font-size:9px;margin-bottom:2px}.val{font-size:11px;font-weight:500}
.ftr{margin-top:20px;border-top:1px solid #eee;padding-top:8px;color:#999;font-size:9px;text-align:center}
</style></head><body>
<div class="hdr"><div class="brand">Pure Home</div><div style="color:#666;font-size:10px">${formatGregorianDate(new Date(), { utc: false })}</div></div>
<div class="cname">${esc(c.name)}</div>
<span class="badge badge-${c.alertLevel || "ok"}">${c.alertLevel === "overdue" ? (isAr ? "متأخر" : "Overdue") : c.alertLevel === "soon" ? (isAr ? "قادم قريباً" : "Upcoming Soon") : (isAr ? "طبيعي" : "OK")}</span>
<div class="sec"><div class="sec-t">${isAr ? "معلومات التواصل" : "Contact Info"}</div>
<div class="grid">
<div><div class="lbl">${isAr ? "الجوال" : "Phone"}</div><div class="val">${esc(c.phone)}</div></div>
<div><div class="lbl">${isAr ? "المدينة" : "City"}</div><div class="val">${esc(c.address?.city) || "—"}</div></div>
<div><div class="lbl">${isAr ? "الحي" : "District"}</div><div class="val">${esc(c.address?.district) || "—"}</div></div>
<div><div class="lbl">${isAr ? "الشارع" : "Street"}</div><div class="val">${esc(c.address?.street) || "—"}</div></div>
</div></div>
<div class="sec"><div class="sec-t">${isAr ? "معلومات الصيانة" : "Maintenance Info"}</div>
<div class="grid">
<div><div class="lbl">${isAr ? "تاريخ التسجيل" : "Registered"}</div><div class="val" dir="ltr">${formatGregorianDate(c.createdAt)}</div></div>
<div><div class="lbl">${isAr ? "دورة الصيانة" : "Cycle"}</div><div class="val">${fmtCycle(c.maintenanceCycle, c.maintenanceFrequency)}</div></div>
<div><div class="lbl">${isAr ? "آخر صيانة" : "Last Maintenance"}</div><div class="val" dir="ltr">${c.lastMaintenance ? formatGregorianDate(c.lastMaintenance) : "—"}</div></div>
<div><div class="lbl">${isAr ? "الصيانة القادمة" : "Next Maintenance"}</div><div class="val" dir="ltr">${c.nextMaintenance ? formatGregorianDate(c.nextMaintenance) : "—"}</div></div>
</div></div>
${c.notes ? `<div class="sec"><div class="sec-t">${isAr ? "ملاحظات" : "Notes"}</div><p style="font-size:11px;margin:0">${esc(c.notes)}</p></div>` : ""}
<div class="ftr">Pure Home System — ${formatGregorianDateTime(new Date(), { utc: false })}</div>
</body></html>`;
  const filePath = await (window as any).electron.printToPDF(html, `customer-${c.id}-${Date.now()}.pdf`);
  return filePath;
}

export default function Customers() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  // Exported rows carry the same four states the rows on screen do, in words --
  // a spreadsheet has no colour to read.
  const priorityLabel = (p?: string) => ({
    OVERDUE: t("reports.priorityOverdue"),
    DUE_SOON: t("reports.priorityDueSoon"),
    NORMAL: t("reports.priorityNormal"),
    UNKNOWN: t("reports.priorityUnknown"),
  } as Record<string, string>)[p || "UNKNOWN"] || t("reports.priorityUnknown");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const socket = useSocket();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState("");
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [historyModal, setHistoryModal] = useState<any>(null);

  useEffect(() => {
    window.dispatchEvent(new Event("clear-badge-customers-admin"));
  }, []);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    };
    // A completion recalculates the customer's next-maintenance date, which is
    // what this list is now sorted and coloured by -- so it has to refresh on
    // appointment events too, not only on customer ones.
    socket.on("appointment:completed", refresh);
    socket.on("customer:created", refresh);
    socket.on("customer:updated", refresh);
    socket.on("customers:bulk-deleted", refresh);
    socket.on("customer:deleted", refresh);
    return () => {
      socket.off("appointment:completed", refresh);
      socket.off("customer:created", refresh);
      socket.off("customer:updated", refresh);
      socket.off("customers:bulk-deleted", refresh);
      socket.off("customer:deleted", refresh);
    };
  }, [socket, qc]);

  const { data, isLoading } = useQuery({
    queryKey: ["customers", search, page],
    // sort=maintenance is applied by the SERVER, before the page slice, so the
    // most overdue customer is on page 1 even when they were registered last.
    // Sorting the 20 rows already fetched would only reorder an arbitrary slice.
    queryFn: () => api.get("/customers", {
      params: { search, page, limit: CUSTOMERS_PER_PAGE, includeSchedule: true, sort: "maintenance" },
    }).then(r => r.data),
    // Keeps the previous page on screen while the next one loads instead of
    // flashing the empty state, so paging does not make the table disappear.
    placeholderData: prev => prev,
  });

  const toggle = useMutation({
    mutationFn: (id: string) => api.patch(`/customers/${id}/toggle-active`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customers"] }); toast.success(t("common.success")); }
  });

  const deleteCustomer = useMutation({
    mutationFn: (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      qc.invalidateQueries({ queryKey: ["dashboard-activity"] });
      toast.success(t("customers.deleted"));
      setDeleteTarget(null);
    },
    onError: () => toast.error(t("common.error"))
  });

  async function exportAllToExcel() {
    setExportingXlsx(true);
    try {
      // Previously requested limit=2000, which the server clamps to its documented
      // maximum of 100 -- so an "export all customers" button silently produced a
      // file containing the first 100. fetchAllPages walks the endpoint's own
      // meta.totalPages at the documented page size instead, so the export is the
      // whole authorized result set however large it grows. The current search is
      // passed through: exporting a filtered list must export that list.
      const all: any[] = await fetchAllPages(api, "/customers", {
        search: search || undefined, includeSchedule: true, sort: "maintenance",
      });
      const { downloadExcelWorkbook } = await import("../../utils/excelExport");
      const rows = all.map((c: any) => ({
        [isAr ? "الاسم" : "Name"]: c.name,
        [isAr ? "الجوال" : "Phone"]: c.phone,
        [isAr ? "المدينة" : "City"]: c.address?.city || "",
        [isAr ? "الحي" : "District"]: c.address?.district || "",
        [isAr ? "الشارع" : "Street"]: c.address?.street || "",
        [isAr ? "تاريخ التسجيل" : "Reg. Date"]: formatGregorianDate(c.createdAt),
        [isAr ? "تاريخ التركيب" : "Install Date"]: c.installationDate ? formatGregorianDate(c.installationDate) : "",
        [isAr ? "دورة الصيانة" : "Cycle"]: formatCycle(c.maintenanceCycle, c.maintenanceFrequency, t),
        [isAr ? "آخر صيانة" : "Last Maint."]: c.lastMaintenance ? formatGregorianDate(c.lastMaintenance) : "",
        [isAr ? "الصيانة القادمة" : "Next Maint."]: c.nextMaintenanceDueAt ? formatGregorianDate(c.nextMaintenanceDueAt) : "",
        [isAr ? "أولوية الصيانة" : "Maintenance Priority"]: priorityLabel(c.maintenancePriority),
        [isAr ? "الحالة" : "Status"]: c.isActive ? (isAr ? "نشط" : "Active") : (isAr ? "غير نشط" : "Inactive"),
        [isAr ? "ملاحظات" : "Notes"]: c.notes || "",
      }));
      await downloadExcelWorkbook([
        { name: isAr ? "العملاء" : "Customers", rows },
      ], `customers-${new Date().toISOString().slice(0,10)}.xlsx`);
      toast.success(t("reports.savedTo"));
    } catch {
      toast.error(t("common.error"));
    } finally { setExportingXlsx(false); }
  }

  const deleteAllCustomers = useMutation({
    mutationFn: () => api.delete("/customers", {
      data: { confirm: true, confirmPhrase: deleteAllConfirmText, expectedCount: data?.meta?.total ?? 0 },
    }),
    onSuccess: (res) => {
      const count = res.data.data.deletedCount;
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      qc.invalidateQueries({ queryKey: ["dashboard-activity"] });
      toast.success(`${count} ${t("customers.allDeleted")}`);
      setShowDeleteAll(false);
      setDeleteAllConfirmText("");
    },
    onError: (err: any) => {
      if (err?.response?.status === 409) {
        // The list changed since this dialog opened (e.g. another session added a
        // customer) -- refresh so the displayed count is accurate before retrying.
        qc.invalidateQueries({ queryKey: ["customers"] });
        toast.error(t("customers.countChanged"));
      } else {
        toast.error(t("common.error"));
      }
    }
  });

  const customers: any[] = data?.data || [];
  const total: number = data?.meta?.total ?? 0;
  // From the server's own meta rather than re-derived from total/pageSize: the
  // page size is the server's decision (it clamps), so deriving it here means
  // computing the same number twice from different assumptions.
  const totalPages: number = data?.meta?.totalPages ?? 1;

  // If deleting the last row on the last page leaves this page beyond the end,
  // step back to the nearest page that still exists rather than showing an
  // empty table with no way to tell why.
  useEffect(() => {
    if (!data?.meta) return;
    if (page > totalPages) setPage(totalPages);
  }, [data?.meta, page, totalPages]);

  return (
    <div className="space-y-4">
      <Toolbar>
        <div className="relative flex-1 min-w-[16rem]">
          <Icon name="search" className="w-3.5 h-3.5 text-fg-muted absolute top-1/2 -translate-y-1/2 start-2.5 pointer-events-none" />
          <Input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder={t("common.search")}
            aria-label={t("common.search")}
            className="ps-8"
          />
        </div>

        <Button variant="primary" onClick={() => navigate("/admin/customers/add")}>
          <Icon name="add" className="w-3.5 h-3.5" />
          {t("customers.add")}
        </Button>

        {total > 0 && (
          <>
            <Button variant="secondary" loading={exportingXlsx} onClick={exportAllToExcel}>
              <Icon name="download" className="w-3.5 h-3.5" />
              {exportingXlsx ? t("reports.generating") : t("reports.exportCustomers")}
            </Button>
            <Button
              variant="secondary"
              className="text-danger-fg"
              onClick={() => { setShowDeleteAll(true); setDeleteAllConfirmText(""); }}
            >
              <Icon name="trash" className="w-3.5 h-3.5" />
              {t("customers.deleteAll")}
            </Button>
          </>
        )}
      </Toolbar>

      {/* v4 Requirement #9: the stepper sits ABOVE the list. The customer list is
          the one place in the app where reaching page 7 is the task, not a
          footnote, and a control below a 20-row table is off-screen when you
          need it. */}
      {total > 0 && (
        <Pagination
          labelled
          page={page}
          totalPages={totalPages}
          total={total}
          totalLabel={t("pagination.totalCustomers")}
          onPage={setPage}
        />
      )}

      {isLoading ? (
        <Loading label={t("common.loading")} />
      ) : !customers.length ? (
        <div className="bg-surface border border-line rounded-md">
          <EmptyState icon={<Icon name="customers" className="w-5 h-5" />} title={t("common.noRecords")} />
        </div>
      ) : (
        <TableShell>
          <Table className="min-w-[1040px]">
            <THead>
              <tr>
                <TH>{t("common.name")}</TH>
                <TH width="9rem">{t("common.phone")}</TH>
                <TH width="9rem">{t("customers.maintenanceCycle")}</TH>
                <TH width="7rem">{t("reports.installationDate")}</TH>
                <TH width="7rem">{t("reports.lastMaintenance")}</TH>
                <TH width="12rem">{t("reports.nextMaintenance")}</TH>
                <TH width="7rem">{t("common.status")}</TH>
                <TH width="10rem">{t("common.actions")}</TH>
              </tr>
            </THead>
            <TBody>
              {customers.map((c: any) => (
                <TR
                  key={c.id}
                  emphasis={maintenanceRowClass(c.maintenancePriority)}
                  onClick={() => navigate(`/admin/customers/${c.id}`)}
                >
                  <TD className="font-medium">{c.name}</TD>
                  <TD className="text-fg-secondary"><span dir="ltr">{c.phone}</span></TD>
                  <TD className="text-fg-secondary text-2xs">{formatCycle(c.maintenanceCycle, c.maintenanceFrequency, t)}</TD>
                  <TD className="text-fg-secondary text-2xs tabular-nums whitespace-nowrap">
                    <span dir="ltr">{c.installationDate ? formatGregorianDate(c.installationDate) : "—"}</span>
                  </TD>
                  <TD className="text-fg-secondary text-2xs tabular-nums whitespace-nowrap">
                    <span dir="ltr">{c.lastMaintenance ? formatGregorianDate(c.lastMaintenance) : "—"}</span>
                  </TD>
                  <TD>
                    <div className="flex flex-col items-start gap-1">
                      <MaintenanceBadge due={c} />
                      {c.nextMaintenanceDueAt && (
                        <span className="text-2xs text-fg-muted tabular-nums" dir="ltr">{formatGregorianDate(c.nextMaintenanceDueAt)}</span>
                      )}
                    </div>
                  </TD>
                  <TD>
                    <Badge tone={c.isActive ? "success" : "neutral"} dot>
                      {c.isActive ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </TD>
                  <TD>
                    {/* Five row actions do not fit as five labelled buttons at
                        1280 wide, so they are icons with titles/aria-labels;
                        delete keeps its destructive hover tone. */}
                    <div className="flex items-center gap-0.5">
                      <Button
                        size="sm" variant="ghost" iconOnly
                        onClick={event => { event.stopPropagation(); toggle.mutate(c.id); }}
                        title={t("customers.toggleActive")}
                        aria-label={t("customers.toggleActive")}
                      >
                        <Icon name={c.isActive ? "check" : "close"} className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" iconOnly
                        onClick={event => { event.stopPropagation(); navigate(`/admin/customers/${c.id}/edit`); }}
                        title={t("customers.edit")}
                        aria-label={t("customers.edit")}
                      >
                        <Icon name="edit" className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" iconOnly
                        onClick={event => { event.stopPropagation(); setHistoryModal(c); }}
                        title={t("scheduling.viewHistory")}
                        aria-label={t("scheduling.viewHistory")}
                      >
                        <Icon name="messages" className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" iconOnly
                        onClick={event => {
                          event.stopPropagation();
                          exportCustomerPdf(c, isAr, t)
                            .then(fp => toast.success(`${t("reports.savedTo")}: ${fp}`))
                            .catch(() => toast.error(t("common.error")));
                        }}
                        title={t("reports.exportCustomerPdf")}
                        aria-label={t("reports.exportCustomerPdf")}
                      >
                        <Icon name="download" className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" iconOnly
                        onClick={event => { event.stopPropagation(); setDeleteTarget({ id: c.id, name: c.name }); }}
                        title={t("common.delete")}
                        aria-label={t("common.delete")}
                        className="hover:text-danger-fg hover:bg-danger-bg"
                      >
                        <Icon name="trash" className="w-4 h-4" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableShell>
      )}

      {historyModal && <HistoryModal customer={historyModal} onClose={() => setHistoryModal(null)} apiClient={api} />}

      <ConfirmDialog
        open={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteCustomer.mutate(deleteTarget.id)}
        title={t("customers.deleteCustomer")}
        message={
          <>
            <span className="block">{t("customers.deleteConfirm")}</span>
            <span className="block font-semibold text-fg mt-1">{deleteTarget?.name}</span>
            <span className="block text-2xs text-fg-muted mt-2">{t("customers.deleteWarning")}</span>
          </>
        }
        confirmLabel={t("customers.yesDelete")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={deleteCustomer.isPending}
      />

      {/* Delete-everything keeps its own dialog rather than ConfirmDialog: it
          carries a typed-phrase guard, which is the whole point of it. */}
      <Modal
        open={showDeleteAll}
        onClose={() => { setShowDeleteAll(false); setDeleteAllConfirmText(""); }}
        closeOnBackdrop={false}
        size="sm"
        title={t("customers.deleteAllTitle")}
        description={`${total} ${t("customers.willBeDeleted")}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowDeleteAll(false); setDeleteAllConfirmText(""); }}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={deleteAllConfirmText !== "DELETE"}
              loading={deleteAllCustomers.isPending}
              onClick={() => deleteAllCustomers.mutate()}
            >
              {t("customers.deleteAllConfirmBtn")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Callout tone="danger">{t("customers.deleteAllWarning")}</Callout>
          <Field label={t("customers.typeDeleteToConfirm")} htmlFor="delete-all-confirm">
            <Input
              id="delete-all-confirm"
              value={deleteAllConfirmText}
              onChange={e => setDeleteAllConfirmText(e.target.value)}
              placeholder="DELETE"
              dir="ltr"
              className="font-mono"
              invalid={!!deleteAllConfirmText && deleteAllConfirmText !== "DELETE"}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
