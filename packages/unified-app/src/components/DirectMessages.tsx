import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/appStore";
import axios from "axios";
import toast from "react-hot-toast";
import { formatGregorianDate } from "../utils/dateTimeInput";
import { Button } from "../ui/Button";
import { Textarea, Label } from "../ui/Field";
import { CountBadge } from "../ui/Badge";
import { EmptyState, Loading } from "../ui/Feedback";
import { ConfirmDialog } from "../ui/Modal";
import { Segmented } from "../ui/Segmented";
import { Icon } from "../ui/icons";
import { cx } from "../ui/cx";

type View = "list" | "thread" | "compose";

function formatTime(d: string, lang: string) {
  const date = new Date(d);
  const diff = Date.now() - date.getTime();
  const isAr = lang === "ar";
  if (diff < 60000) return isAr ? "الآن" : "Just now";
  const mins = Math.floor(diff / 60000);
  if (diff < 3600000) return isAr ? `${mins} د` : `${mins}m ago`;
  const hrs = Math.floor(diff / 3600000);
  if (diff < 86400000) return isAr ? `${hrs} س` : `${hrs}h ago`;
  return formatGregorianDate(date);
}

function useApi() {
  const { pathname } = useLocation();
  const store = useAppStore();
  const auth =
    pathname.startsWith("/admin") ? store.adminAuth
    : pathname.startsWith("/scheduling") ? store.schedulingAuth
    : store.technicianAuth;
  const role = auth?.user?.role || "ADMIN";
  const instance = axios.create({ baseURL: store.serverUrl + "/api" });
  instance.interceptors.request.use((c) => {
    if (auth?.token) c.headers.Authorization = `Bearer ${auth.token}`;
    return c;
  });
  return { instance, role };
}

