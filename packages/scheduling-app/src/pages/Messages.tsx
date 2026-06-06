import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../store/authStore';

const ROLE_COLORS: Record<string, string> = { ADMIN: 'bg-blue-600', SCHEDULING: 'bg-green-600', TECHNICIAN: 'bg-orange-600' };

export default function Messages() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const socket = useSocket();
  const { user } = useAuthStore();
  const [content, setContent] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({ queryKey: ['messages'], queryFn: () => api.get('/messages').then(r => r.data.data) });

  const send = useMutation({
    mutationFn: () => api.post('/messages', { content }),
    onSuccess: () => { setContent(''); qc.invalidateQueries({ queryKey: ['messages'] }); }
  });

  useEffect(() => {
    if (!socket) return;
    socket.on('message:new', () => qc.invalidateQueries({ queryKey: ['messages'] }));
    return () => { socket.off('message:new'); };
  }, [socket, qc]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [data]);

  return (
    <div className="flex flex-col h-full bg-white rounded-xl shadow-sm overflow-hidden" style={{ height: 'calc(100vh - 160px)' }}>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {(data || []).map((m: any) => {
          const isMe = m.sender?.id === user?.id;
          return (
            <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              {!isMe && (
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold me-2 flex-shrink-0 ${ROLE_COLORS[m.sender?.role] || 'bg-slate-400'}`}>
                  {m.sender?.name?.[0]}
                </div>
              )}
              <div className={`max-w-xs rounded-xl px-3 py-2 ${isMe ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                {!isMe && <p className="text-xs font-medium mb-1 text-slate-500">{m.sender?.name}</p>}
                <p className="text-sm">{m.content}</p>
                <p className={`text-xs mt-1 ${isMe ? 'text-blue-200' : 'text-slate-400'}`}>{new Date(m.createdAt).toLocaleTimeString()}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="border-t p-3 flex gap-2">
        <input value={content} onChange={e => setContent(e.target.value)} placeholder={t('messages.placeholder')}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && content.trim() && send.mutate()}
          className="flex-1 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
        <button onClick={() => content.trim() && send.mutate()} disabled={!content.trim() || send.isPending}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
          {t('messages.send')}
        </button>
      </div>
    </div>
  );
}
