import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useAuthStore } from "../store/authStore";
import toast from "react-hot-toast";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";
import { formatGregorianDate } from "../../utils/dateTimeInput";
import { Button } from "../../ui/Button";
import { Input, Textarea, Field, Label } from "../../ui/Field";
import { Badge, Tone } from "../../ui/Badge";
import { Callout, Loading } from "../../ui/Feedback";
import { Modal } from "../../ui/Modal";
import { Segmented } from "../../ui/Segmented";
import { Icon } from "../../ui/icons";
import { cx } from "../../ui/cx";

type PaymentMethod = "CASH" | "BANK_TRANSFER_COMMERCIAL" | "BANK_TRANSFER_PERSONAL";
type PaymentGroup = "CASH" | "BANK_TRANSFER";
type TransferType = "" | "COMMERCIAL" | "PERSONAL";

const ACCEPTED_IMG_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMG_PX = 1200;

// Modification #13: one Unicode letter "word" (Latin or Arabic), optionally
// joined by a single internal hyphen/apostrophe -- matches the backend's
// FIRST_NAME_RE in routes/appointments.ts exactly (duplicated deliberately,
// same convention as PHONE_RE between AddCustomer.tsx and customers.ts).
// Exported (alongside firstNameOf below) so permanent tests can exercise the
// exact production logic directly rather than re-implementing it.
export const FIRST_NAME_RE = /^[\p{L}]+(?:['-][\p{L}]+)*$/u;

export function firstNameOf(fullName?: string | null): string {
  const trimmed = (fullName || "").trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}

async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_IMG_PX / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      img.onerror = reject;
      img.src = e.target!.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Bank Transfer subtype fix (Part D, same behavior as the urgent visit form):
// paymentGroup is the top-level Cash/Bank Transfer choice; transferType only
// matters (and is only shown) when paymentGroup is Bank Transfer.
// v4 decision D4: no technicianName. The technician is identified by their own
// authenticated session, so the app no longer asks them to type their own name.
const EMPTY_COMPLETE = { serviceDetails: "", amount: "", paymentGroup: "CASH" as PaymentGroup, transferType: "" as TransferType, nextMaintenanceNote: "", actualCompletionDate: "" };

// Modification #8: today's date in the local YYYY-MM-DD form a native date
// input expects, used both to default the field and to cap it via `max` so a
// future date can't be picked in the first place (server also rejects it).
function todayDateInputValue(): string {
  const d = new Date();
  const offsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 10);
}

const STATUS_TONE: Record<string, Tone> = {
  WAITING: "pending",
  IN_PROGRESS: "progress",
  COMPLETED: "success",
  POSTPONED: "warning",
};

/** One label/value pair in the task summary grid. */
function Detail({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs uppercase tracking-wide text-fg-muted">{label}</dt>
      <dd className="text-[0.8125rem] text-fg mt-0.5">{children}</dd>
    </div>
  );
}

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [showComplete, setShowComplete] = useState(false);
  const [showPostpone, setShowPostpone] = useState(false);
  const [showNoAnswer, setShowNoAnswer] = useState(false);
  const [noAnswerNote, setNoAnswerNote] = useState("");
  const [completeForm, setCompleteForm] = useState({ ...EMPTY_COMPLETE });
  const [postponeReason, setPostponeReason] = useState("");
  const [postponeDate, setPostponeDate] = useState("");
  const [completionImage, setCompletionImage] = useState<string | null>(null);
  const [imageCompressing, setImageCompressing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["appointment", id],
    queryFn: () => api.get(`/appointments/${id}`).then(r => r.data.data)
  });

  const start = useMutation({
    mutationFn: () => api.patch(`/appointments/${id}/start`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work-queue"] });
      qc.invalidateQueries({ queryKey: ["appointment", id] });
      toast.success(t("common.success"));
    }
  });

  const complete = useMutation({
    mutationFn: () => api.patch(`/appointments/${id}/complete`, {
      notes: ".",
      serviceDetails: completeForm.serviceDetails,
      completionAmount: parseFloat(completeForm.amount),
      completionPaymentMethod: resolvePaymentMethod(),
      actualCompletionDate: completeForm.actualCompletionDate,
      ...(completionImage ? { completionImage } : {}),
      ...(completeForm.nextMaintenanceNote.trim() ? { nextMaintenanceNote: completeForm.nextMaintenanceNote } : {}),
    }),
    onSuccess: () => { toast.success(t("common.success")); navigate("/technician/queue"); },
    onError: (err: any) => toast.error(err?.response?.data?.message || t("common.error")),
  });

  // Requirement #7: a durable contact-attempt record. Deliberately sends only an
  // optional note -- there is no technician field, because the server takes the
  // actor from the authenticated session.
  const noAnswer = useMutation({
    mutationFn: () => api.patch(`/appointments/${id}/no-answer`, { note: noAnswerNote.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work-queue"] });
      qc.invalidateQueries({ queryKey: ["appointment", id] });
      toast.success(t("tasks.noAnswerRecorded"));
      setShowNoAnswer(false);
      setNoAnswerNote("");
    },
    onError: () => toast.error(t("common.error")),
  });

  const postpone = useMutation({
    // v4 Requirement #6: the new agreed date is REQUIRED and the note is
    // optional -- the inverse of the old form, which required a reason and made
    // the date optional.
    mutationFn: () => api.patch(`/appointments/${id}/postpone`, { note: postponeReason || undefined, newDate: postponeDate }),
    onSuccess: () => { toast.success(t("common.success")); navigate("/technician/queue"); }
  });

  if (isLoading) return <Loading label={t("common.loading")} />;
  if (!data) return <Callout tone="danger">{t("common.error")}</Callout>;

  const appt = data;
  const customer = appt.customer;
  const addr = customer?.address;
  const workStatus = appt.workStatus;

  // Bank Transfer subtype fix (Part D): resolves the final 3-way value the
  // backend accepts. Cash never needs a subtype; Bank Transfer requires one
  // (Commercial or Personal) to be selected, matching the urgent visit form.
  const paymentMethodValid = completeForm.paymentGroup === "CASH" || !!completeForm.transferType;
  function resolvePaymentMethod(): PaymentMethod | null {
    if (completeForm.paymentGroup === "CASH") return "CASH";
    if (completeForm.transferType === "COMMERCIAL") return "BANK_TRANSFER_COMMERCIAL";
    if (completeForm.transferType === "PERSONAL") return "BANK_TRANSFER_PERSONAL";
    return null;
  }

  const isCompleteValid = completeForm.serviceDetails.trim() && completeForm.amount && parseFloat(completeForm.amount) >= 0 && !!completeForm.actualCompletionDate && paymentMethodValid;

  const PAYMENT_LABELS: Record<string, string> = {
    CASH: isAr ? "نقداً" : "Cash",
    BANK_TRANSFER: isAr ? "تحويل بنكي" : "Bank Transfer",
  };

  const TRANSFER_TYPE_LABELS: Record<string, string> = {
    COMMERCIAL: t("tasks.commercialTransfer"),
    PERSONAL: t("tasks.personalTransfer"),
  };

  // Modification #9: same status-label mapping WorkQueue uses, so the detail
  // page shows a readable label instead of the raw workStatus enum value.
  const statusLabel: Record<string, string> = {
    WAITING: t("tasks.waiting") || "Waiting",
    IN_PROGRESS: t("tasks.inProgress"),
    COMPLETED: t("tasks.completed"),
    POSTPONED: t("tasks.postponed"),
  };

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) { setCompletionImage(null); return; }
    if (!ACCEPTED_IMG_TYPES.includes(file.type)) {
      toast.error(isAr ? "صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WEBP." : "Unsupported format. Use JPG, PNG or WEBP.");
      e.target.value = "";
      return;
    }
    setImageCompressing(true);
    try {
      const compressed = await compressImage(file);
      setCompletionImage(compressed);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setImageCompressing(false);
    }
  }

  function closeCompleteModal() {
    setShowComplete(false);
    setCompleteForm({ ...EMPTY_COMPLETE });
    setCompletionImage(null);
  }

  let urgentLocation: any = null;
  if (!customer && appt?.urgentLocation) {
    try { urgentLocation = JSON.parse(appt.urgentLocation); } catch { urgentLocation = null; }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="text-fg-muted hover:text-fg text-2xs inline-flex items-center gap-1.5 transition-colors"
      >
        <Icon name="chevronStart" className="w-3.5 h-3.5 rtl:rotate-180" />
        {t("common.back")}
      </button>

      <div className="bg-surface border border-line rounded-md">
        {/* Identity + status: who and where the job stands, before anything else. */}
        <div className="p-4 flex items-start justify-between gap-4 border-b border-line">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fg truncate">
              {customer?.name || (isAr ? "موعد عاجل" : "Urgent Task")}
            </h2>
            <p className="text-xs text-fg-secondary mt-1" dir={customer?.secondaryPhone ? undefined : "ltr"}>
              {customer?.secondaryPhone ? `${t("customers.primaryPhone")}: ${customer.phone}` : customer?.phone}
            </p>
            {customer?.secondaryPhone && (
              <p className="text-xs text-fg-secondary">{t("customers.secondaryPhone")}: {customer.secondaryPhone}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <Badge tone={STATUS_TONE[workStatus] ?? "neutral"} dot>
              {statusLabel[workStatus] || workStatus}
            </Badge>
            {!appt?.technicianId && <Badge tone="neutral">{t("tasks.unassigned")}</Badge>}
          </div>
        </div>

        <div className="p-4 space-y-4">
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Detail label={t("appointments.type")}>
              {appt?.type === "INSTALLATION" ? t("appointments.installation") : t("appointments.maintenance")}
            </Detail>
            <Detail label={t("common.date")}>
              <span dir="ltr" className="tabular-nums">{formatGregorianDate(appt?.scheduledDate)}</span>
            </Detail>
          </dl>

          {addr && (
            <div className="bg-surface-subtle border border-line-subtle rounded-md p-3">
              <p className="text-2xs uppercase tracking-wide text-fg-muted mb-1.5 flex items-center gap-1.5">
                <Icon name="location" className="w-3.5 h-3.5" />
                {t("customers.address")}
              </p>
              <p className="text-[0.8125rem] text-fg">{addr.city}، {addr.district}، {addr.street}</p>
              {addr.buildingNo && (
                <p className="text-xs text-fg-secondary mt-0.5">
                  {t("customers.buildingNo")}: {addr.buildingNo}
                  {addr.floorNo && ` | ${t("customers.floorNo")}: ${addr.floorNo}`}
                </p>
              )}
              {addr.apartmentNo && (
                <p className="text-xs text-fg-secondary mt-0.5">{t("customers.apartmentNo")}: {addr.apartmentNo}</p>
              )}
            </div>
          )}

          {urgentLocation && (
            <Callout tone="urgent" title={isAr ? "موقع العميل" : "Customer Location"}>
              <div className="space-y-0.5 text-xs">
                {urgentLocation.city && <p>{t("customers.city")}: {urgentLocation.city}</p>}
                {urgentLocation.district && <p>{t("customers.district")}: {urgentLocation.district}</p>}
                {urgentLocation.street && <p>{t("customers.street")}: {urgentLocation.street}</p>}
                {urgentLocation.buildingNo && (
                  <p>
                    {t("customers.buildingNo")}: {urgentLocation.buildingNo}
                    {urgentLocation.floorNo ? ` | ${t("customers.floorNo")}: ${urgentLocation.floorNo}` : ""}
                  </p>
                )}
                {urgentLocation.apartmentNo && <p>{t("customers.apartmentNo")}: {urgentLocation.apartmentNo}</p>}
              </div>
            </Callout>
          )}

          {appt?.notes && (
            <div className="bg-surface-subtle border border-line-subtle rounded-md p-3">
              <p className="text-2xs uppercase tracking-wide text-fg-muted mb-1.5">{t("common.notes")}</p>
              <p className="text-[0.8125rem] text-fg whitespace-pre-wrap">{appt.notes}</p>
            </div>
          )}
        </div>

        {/* Actions live in their own bar so the one thing to do next is never
            buried among the details above. */}
        {(workStatus === "WAITING" || workStatus === "IN_PROGRESS") && (
          <div className="px-4 py-3 border-t border-line bg-surface-subtle flex gap-2 justify-end">
            {workStatus === "WAITING" && (
              <Button variant="primary" loading={start.isPending} onClick={() => start.mutate()}>
                <Icon name="check" className="w-3.5 h-3.5" />
                {t("tasks.start")}
              </Button>
            )}
            {workStatus === "IN_PROGRESS" && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => { setNoAnswerNote(""); setShowNoAnswer(true); }}
                >
                  <Icon name="urgent" className="w-3.5 h-3.5" />
                  {t("tasks.noAnswer")}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => { setPostponeReason(""); setPostponeDate(""); setShowPostpone(true); }}
                >
                  <Icon name="clock" className="w-3.5 h-3.5" />
                  {t("tasks.postpone")}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setCompleteForm(f => ({ ...f, actualCompletionDate: todayDateInputValue() }));
                    setShowComplete(true);
                  }}
                >
                  <Icon name="check" className="w-3.5 h-3.5" />
                  {t("tasks.complete")}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <Modal
        open={showComplete}
        onClose={closeCompleteModal}
        closeOnBackdrop={false}
        title={
          <span className="flex items-center gap-2">
            {t("tasks.confirmComplete")}
            <HelpButton titleAr={HELP["form.taskCompletion"].titleAr} contentAr={HELP["form.taskCompletion"].contentAr} />
          </span>
        }
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={closeCompleteModal}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              disabled={!isCompleteValid || imageCompressing}
              loading={complete.isPending}
              onClick={() => complete.mutate()}
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Callout tone="info">
            {isAr ? "جميع الحقول إلزامية لإتمام المهمة" : "All fields are required to complete the task"}
          </Callout>

          {/* v4 decision D4: the "Technician Name" field is gone. The signed-in
              technician IS the identity, so it is shown back to them as
              confirmation rather than asked for as input -- one less thing to
              type, and one less way for the record to disagree with the JWT. */}
          <div className="flex items-center gap-2 text-xs text-fg-secondary bg-surface-subtle border border-line-subtle rounded px-2.5 py-2">
            <Icon name="technicians" className="w-3.5 h-3.5 text-fg-muted flex-shrink-0" />
            <span>{t("tasks.completingAs")}</span>
            <span className="font-medium text-fg truncate">{user?.name}</span>
          </div>

          <Field label={t("tasks.serviceDetails")} htmlFor="service-details" required>
            <Textarea
              id="service-details" rows={3} required
              value={completeForm.serviceDetails}
              onChange={e => setCompleteForm(f => ({ ...f, serviceDetails: e.target.value }))}
              placeholder={isAr ? "تفاصيل الخدمة المنفذة..." : "Details of work done..."}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("tasks.completionDate")} htmlFor="completion-date" required>
              <Input
                id="completion-date" type="date" required lang="en-GB" dir="ltr"
                value={completeForm.actualCompletionDate}
                max={todayDateInputValue()}
                onChange={e => setCompleteForm(f => ({ ...f, actualCompletionDate: e.target.value }))}
              />
            </Field>

            <Field label={`${t("tasks.amount")} (SAR)`} htmlFor="completion-amount" required>
              <Input
                id="completion-amount" type="number" step="0.01" min="0" required dir="ltr"
                className="tabular-nums"
                value={completeForm.amount}
                onChange={e => setCompleteForm(f => ({ ...f, amount: e.target.value }))}
              />
            </Field>
          </div>

          <div>
            <Label required>{t("tasks.paymentMethod")}</Label>
            <Segmented<PaymentGroup>
              value={completeForm.paymentGroup}
              options={["CASH", "BANK_TRANSFER"]}
              labels={PAYMENT_LABELS}
              onChange={pg => setCompleteForm(f => ({ ...f, paymentGroup: pg, transferType: "" }))}
            />
          </div>

          {completeForm.paymentGroup === "BANK_TRANSFER" && (
            <div>
              <Label required>{t("tasks.transferType")}</Label>
              <Segmented<"COMMERCIAL" | "PERSONAL">
                value={completeForm.transferType as "COMMERCIAL" | "PERSONAL" | ""}
                options={["COMMERCIAL", "PERSONAL"]}
                labels={TRANSFER_TYPE_LABELS}
                onChange={tt => setCompleteForm(f => ({ ...f, transferType: tt }))}
              />
            </div>
          )}

          <Field
            label={
              <>
                {t("tasks.nextMaintenanceNote")}
                <span className="text-fg-muted font-normal ms-1">({isAr ? "اختياري" : "Optional"})</span>
              </>
            }
            htmlFor="next-maintenance"
          >
            <Textarea
              id="next-maintenance" rows={2}
              value={completeForm.nextMaintenanceNote}
              onChange={e => setCompleteForm(f => ({ ...f, nextMaintenanceNote: e.target.value }))}
              placeholder={isAr ? "مثال: يجب استبدال الفلتر في الزيارة القادمة..." : "e.g. filter should be replaced next visit..."}
            />
          </Field>

          <div>
            <Label htmlFor="completion-photo">
              {t("tasks.attachPhoto")}
              <span className="text-fg-muted font-normal ms-1">({isAr ? "اختياري" : "Optional"})</span>
            </Label>
            <input
              id="completion-photo"
              type="file"
              accept={ACCEPTED_IMG_TYPES.join(",")}
              disabled={imageCompressing}
              onChange={handleImageChange}
              className={cx(
                "w-full rounded border border-line bg-surface text-fg-secondary",
                "px-2.5 py-1.5 text-xs cursor-pointer",
                "file:me-3 file:text-xs file:font-medium file:border-0 file:rounded-sm",
                "file:bg-accent-subtle file:text-accent-subtlefg file:px-2 file:py-1 file:cursor-pointer"
              )}
            />
            {imageCompressing && (
              <p className="text-2xs text-fg-muted mt-1 animate-pulse">
                {isAr ? "جاري ضغط الصورة..." : "Compressing image..."}
              </p>
            )}
            {completionImage && !imageCompressing && (
              <div className="mt-2 relative inline-block">
                <img
                  src={completionImage}
                  alt=""
                  className="w-24 h-24 object-cover rounded-md border border-line"
                />
                <button
                  type="button"
                  onClick={() => setCompletionImage(null)}
                  aria-label={t("common.delete")}
                  className="absolute -top-1.5 -end-1.5 w-5 h-5 bg-danger-solid text-white rounded-full flex items-center justify-center hover:brightness-110"
                >
                  <Icon name="close" className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={showPostpone}
        onClose={() => setShowPostpone(false)}
        title={t("tasks.confirmPostpone")}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowPostpone(false)}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              disabled={!postponeDate}
              loading={postpone.isPending}
              onClick={() => postponeDate && postpone.mutate()}
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {/* Requirement #6: the technician agrees a replacement date with the
              customer, so the DATE is what is required here. The note is
              optional, and the technician's name is never asked for. */}
          <Field label={t("tasks.newDate")} htmlFor="postpone-date" required>
            <Input
              id="postpone-date" type="date" lang="en-GB" dir="ltr"
              min={todayDateInputValue()}
              value={postponeDate}
              onChange={e => setPostponeDate(e.target.value)}
            />
          </Field>
          {!postponeDate && (
            <p className="text-2xs text-fg-muted">{t("tasks.newDateRequired")}</p>
          )}
          <Field label={t("tasks.noteOptional")} htmlFor="postpone-reason">
            <Textarea
              id="postpone-reason" rows={3}
              value={postponeReason}
              onChange={e => setPostponeReason(e.target.value)}
            />
          </Field>
        </div>
      </Modal>

      {/* Requirement #7: the third technician action. */}
      <Modal
        open={showNoAnswer}
        onClose={() => setShowNoAnswer(false)}
        title={t("tasks.confirmNoAnswer")}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowNoAnswer(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={noAnswer.isPending} onClick={() => noAnswer.mutate()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Callout tone="info">{t("tasks.noAnswerHint")}</Callout>
          <Field label={t("tasks.noteOptional")} htmlFor="no-answer-note">
            <Textarea
              id="no-answer-note" rows={3}
              value={noAnswerNote}
              onChange={e => setNoAnswerNote(e.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
