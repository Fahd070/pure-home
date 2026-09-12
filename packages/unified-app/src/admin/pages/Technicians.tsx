import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { formatGregorianDate } from "../../utils/dateTimeInput";
import { firstNameOf } from "../../technician/pages/TaskDetail";
import { Button } from "../../ui/Button";
import { Badge } from "../../ui/Badge";
import { PageHeader } from "../../ui/Surface";
import { EmptyState, Loading } from "../../ui/Feedback";
import { Modal } from "../../ui/Modal";
import { Pagination } from "../../ui/Pagination";
import { Icon } from "../../ui/icons";
import { cx } from "../../ui/cx";

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-2xs">
      <span className="text-fg-muted min-w-[110px] flex-shrink-0">{label}:</span>
      <span className="text-fg-secondary break-all">{value}</span>
    </div>
  );
}

/**
 * Full-screen image lightbox. Deliberately dark in every theme: a photograph is
 * judged against a neutral dark surround, and this is the one surface in the
 * app that is about the image rather than about the interface.
 */
function ImageViewer({ src, onClose, isAr }: { src: string; onClose: () => void; isAr: boolean }) {
  const [zoom, setZoom] = useState(1);
  const ctrl = "bg-white/15 hover:bg-white/25 text-white rounded-md flex items-center justify-center transition-colors";
  return (
    <div className="fixed inset-0 bg-black/90 z-toast flex flex-col items-center justify-center p-3" onClick={onClose}>
      <div className="flex gap-2 mb-3" onClick={e => e.stopPropagation()}>
        <button onClick={() => setZoom(z => Math.min(z + 0.5, 5))} aria-label="Zoom in" className={cx(ctrl, "w-9 h-9")}>
          <Icon name="add" className="w-4 h-4" />
        </button>
        <span className="bg-white/10 text-white/80 rounded-md px-3 flex items-center text-2xs tabular-nums min-w-[52px] justify-center">
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={() => setZoom(z => Math.max(z - 0.5, 0.5))} aria-label="Zoom out" className={cx(ctrl, "w-9 h-9")}>
          <span className="text-lg leading-none">−</span>
        </button>
        <button onClick={() => setZoom(1)} className={cx(ctrl, "px-3 h-9 text-2xs")}>
          {isAr ? "ملاءمة" : "Fit"}
        </button>
        <button onClick={onClose} aria-label={isAr ? "إغلاق" : "Close"} className="bg-danger-solid hover:brightness-110 text-white rounded-md w-9 h-9 flex items-center justify-center transition-[filter]">
          <Icon name="close" className="w-4 h-4" />
        </button>
      </div>

      <div
        className="overflow-auto rounded-md border border-white/10"
        style={{ maxHeight: "80vh", maxWidth: "90vw" }}
        onClick={e => e.stopPropagation()}
      >
        <img
          src={src}
          alt=""
          style={{
            display: "block",
            maxWidth: zoom === 1 ? "90vw" : "none",
            maxHeight: zoom === 1 ? "76vh" : "none",
            width: zoom > 1 ? `${zoom * 90}vw` : "auto",
            height: "auto",
          }}
        />
      </div>

      <p className="text-white/40 text-2xs mt-2" onClick={e => e.stopPropagation()}>
        {isAr ? "انقر خارج الصورة للإغلاق" : "Click outside to close"}
      </p>
    </div>
  );
}

function formatCompletionDate(dateStr: string, isAr: boolean): string {
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  let h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? (isAr ? 'م' : 'PM') : (isAr ? 'ص' : 'AM');
  h = h % 12 || 12;
  return `${dd}/${mm}/${yyyy} - ${String(h).padStart(2, '0')}:${min} ${ampm}`;
}

/** Label/value row inside the completed-task detail sections. */
function Fact({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-fg-muted min-w-[120px] flex-shrink-0 text-2xs">{label}:</span>
      <span className="text-fg-secondary text-2xs break-words min-w-0">{children}</span>
    </div>
  );
}

function FactGroup({ title, children, className }: { title: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section>
      <p className="text-2xs font-semibold uppercase tracking-wide text-fg-muted mb-2">{title}</p>
      <div className={cx("rounded-md p-3 space-y-2 border", className || "bg-surface-subtle border-line-subtle")}>
        {children}
      </div>
    </section>
  );
}

