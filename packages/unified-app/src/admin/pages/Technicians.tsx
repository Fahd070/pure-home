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

export default function Technicians() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const [modal, setModal] = useState<{ tech: any; type: "completed" | "postponed" } | null>(null);
  const [imageViewer, setImageViewer] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<{ task: any; techName: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["technicians-detail"],
    queryFn: () => api.get("/technicians").then(r => r.data.data),
  });

  if (isLoading) return <Loading label={t("common.loading")} />;

  const PAYMENT_LABELS: Record<string, string> = {
    CASH: isAr ? "نقداً" : "Cash",
    BANK_TRANSFER_COMMERCIAL: isAr ? "تحويل بنكي (تجاري)" : "Bank Transfer (Commercial)",
    BANK_TRANSFER_PERSONAL: isAr ? "تحويل بنكي (خاص)" : "Bank Transfer (Personal)",
  };

  const APPT_TYPE_LABELS: Record<string, string> = {
    MAINTENANCE: isAr ? "صيانة" : "Maintenance",
    INSTALLATION: isAr ? "تركيب" : "Installation",
  };

  const modalTasks = modal
    ? (modal.type === "completed" ? modal.tech.completedTasksList : modal.tech.postponedTasksList) || []
    : [];

  const technicians: any[] = data || [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("nav.technicians")}
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
          {technicians.map((tech: any) => {
            const completedCount = tech.completedTasksList?.length || 0;
            const postponedCount = tech.postponedTasksList?.length || 0;
            return (
              <div key={tech.id} className="bg-surface border border-line rounded-md">
                <div className="flex items-center gap-3 p-3.5 border-b border-line-subtle">
                  <span
                    className="w-9 h-9 rounded-md bg-surface-active text-fg-secondary flex items-center justify-center font-semibold text-sm flex-shrink-0"
                    aria-hidden="true"
                  >
                    {tech.name?.[0] || "?"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[0.8125rem] font-semibold text-fg truncate">{tech.name}</p>
                    <p className="text-2xs text-fg-muted truncate" dir="ltr">{tech.email}</p>
                  </div>
                </div>

                {/* Two counters, split down the middle: how much has landed and
                    how much has slipped. Each opens its own task list. */}
                <div className="grid grid-cols-2 divide-x divide-line-subtle rtl:divide-x-reverse">
                  <button
                    type="button"
                    onClick={() => completedCount > 0 ? setModal({ tech, type: "completed" }) : undefined}
                    disabled={completedCount === 0}
                    className={cx(
                      "p-3 text-center transition-colors",
                      completedCount > 0 ? "hover:bg-surface-hover cursor-pointer" : "cursor-default"
                    )}
                  >
                    <p className="text-xl font-semibold text-success-fg tabular-nums leading-none">{tech.completedTasks || 0}</p>
                    <p className="text-2xs text-fg-muted mt-1.5">{t("technicians.completedTasks")}</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => postponedCount > 0 ? setModal({ tech, type: "postponed" }) : undefined}
                    disabled={postponedCount === 0}
                    className={cx(
                      "p-3 text-center transition-colors",
                      postponedCount > 0 ? "hover:bg-surface-hover cursor-pointer" : "cursor-default"
                    )}
                  >
                    <p className="text-xl font-semibold text-warning-fg tabular-nums leading-none">{tech.postponedTasks || 0}</p>
                    <p className="text-2xs text-fg-muted mt-1.5">{isAr ? "المؤجلة" : "Postponed"}</p>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        </div>
      )}

      {/* Task list */}
      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        size="lg"
        className="max-h-[82vh]"
        title={
          modal?.type === "completed"
            ? (isAr ? "المهام المكتملة" : "Completed Tasks")
            : (isAr ? "المهام المؤجلة" : "Postponed Tasks")
        }
        description={modal ? `${modal.tech.name} — ${modalTasks.length} ${isAr ? "مهمة" : "tasks"}` : undefined}
      >
        {modalTasks.length === 0 ? (
          <EmptyState icon={<Icon name="queue" className="w-5 h-5" />} title={t("common.noRecords")} />
        ) : (
          <ul className="space-y-2">
            {modalTasks.map((task: any) => {
              const clickable = modal?.type === "completed";
              return (
                <li key={task.id}>
                  <div
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => setTaskDetail({ task, techName: modal!.tech.name }) : undefined}
                    onKeyDown={clickable ? e => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTaskDetail({ task, techName: modal!.tech.name }); }
                    } : undefined}
                    className={cx(
                      "border border-line rounded-md p-3 transition-colors",
                      clickable && "cursor-pointer hover:bg-surface-hover hover:border-line-strong"
                    )}
                  >
                    <div className="flex justify-between items-start gap-3 mb-2">
                      <div className="min-w-0">
                        <p className="text-[0.8125rem] font-medium text-fg truncate">
                          {task.customer?.name || (isAr ? "زيارة عاجلة" : "Urgent Visit")}
                        </p>
                        <p className="text-2xs text-fg-muted" dir="ltr">{task.customer?.phone || "—"}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-2xs text-fg-muted tabular-nums" dir="ltr">
                          {task.scheduledDate ? formatGregorianDate(task.scheduledDate) : "—"}
                        </span>
                        {clickable && <Icon name="chevronEnd" className="w-3.5 h-3.5 text-fg-muted rtl:rotate-180" />}
                      </div>
                    </div>

                    {modal?.type === "completed" ? (
                      <div className="space-y-1">
                        {task.type && (
                          <div className="flex gap-2 text-2xs">
                            <span className="text-fg-muted min-w-[90px] flex-shrink-0">{isAr ? "نوع الخدمة" : "Service type"}:</span>
                            <span className="text-fg-secondary">{APPT_TYPE_LABELS[task.type] || task.type}</span>
                          </div>
                        )}
                        {task.completedAt && (
                          <div className="flex gap-2 text-2xs">
                            <span className="text-fg-muted min-w-[90px] flex-shrink-0">{isAr ? "تاريخ الإتمام" : "Completed"}:</span>
                            <span className="text-success-fg font-medium tabular-nums">{formatCompletionDate(task.completedAt, isAr)}</span>
                          </div>
                        )}
                        {task.completionImage && (
                          <p className="text-2xs text-fg-muted pt-0.5 flex items-center gap-1">
                            <Icon name="download" className="w-3 h-3" />
                            {isAr ? "تم إرفاق صورة" : "Image attached"}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <DetailRow label={isAr ? "سبب التأجيل" : "Postponement reason"} value={task.postponements?.[0]?.reason} />
                        {task.postponements?.[0]?.newDate && (
                          <DetailRow
                            label={isAr ? "الموعد الجديد" : "New date"}
                            value={formatGregorianDate(task.postponements[0].newDate)} />
                        )}
                        <DetailRow label={isAr ? "ملاحظات الفني" : "Technician notes"} value={task.workNotes} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>

      {/* Completed-task detail. Rendered after the list so it stacks above it. */}
      {taskDetail && (
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
                  {taskDetail.task.customer?.name || (isAr ? "زيارة عاجلة" : "Urgent Visit")}
                </span>
              </Fact>
              {taskDetail.task.customer?.phone && (
                <Fact label={taskDetail.task.customer?.secondaryPhone ? (isAr ? "الجوال الأساسي" : "Primary Mobile") : (isAr ? "رقم الجوال" : "Phone")}>
                  <span dir="ltr">{taskDetail.task.customer.phone}</span>
                </Fact>
              )}
              {taskDetail.task.customer?.secondaryPhone && (
                <Fact label={isAr ? "الجوال الإضافي" : "Additional Mobile"}>
                  <span dir="ltr">{taskDetail.task.customer.secondaryPhone}</span>
                </Fact>
              )}
              <Fact label={isAr ? "نوع الخدمة" : "Service Type"}>
                {APPT_TYPE_LABELS[taskDetail.task.type || ''] || "—"}
              </Fact>
              {taskDetail.task.scheduledDate && (
                <Fact label={isAr ? "تاريخ الموعد" : "Appointment Date"}>
                  <span dir="ltr" className="tabular-nums">{formatGregorianDate(taskDetail.task.scheduledDate)}</span>
                </Fact>
              )}
              <Fact label={isAr ? "اسم الفني" : "Technician"}>
                {taskDetail.task.completionTechnicianName || firstNameOf(taskDetail.techName)}
              </Fact>
            </FactGroup>

            <FactGroup
              title={isAr ? "معلومات الإتمام" : "Completion Information"}
              className="bg-success-bg border-success-border"
            >
              <Fact label={isAr ? "الحالة" : "Status"}>
                <span className="text-success-fg font-semibold">{isAr ? "مكتملة" : "Completed"}</span>
              </Fact>
              {taskDetail.task.actualCompletionDate && (
                <Fact label={isAr ? "تاريخ الإكمال" : "Completion Date"}>
                  <span dir="ltr" className="tabular-nums font-medium">{formatGregorianDate(taskDetail.task.actualCompletionDate)}</span>
                </Fact>
              )}
              <Fact label={isAr ? "تأكيد الصيانة" : "Maintenance Confirmation"}>
                <Badge tone={taskDetail.task.maintenanceConfirmed ? "success" : "pending"}>
                  {taskDetail.task.maintenanceConfirmed
                    ? (isAr ? "تم تأكيد العملية" : "Operation Confirmed")
                    : (isAr ? "بانتظار تأكيد الصيانة" : "Awaiting Maintenance Confirmation")}
                </Badge>
              </Fact>
              {taskDetail.task.completedAt && (
                <Fact label={isAr ? "تاريخ ووقت الإتمام" : "Completed At"}>
                  <span className="tabular-nums font-medium">{formatCompletionDate(taskDetail.task.completedAt, isAr)}</span>
                </Fact>
              )}
              {taskDetail.task.serviceDetails && (
                <Fact label={isAr ? "تفاصيل الخدمة" : "Service Details"}>{taskDetail.task.serviceDetails}</Fact>
              )}
              {taskDetail.task.workNotes && (
                <Fact label={isAr ? "ملاحظات الإتمام" : "Completion Notes"}>{taskDetail.task.workNotes}</Fact>
              )}
              {taskDetail.task.nextMaintenanceNote && (
                <Fact label={isAr ? "ملاحظة الصيانة القادمة" : "Next Maintenance Note"}>{taskDetail.task.nextMaintenanceNote}</Fact>
              )}
              {!taskDetail.task.serviceDetails && !taskDetail.task.workNotes && (
                <p className="text-2xs text-fg-muted italic">{isAr ? "لا توجد تفاصيل مُدخلة" : "No details provided"}</p>
              )}
            </FactGroup>

            {/* Payment (Admin only -- API already strips these for SCHEDULING) */}
            {(taskDetail.task.completionAmount != null || taskDetail.task.completionPaymentMethod) && (
              <FactGroup title={isAr ? "معلومات الدفع" : "Payment Information"}>
                {taskDetail.task.completionAmount != null && (
                  <Fact label={isAr ? "المبلغ" : "Amount"}>
                    <span className="font-semibold text-fg text-sm tabular-nums">
                      {taskDetail.task.completionAmount.toFixed(2)} {isAr ? "ريال" : "SAR"}
                    </span>
                  </Fact>
                )}
                {taskDetail.task.completionPaymentMethod && (
                  <Fact label={isAr ? "طريقة الدفع" : "Payment Method"}>
                    {PAYMENT_LABELS[taskDetail.task.completionPaymentMethod] || taskDetail.task.completionPaymentMethod}
                  </Fact>
                )}
              </FactGroup>
            )}

            <section>
              <p className="text-2xs font-semibold uppercase tracking-wide text-fg-muted mb-2">
                {isAr ? "صورة الإتمام" : "Completion Image"}
              </p>
              {taskDetail.task.completionImage ? (
                <button
                  type="button"
                  onClick={() => setImageViewer(taskDetail.task.completionImage)}
                  title={isAr ? "انقر للتكبير" : "Click to enlarge"}
                  className="group relative block rounded-md overflow-hidden border border-line"
                >
                  <img
                    src={taskDetail.task.completionImage}
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
      )}

      {imageViewer && (
        <ImageViewer src={imageViewer} onClose={() => setImageViewer(null)} isAr={isAr} />
      )}
    </div>
  );
}