export default function DirectMessages() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const [view, setView] = useState<View>("list");
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [composeRole, setComposeRole] = useState("");
  const [composeText, setComposeText] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);
  const qc = useQueryClient();
  const { instance, role } = useApi();

  const ALL_ROLES = ["ADMIN", "SCHEDULING", "TECHNICIAN"];
  const targetRoles = ALL_ROLES.filter((r) => r !== role);

  const { data: conversations, isLoading } = useQuery({
    queryKey: ["dm-conversations", role],
    queryFn: () => instance.get("/direct-messages/conversations").then((r) => r.data.data || []),
    refetchInterval: 30000,
  });

  const existingRoles: string[] = (conversations || []).map((c: any) => c.otherRole);
  const newRoles = targetRoles.filter((r) => !existingRoles.includes(r));

  useEffect(() => {
    if (!composeRole && newRoles.length > 0) setComposeRole(newRoles[0]);
  }, [newRoles.join(",")]);

  const markRead = useMutation({
    mutationFn: (id: string) => instance.patch("/direct-messages/" + id + "/read"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dm-conversations", role] }),
  });

  const sendMsg = useMutation({
    mutationFn: (payload: { content: string; recipientRole: string }) =>
      instance.post("/direct-messages", payload),
    onSuccess: () => {
      setReplyText("");
      setComposeText("");
      qc.invalidateQueries({ queryKey: ["dm-conversations", role] });
      toast.success(t("messaging.messageSent"));
      if (view === "compose") setView("list");
    },
    onError: () => toast.error(t("messaging.sendFailed")),
  });

  const deleteConv = useMutation({
    mutationFn: (targetRole: string) =>
      instance.delete("/direct-messages/conversation/" + targetRole),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dm-conversations", role] });
      setDeleteConfirm(null);
      if (view === "thread") { setView("list"); setSelectedRole(null); }
      toast.success(t("messaging.deleted"));
    },
    onError: () => toast.error(t("common.error")),
  });

  const deleteAll = useMutation({
    mutationFn: () => instance.delete("/direct-messages/all"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dm-conversations", role] });
      setDeleteAllConfirm(false);
      setView("list");
      toast.success(t("messaging.deletedAll"));
    },
    onError: () => toast.error(t("common.error")),
  });

  function openThread(otherRole: string) {
    setSelectedRole(otherRole);
    setView("thread");
    const conv = (conversations || []).find((c: any) => c.otherRole === otherRole);
    if (conv) {
      conv.messages
        .filter((m: any) => m.direction === "received" && !m.isRead)
        .forEach((m: any) => markRead.mutate(m.id));
    }
  }

  const activeConv = (conversations || []).find((c: any) => c.otherRole === selectedRole);
  const convList: any[] = conversations || [];

  /**
   * Split pane, desktop-first: conversations stay listed on the start side
   * while a thread is open on the end side, so switching between them costs no
   * navigation. Below lg the two panes take turns, driven by the same `view`
   * state the single-column version always used.
   */
  const showListPane = view === "list";
  const showDetailPane = view !== "list";

  const roleLabel = (r: string) => t(`roles.${r}`) || r;

  return (
    <div className="h-[calc(100vh-11rem)] min-h-[26rem] flex bg-surface border border-line rounded-md overflow-hidden">
      {/* ── Conversations ─────────────────────────────────────────────────── */}
      <div
        className={cx(
          "w-full lg:w-72 flex-shrink-0 flex flex-col border-e border-line bg-surface-subtle",
          showListPane ? "flex" : "hidden lg:flex"
        )}
      >
        <div className="h-11 flex-shrink-0 px-3 flex items-center justify-between gap-2 border-b border-line">
          <h2 className="text-2xs font-semibold uppercase tracking-wide text-fg-muted truncate">
            {t("messaging.conversations")}
          </h2>
          <div className="flex items-center gap-1 flex-shrink-0">
            {newRoles.length > 0 && (
              <Button
                size="sm" variant="ghost" iconOnly
                onClick={() => setView("compose")}
                title={t("messaging.newConversation")}
                aria-label={t("messaging.newConversation")}
              >
                <Icon name="add" className="w-4 h-4" />
              </Button>
            )}
            {convList.length > 0 && (
              <Button
                size="sm" variant="ghost" iconOnly
                onClick={() => setDeleteAllConfirm(true)}
                title={t("messages.deleteAll")}
                aria-label={t("messages.deleteAll")}
                className="hover:text-danger-fg hover:bg-danger-bg"
              >
                <Icon name="trash" className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <Loading label={t("common.loading")} />
          ) : !convList.length ? (
            <EmptyState
              icon={<Icon name="messaging" className="w-5 h-5" />}
              title={t("messaging.noConversations")}
              action={
                newRoles.length > 0 ? (
                  <Button size="sm" variant="secondary" onClick={() => setView("compose")}>
                    {t("messaging.newConversation")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul>
              {convList.map((conv: any) => {
                const active = view === "thread" && selectedRole === conv.otherRole;
                return (
                  <li key={conv.otherRole} className="group relative">
                    <button
                      type="button"
                      onClick={() => openThread(conv.otherRole)}
                      className={cx(
                        "w-full text-start px-3 py-2.5 flex items-start gap-2.5 border-b border-line-subtle transition-colors",
                        active ? "bg-surface" : "hover:bg-surface-hover"
                      )}
                    >
                      {active && <span className="absolute inset-y-0 start-0 w-0.5 bg-accent" aria-hidden="true" />}
                      <span
                        className="w-7 h-7 rounded-md bg-surface-active text-fg-secondary text-2xs font-semibold flex items-center justify-center flex-shrink-0"
                        aria-hidden="true"
                      >
                        {roleLabel(conv.otherRole)?.[0]}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="text-[0.8125rem] font-medium text-fg truncate">{roleLabel(conv.otherRole)}</span>
                          <CountBadge value={conv.unreadCount || 0} />
                        </span>
                        <span className="block text-2xs text-fg-muted truncate mt-0.5">
                          {conv.lastMessage?.content}
                        </span>
                      </span>
                      <span className="text-2xs text-fg-muted flex-shrink-0 whitespace-nowrap">
                        {conv.lastMessage ? formatTime(conv.lastMessage.createdAt, i18n.language) : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── Thread / compose ──────────────────────────────────────────────── */}
      <div className={cx("flex-1 min-w-0 flex flex-col", showDetailPane ? "flex" : "hidden lg:flex")}>
        {view === "thread" && selectedRole ? (
          <>
            <div className="h-11 flex-shrink-0 px-3 flex items-center gap-2 border-b border-line">
              <Button
                size="sm" variant="ghost" iconOnly className="lg:hidden"
                onClick={() => { setView("list"); setSelectedRole(null); }}
                aria-label={t("common.back")}
              >
                <Icon name="chevronStart" className="w-4 h-4 rtl:rotate-180" />
              </Button>
              <span className="text-[0.8125rem] font-semibold text-fg flex-1 min-w-0 truncate">
                {roleLabel(selectedRole)}
              </span>
              <Button
                size="sm" variant="ghost" iconOnly
                onClick={() => setDeleteConfirm(selectedRole)}
                title={t("messaging.deleteConversation")}
                aria-label={t("messaging.deleteConversation")}
                className="hover:text-danger-fg hover:bg-danger-bg"
              >
                <Icon name="trash" className="w-4 h-4" />
              </Button>
            </div>

            <div key={selectedRole} className="ph-panel-enter flex-1 overflow-y-auto p-4 space-y-2.5 bg-canvas">
              {!activeConv?.messages?.length ? (
                <p className="text-center text-fg-muted text-xs py-8">{t("messaging.noConversations")}</p>
              ) : activeConv.messages.map((m: any) => {
                const isSent = m.direction === "sent";
                return (
                  <div key={m.id} className={cx("flex", isSent ? "justify-end" : "justify-start")}>
                    <div className="max-w-[min(32rem,80%)]">
                      {!isSent && <p className="text-2xs text-fg-muted mb-1 px-1">{m.sender?.name}</p>}
                      {/* Sent uses the accent, received a plain surface -- one
                          colour carries "mine", the rest of the thread stays
                          quiet enough to read a long backlog. */}
                      <div
                        className={cx(
                          "px-3 py-2 text-[0.8125rem] leading-relaxed whitespace-pre-wrap break-words rounded-md",
                          isSent
                            ? "bg-accent text-accent-fg rounded-se-sm"
                            : "bg-surface border border-line text-fg rounded-ss-sm"
                        )}
                      >
                        {m.content}
                      </div>
                      <p className={cx("text-2xs text-fg-muted mt-1 px-1", isSent && "text-end")}>
                        {formatTime(m.createdAt, i18n.language)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex-shrink-0 border-t border-line p-3 flex items-end gap-2">
              <Textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={2}
                placeholder={t("messaging.typeMessage")}
                aria-label={t("messaging.typeMessage")}
                className="flex-1 resize-none"
              />
              <Button
                variant="primary"
                onClick={() => sendMsg.mutate({ content: replyText, recipientRole: selectedRole })}
                disabled={!replyText.trim()}
                loading={sendMsg.isPending}
              >
                {t("messaging.reply")}
              </Button>
            </div>
          </>
        ) : view === "compose" ? (
          <>
            <div className="h-11 flex-shrink-0 px-3 flex items-center gap-2 border-b border-line">
              <Button
                size="sm" variant="ghost" iconOnly
                onClick={() => setView("list")}
                aria-label={t("common.back")}
              >
                <Icon name="chevronStart" className="w-4 h-4 rtl:rotate-180" />
              </Button>
              <span className="text-[0.8125rem] font-semibold text-fg">{t("messaging.newMessage")}</span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <Label>{t("messaging.sendTo")}</Label>
                <Segmented
                  value={composeRole}
                  options={newRoles.length > 0 ? newRoles : targetRoles}
                  labels={Object.fromEntries(ALL_ROLES.map(r => [r, roleLabel(r)]))}
                  onChange={setComposeRole}
                  ariaLabel={t("messaging.sendTo")}
                />
              </div>
              <div>
                <Label htmlFor="compose-text">{t("messaging.message")}</Label>
                <Textarea
                  id="compose-text"
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                  rows={8}
                  placeholder={t("messaging.typeMessage")}
                />
              </div>
            </div>

            <div className="flex-shrink-0 border-t border-line px-3 py-2.5 flex justify-end">
              <Button
                variant="primary"
                onClick={() => sendMsg.mutate({ content: composeText, recipientRole: composeRole })}
                disabled={!composeText.trim() || !composeRole}
                loading={sendMsg.isPending}
              >
                {t("messaging.sendMessage")}
              </Button>
            </div>
          </>
        ) : (
          // Desktop resting state: the list is on the left, nothing selected yet.
          // "Conversations" alone read like a heading rather than an
          // instruction, so this says what to do next.
          <EmptyState
            className="m-auto"
            icon={<Icon name="messaging" className="w-5 h-5" />}
            title={isAr ? "اختر محادثة" : "Select a conversation"}
            action={
              newRoles.length > 0 ? (
                <Button size="sm" variant="secondary" onClick={() => setView("compose")}>
                  {t("messaging.newConversation")}
                </Button>
              ) : undefined
            }
          />
        )}
      </div>

      <ConfirmDialog
        open={!!deleteConfirm}
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && deleteConv.mutate(deleteConfirm)}
        title={t("messaging.deleteConvConfirm")}
        message={deleteConfirm ? `${t("messaging.conversationWith")}: ${roleLabel(deleteConfirm)}` : undefined}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={deleteConv.isPending}
      />

      <ConfirmDialog
        open={deleteAllConfirm}
        onCancel={() => setDeleteAllConfirm(false)}
        onConfirm={() => deleteAll.mutate()}
        title={t("messaging.deleteAllConvConfirm")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={deleteAll.isPending}
      />
    </div>
  );
}
