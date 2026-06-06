import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/appStore";
import axios from "axios";
import toast from "react-hot-toast";

type View = "list" | "thread" | "compose";

const ROLE_COLORS: Record<string, string> = {
  ADMIN: "bg-blue-100 text-blue-700",
  SCHEDULING: "bg-green-100 text-green-700",
  TECHNICIAN: "bg-orange-100 text-orange-700",
};

function formatTime(d: string, lang: string) {
  const date = new Date(d);
  const diff = Date.now() - date.getTime();
  const isAr = lang === "ar";
  if (diff < 60000) return isAr ? "الآن" : "Just now";
  const mins = Math.floor(diff / 60000);
  if (diff < 3600000) return isAr ? `${mins} د` : `${mins}m ago`;
  const hrs = Math.floor(diff / 3600000);
  if (diff < 86400000) return isAr ? `${hrs} س` : `${hrs}h ago`;
  return date.toLocaleDateString(isAr ? "ar-SA" : undefined);
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

  const confirmModal = (onConfirm: () => void, onCancel: () => void, title: string, desc?: string) => (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl space-y-4">
        <p className="font-semibold text-slate-800">{title}</p>
        {desc && <p className="text-sm text-slate-500">{desc}</p>}
        <div className="flex gap-3">
          <button onClick={onConfirm} disabled={deleteConv.isPending || deleteAll.isPending}
            className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">
            {t("common.delete")}
          </button>
          <button onClick={onCancel} className="flex-1 border py-2 rounded-lg text-sm hover:bg-slate-50">
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );

  // ── CONVERSATION LIST ──
  if (view === "list") {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-700">{t("messaging.conversations")}</h2>
          <div className="flex gap-2">
            {newRoles.length > 0 && (
              <button onClick={() => setView("compose")}
                className="text-xs px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50">
                {t("messaging.newConversation")}
              </button>
            )}
            {(conversations || []).length > 0 && (
              <button onClick={() => setDeleteAllConfirm(true)}
                className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">
                {t("messages.deleteAll")}
              </button>
            )}
          </div>
        </div>

        {isLoading ? (
          <p className="text-center py-12 text-slate-400">{t("common.loading")}</p>
        ) : !(conversations || []).length ? (
          <div className="bg-white rounded-xl shadow-sm p-12 text-center text-slate-400">
            <p className="text-3xl mb-2">💬</p>
            <p>{t("messaging.noConversations")}</p>
            {newRoles.length > 0 && (
              <button onClick={() => setView("compose")}
                className="mt-3 text-sm text-blue-600 hover:underline">
                {t("messaging.newConversation")}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {(conversations || []).map((conv: any) => (
              <div key={conv.otherRole} onClick={() => openThread(conv.otherRole)}
                className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-3 hover:bg-slate-50 cursor-pointer">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${ROLE_COLORS[conv.otherRole] || "bg-slate-100 text-slate-600"}`}>
                  {(t(`roles.${conv.otherRole}`) || conv.otherRole)?.[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{t(`roles.${conv.otherRole}`)}</span>
                    {conv.unreadCount > 0 && (
                      <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 truncate">{conv.lastMessage?.content}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-slate-400">
                    {conv.lastMessage ? formatTime(conv.lastMessage.createdAt, i18n.language) : ""}
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(conv.otherRole); }}
                    className="p-1 text-slate-300 hover:text-red-500 transition-colors rounded text-base leading-none">
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {deleteConfirm && confirmModal(
          () => deleteConv.mutate(deleteConfirm),
          () => setDeleteConfirm(null),
          t("messaging.deleteConvConfirm"),
          t("messaging.conversationWith") + ": " + t(`roles.${deleteConfirm}`)
        )}
        {deleteAllConfirm && confirmModal(
          () => deleteAll.mutate(),
          () => setDeleteAllConfirm(false),
          t("messaging.deleteAllConvConfirm")
        )}
      </div>
    );
  }

  // ── THREAD VIEW ──
  if (view === "thread" && selectedRole) {
    return (
      <div className="max-w-2xl mx-auto space-y-3">
        <div className="bg-white rounded-xl shadow-sm p-3 flex items-center gap-3">
          <button onClick={() => { setView("list"); setSelectedRole(null); }}
            className="text-slate-500 hover:text-slate-700 text-sm px-2 py-1 rounded hover:bg-slate-100">
            ← {t("common.back")}
          </button>
          <span className="font-semibold text-sm flex-1">{t(`roles.${selectedRole}`)}</span>
          <button onClick={() => setDeleteConfirm(selectedRole)}
            className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 border border-red-200">
            🗑️ {t("messaging.deleteConversation")}
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 space-y-3 min-h-48 max-h-96 overflow-y-auto">
          {!activeConv?.messages?.length ? (
            <p className="text-center text-slate-400 text-sm py-8">{t("messaging.noConversations")}</p>
          ) : activeConv.messages.map((m: any) => {
            const isSent = m.direction === "sent";
            return (
              <div key={m.id} className={"flex " + (isSent ? "justify-end" : "justify-start")}>
                <div className="max-w-xs lg:max-w-md">
                  {!isSent && <p className="text-xs text-slate-400 mb-1 px-1">{m.sender?.name}</p>}
                  <div className={"px-4 py-2 rounded-xl text-sm " + (isSent ? "bg-blue-600 text-white rounded-tr-none" : "bg-slate-100 text-slate-800 rounded-tl-none")}>
                    {m.content}
                  </div>
                  <p className={"text-xs text-slate-400 mt-1 px-1 " + (isSent ? "text-end" : "")}>
                    {formatTime(m.createdAt, i18n.language)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="bg-white rounded-xl shadow-sm p-3 space-y-2">
          <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={3}
            placeholder={t("messaging.typeMessage")}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          <div className="flex justify-end">
            <button onClick={() => sendMsg.mutate({ content: replyText, recipientRole: selectedRole })}
              disabled={!replyText.trim() || sendMsg.isPending}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 font-medium">
              {sendMsg.isPending ? t("messaging.sending") : t("messaging.reply")}
            </button>
          </div>
        </div>

        {deleteConfirm && confirmModal(
          () => deleteConv.mutate(deleteConfirm),
          () => setDeleteConfirm(null),
          t("messaging.deleteConvConfirm")
        )}
      </div>
    );
  }

  // ── COMPOSE NEW ──
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b flex items-center gap-3">
          <button onClick={() => setView("list")}
            className="text-slate-500 hover:text-slate-700 text-sm">
            ← {t("common.back")}
          </button>
          <span className="font-semibold text-sm">{t("messaging.newMessage")}</span>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">{t("messaging.sendTo")}</label>
            <div className="flex gap-2 flex-wrap">
              {(newRoles.length > 0 ? newRoles : targetRoles).map((r) => (
                <button key={r} onClick={() => setComposeRole(r)}
                  className={"px-4 py-2 rounded-lg text-sm border transition-colors " + (composeRole === r ? "bg-blue-700 text-white border-blue-700" : "hover:bg-slate-50 border-slate-200")}>
                  {t(`roles.${r}`)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("messaging.message")}</label>
            <textarea value={composeText} onChange={(e) => setComposeText(e.target.value)} rows={5}
              placeholder={t("messaging.typeMessage")}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-y" />
          </div>
          <div className="flex justify-end">
            <button onClick={() => sendMsg.mutate({ content: composeText, recipientRole: composeRole })}
              disabled={!composeText.trim() || !composeRole || sendMsg.isPending}
              className="bg-blue-700 text-white px-6 py-2 rounded-lg text-sm hover:bg-blue-800 disabled:opacity-50 font-medium">
              {sendMsg.isPending ? t("messaging.sending") : t("messaging.sendMessage")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