const apptTypeLabels = (isAr: boolean): Record<string, string> => ({
  MAINTENANCE: isAr ? "صيانة" : "Maintenance",
  INSTALLATION: isAr ? "تركيب" : "Installation",
});

export type ActivityKind = "completed" | "postponed" | "no-answer";

/**
 * v4 Requirement #11: the durable activity behind one counter.
 *
 * Fetched when opened rather than shipped with the technician list: a completion
 * carries a base64 photograph, and loading twenty of them per technician on page
 * load to show three numbers is a page that gets slower with every job the
 * business does.
 *
 * Each kind reads its own source of truth, which is the point:
 *   completed  -> appointments attributed to this technician
 *   postponed  -> PostponementRecord, so a postponement that was later
 *                 rescheduled (and whose appointment is therefore back in
 *                 WAITING) is still part of the history
 *   no-answer  -> CustomerNoAnswerRecord, one row per contact attempt
 */
function ActivityModal({
  tech, kind, onClose, onOpenTask,
}: { tech: any; kind: ActivityKind; onClose: () => void; onOpenTask: (task: any) => void }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["technician-activity", tech.id, kind, page],
    queryFn: () => api.get(`/technicians/${tech.id}/activity`, { params: { kind, page, limit: 20 } }).then(r => r.data),
    placeholderData: prev => prev,
  });

  const items: any[] = data?.data || [];
  const total: number = data?.meta?.total ?? 0;
  const totalPages: number = data?.meta?.totalPages ?? 1;

  const title = kind === "completed"
    ? t("technicians.completedDetails")
    : kind === "postponed"
      ? t("technicians.postponedDetails")
      : t("technicians.noAnswerDetails");

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      className="max-h-[82vh]"
      title={title}
      // The technician's own name, on the list of their own work -- so an
      // administrator reading two of these side by side can never mix them up.
      description={`${tech.name} — ${total}`}
      footer={
        totalPages > 1
          ? <Pagination className="w-full" page={page} totalPages={totalPages} total={total} onPage={setPage} />
          : undefined
      }
    >
      {isLoading && !items.length ? (
        <Loading label={t("common.loading")} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Icon name="queue" className="w-5 h-5" />} title={t("common.noRecords")} />
      ) : (
        <ul className="space-y-2">
          {items.map((row: any) => {
            // A completion IS the appointment; a postponement and a no-answer are
            // records that point at one.
            const appt = kind === "completed" ? row : row.appointment;
            const customer = appt?.customer;
            const clickable = kind === "completed";
            const open = () => onOpenTask(row);
            return (
              <li key={row.id}>
                <div
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? open : undefined}
                  onKeyDown={clickable ? e => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
                  } : undefined}
                  className={cx(
                    "border rounded-md p-3 transition-colors",
                    kind === "no-answer" ? "border-danger-border bg-danger-bg" : "border-line",
                    clickable && "cursor-pointer hover:bg-surface-hover hover:border-line-strong"
                  )}
                >
                  <div className="flex justify-between items-start gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="text-[0.8125rem] font-medium text-fg truncate">
                        {customer?.name || (isAr ? "زيارة عاجلة" : "Urgent Visit")}
                      </p>
                      <p className="text-2xs text-fg-muted" dir="ltr">{customer?.phone || "—"}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-2xs text-fg-muted tabular-nums" dir="ltr">
                        {appt?.scheduledDate ? formatGregorianDate(appt.scheduledDate) : "—"}
                      </span>
                      {clickable && <Icon name="chevronEnd" className="w-3.5 h-3.5 text-fg-muted rtl:rotate-180" />}
                    </div>
                  </div>

                  {kind === "completed" && (
                    <div className="space-y-1">
                      <DetailRow label={isAr ? "نوع الخدمة" : "Service type"} value={apptTypeLabels(isAr)[row.type] || row.type} />
                      {row.actualCompletionDate && (
                        <DetailRow
                          label={isAr ? "تاريخ الإكمال" : "Completion date"}
                          value={formatGregorianDate(row.actualCompletionDate)} />
                      )}
                      {/* Honest about attribution: a record from before individual
                          technician identities existed carries only the name that
                          was typed at the time. It is shown as exactly that rather
                          than being presented as this technician's own work. */}
                      {row.completionTechnicianName && (
                        <p className="text-2xs text-fg-muted italic pt-0.5">
                          {t("technicians.legacyAttribution", { name: row.completionTechnicianName })}
                        </p>
                      )}
                    </div>
                  )}

                  {kind === "postponed" && (
                    <div className="space-y-1.5">
                      <DetailRow label={t("technicians.reason")} value={row.reason} />
                      {/* previousDate is null on records written before the field
                          existed; those render nothing rather than inventing a
                          date the system never captured. */}
                      {row.previousDate && (
                        <DetailRow label={t("technicians.previousDate")} value={formatGregorianDate(row.previousDate)} />
                      )}
                      {row.newDate && (
                        <DetailRow label={t("technicians.newDate")} value={formatGregorianDate(row.newDate)} />
                      )}
                      <DetailRow label={t("technicians.recordedAt")} value={formatCompletionDate(row.createdAt, isAr)} />
                    </div>
                  )}

                  {kind === "no-answer" && (
                    <div className="space-y-1.5">
                      <DetailRow label={t("technicians.recordedAt")} value={formatCompletionDate(row.createdAt, isAr)} />
                      <DetailRow label={t("technicians.note")} value={row.note} />
                      <DetailRow label={isAr ? "الفني" : "Technician"} value={tech.name} />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}


/**
 * One counter on a technician summary card.
 *
 * The number is the point of this page, so it is the largest thing on the card;
 * the label sits under it. Disabled rather than hidden at zero, so the three
 * metrics always occupy the same three positions and a card can be compared with
 * the one beside it at a glance.
 */
function MetricButton({
  value, label, tone, onClick,
}: { value: number; label: string; tone: "success" | "warning" | "danger"; onClick: () => void }) {
  const toneClass = { success: "text-success-fg", warning: "text-warning-fg", danger: "text-danger-fg" }[tone];
  return (
    <button
      type="button"
      onClick={value > 0 ? onClick : undefined}
      disabled={value === 0}
      className={cx(
        "p-3.5 text-center transition-colors",
        value > 0 ? "hover:bg-surface-hover cursor-pointer" : "cursor-default"
      )}
    >
      <p className={cx("text-2xl font-semibold tabular-nums leading-none", value > 0 ? toneClass : "text-fg-muted")}>{value}</p>
      <p className="text-2xs text-fg-muted mt-2 leading-tight">{label}</p>
    </button>
  );
}

export default function Technicians() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const [modal, setModal] = useState<{ tech: any; kind: ActivityKind } | null>(null);
  const [imageViewer, setImageViewer] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<{ task: any; techName: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["technicians-detail"],
    queryFn: () => api.get("/technicians").then(r => r.data.data),
  });

  // The activity list deliberately does not carry completionImage -- a base64
  // photograph per row would make every page of the modal heavy for the sake of
  // the one row somebody eventually opens. The photo (and the rest of the
  // completion record) is fetched here, for exactly the appointment being
  // viewed, through the existing Admin appointment-detail endpoint.
  const { data: fullTask } = useQuery({
    queryKey: ["technician-task-detail", taskDetail?.task?.id],
    queryFn: () => api.get(`/appointments/${taskDetail!.task.id}`).then(r => r.data.data),
    enabled: !!taskDetail?.task?.id,
  });

  if (isLoading) return <Loading label={t("common.loading")} />;

  const PAYMENT_LABELS: Record<string, string> = {
    CASH: isAr ? "نقداً" : "Cash",
    BANK_TRANSFER_COMMERCIAL: isAr ? "تحويل بنكي (تجاري)" : "Bank Transfer (Commercial)",
    BANK_TRANSFER_PERSONAL: isAr ? "تحويل بنكي (خاص)" : "Bank Transfer (Personal)",
  };

  const APPT_TYPE_LABELS = apptTypeLabels(isAr);

  const technicians: any[] = data || [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("technicians.title")}
        subtitle={<span className="tabular-nums">{technicians.length}</span>}
      />

      {!technicians.length ? (
        <div className="bg-surface border border-line rounded-md">
          <EmptyState icon={<Icon name="technicians" className="w-5 h-5" />} title={t("common.noRecords")} />
        </div>
      ) : (
        // Centered, bounded-width container so a small number of technicians
        // reads as an intentional, balanced panel rather than floating in the
        // corner of the page's full layout width.
        <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {technicians.map((tech: any) => (
            <div key={tech.id} className="bg-surface border border-line rounded-md overflow-hidden">
              {/* The exact individual technician, named. Since v4 gave every
                  technician their own identity, "who did this" is a real
                  question with a real answer, and this page is where it is
                  answered. */}
              <div className="flex items-center gap-3 p-3.5 border-b border-line-subtle">
                <span
                  className="w-10 h-10 rounded-md bg-surface-active text-fg-secondary flex items-center justify-center font-semibold text-base flex-shrink-0"
                  aria-hidden="true"
                >
                  {tech.name?.[0] || "?"}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg truncate">{tech.name}</p>
                  <p className="text-2xs text-fg-muted truncate" dir="ltr">{tech.email}</p>
                </div>
              </div>

              {/* Three counters: what landed, what slipped, and who could not be
                  reached at all. Each opens its own durable record list. These are
                  historical operational totals, not unread-notification badges --
                  acknowledging an alert does not undo a visit. */}
              <div className="grid grid-cols-3 divide-x divide-line-subtle rtl:divide-x-reverse">
                <MetricButton
                  value={tech.completedTasks || 0}
                  label={t("technicians.completedTasks")}
                  tone="success"
                  onClick={() => setModal({ tech, kind: "completed" })}
                />
                <MetricButton
                  value={tech.postponedTasks || 0}
                  label={t("technicians.postponedTasks")}
                  tone="warning"
                  onClick={() => setModal({ tech, kind: "postponed" })}
                />
                <MetricButton
                  value={tech.noAnswerCount || 0}
                  label={t("technicians.noAnswer")}
                  tone="danger"
                  onClick={() => setModal({ tech, kind: "no-answer" })}
                />
              </div>
            </div>
          ))}
        </div>
        </div>
      )}

      {modal && (
        <ActivityModal
          tech={modal.tech}
          kind={modal.kind}
          onClose={() => setModal(null)}
          onOpenTask={task => setTaskDetail({ task, techName: modal.tech.name })}
        />
      )}

      {/* Completed-task detail. Rendered after the list so it stacks above it.
          `task` is the fetched record once it arrives, and the list row until
          then -- so the dialog opens instantly with the fields the list already
          had, and the photo appears when it loads. */}
      {taskDetail && (() => { const detailTask = { ...taskDetail.task, ...(fullTask || {}) }; return (
        <Modal
          open
          onClose={() => setTaskDetail(null)}
          size="md"
          className="max-h-[88vh]"
          title={isAr ? "تفاصيل المهمة المكتملة" : "Completed Task Details"}
          footer={<Button variant="secondary" onClick={() => setTaskDetail(null)}>{isAr ? "إغلاق" : "Close"}</Button>}
        >
          <div className="space-y-4">
            <Badge tone="success" dot>{isAr ? "مكتملة" : "Completed"}</Badge>

            <FactGroup title={isAr ? "معلومات المهمة" : "Task Information"}>
              <Fact label={isAr ? "اسم العميل" : "Customer"}>
                <span className="font-semibold text-fg">
                  {detailTask.customer?.name || (isAr ? "زيارة عاجلة" : "Urgent Visit")}
                </span>
              </Fact>
              {detailTask.customer?.phone && (
                <Fact label={detailTask.customer?.secondaryPhone ? (isAr ? "الجوال الأساسي" : "Primary Mobile") : (isAr ? "رقم الجوال" : "Phone")}>
                  <span dir="ltr">{detailTask.customer.phone}</span>
                </Fact>
              )}
              {detailTask.customer?.secondaryPhone && (
                <Fact label={isAr ? "الجوال الإضافي" : "Additional Mobile"}>
                  <span dir="ltr">{detailTask.customer.secondaryPhone}</span>
                </Fact>
              )}
              <Fact label={isAr ? "نوع الخدمة" : "Service Type"}>
                {APPT_TYPE_LABELS[detailTask.type || ''] || "—"}
              </Fact>
              {detailTask.scheduledDate && (
                <Fact label={isAr ? "تاريخ الموعد" : "Appointment Date"}>
                  <span dir="ltr" className="tabular-nums">{formatGregorianDate(detailTask.scheduledDate)}</span>
                </Fact>
              )}
              <Fact label={isAr ? "اسم الفني" : "Technician"}>
                {detailTask.completionTechnicianName || firstNameOf(taskDetail.techName)}
              </Fact>
            </FactGroup>

            <FactGroup
              title={isAr ? "معلومات الإتمام" : "Completion Information"}
              className="bg-success-bg border-success-border"
            >
              <Fact label={isAr ? "الحالة" : "Status"}>
                <span className="text-success-fg font-semibold">{isAr ? "مكتملة" : "Completed"}</span>
              </Fact>
              {detailTask.actualCompletionDate && (
                <Fact label={isAr ? "تاريخ الإكمال" : "Completion Date"}>
                  <span dir="ltr" className="tabular-nums font-medium">{formatGregorianDate(detailTask.actualCompletionDate)}</span>
                </Fact>
              )}
              <Fact label={isAr ? "تأكيد الصيانة" : "Maintenance Confirmation"}>
                <Badge tone={detailTask.maintenanceConfirmed ? "success" : "pending"}>
                  {detailTask.maintenanceConfirmed
                    ? (isAr ? "تم تأكيد العملية" : "Operation Confirmed")
                    : (isAr ? "بانتظار تأكيد الصيانة" : "Awaiting Maintenance Confirmation")}
                </Badge>
              </Fact>
              {detailTask.completedAt && (
                <Fact label={isAr ? "تاريخ ووقت الإتمام" : "Completed At"}>
                  <span className="tabular-nums font-medium">{formatCompletionDate(detailTask.completedAt, isAr)}</span>
                </Fact>
              )}
              {detailTask.serviceDetails && (
                <Fact label={isAr ? "تفاصيل الخدمة" : "Service Details"}>{detailTask.serviceDetails}</Fact>
              )}
              {detailTask.workNotes && (
                <Fact label={isAr ? "ملاحظات الإتمام" : "Completion Notes"}>{detailTask.workNotes}</Fact>
              )}
              {detailTask.nextMaintenanceNote && (
                <Fact label={isAr ? "ملاحظة الصيانة القادمة" : "Next Maintenance Note"}>{detailTask.nextMaintenanceNote}</Fact>
              )}
              {!detailTask.serviceDetails && !detailTask.workNotes && (
                <p className="text-2xs text-fg-muted italic">{isAr ? "لا توجد تفاصيل مُدخلة" : "No details provided"}</p>
              )}
            </FactGroup>

            {/* Payment (Admin only -- API already strips these for SCHEDULING) */}
            {(detailTask.completionAmount != null || detailTask.completionPaymentMethod) && (
              <FactGroup title={isAr ? "معلومات الدفع" : "Payment Information"}>
                {detailTask.completionAmount != null && (
                  <Fact label={isAr ? "المبلغ" : "Amount"}>
                    <span className="font-semibold text-fg text-sm tabular-nums">
                      {detailTask.completionAmount.toFixed(2)} {isAr ? "ريال" : "SAR"}
                    </span>
                  </Fact>
                )}
                {detailTask.completionPaymentMethod && (
                  <Fact label={isAr ? "طريقة الدفع" : "Payment Method"}>
                    {PAYMENT_LABELS[detailTask.completionPaymentMethod] || detailTask.completionPaymentMethod}
                  </Fact>
                )}
              </FactGroup>
            )}

            <section>
              <p className="text-2xs font-semibold uppercase tracking-wide text-fg-muted mb-2">
                {isAr ? "صورة الإتمام" : "Completion Image"}
              </p>
              {detailTask.completionImage ? (
                <button
                  type="button"
                  onClick={() => setImageViewer(detailTask.completionImage)}
                  title={isAr ? "انقر للتكبير" : "Click to enlarge"}
                  className="group relative block rounded-md overflow-hidden border border-line"
                >
                  <img
                    src={detailTask.completionImage}
                    alt={isAr ? "صورة الإتمام" : "Completion photo"}
                    className="w-full max-w-[280px] h-44 object-cover cursor-zoom-in"
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
                    <span className="opacity-0 group-hover:opacity-100 bg-black/70 text-white text-2xs px-2.5 py-1 rounded transition-opacity">
                      {isAr ? "انقر للتكبير" : "Click to enlarge"}
                    </span>
                  </span>
                </button>
              ) : (
                <div className="bg-surface-subtle rounded-md p-5 text-center border border-dashed border-line">
                  <p className="text-xs text-fg-muted italic">{t("tasks.noImage")}</p>
                </div>
              )}
            </section>
          </div>
        </Modal>
      ); })()}

      {imageViewer && (
        <ImageViewer src={imageViewer} onClose={() => setImageViewer(null)} isAr={isAr} />
      )}
    </div>
  );
}
