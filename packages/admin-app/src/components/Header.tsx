import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useSocket } from '../hooks/useSocket';
import { useEffect } from 'react';

export default function Header({ title }: { title?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showNotifs, setShowNotifs] = useState(false);
  const socket = useSocket();

  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get('/notifications').then(r => r.data.data) });
  const unread = (data || []).filter((n: any) => !n.isRead).length;

  const markAll = useMutation({ mutationFn: () => api.patch('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });

  useEffect(() => {
    if (!socket) return;
    socket.on('notification:new', () => qc.invalidateQueries({ queryKey: ['notifications'] }));
    return () => { socket.off('notification:new'); };
  }, [socket, qc]);

  return (
    <div className="h-12 bg-white border-b flex items-center justify-between px-4 relative">
      <h2 className="font-semibold text-slate-700">{title}</h2>
      <div className="relative">
        <button onClick={() => setShowNotifs(v => !v)} className="relative p-1.5 hover:bg-slate-100 rounded-lg">
          <span className="text-lg">🔔</span>
          {unread > 0 && <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">{unread}</span>}
        </button>
        {showNotifs && (
          <div className="absolute end-0 top-full mt-1 w-80 bg-white rounded-xl shadow-xl border z-50 fade-in">
            <div className="flex items-center justify-between p-3 border-b">
              <span className="font-medium text-sm">{t('notifications.title')}</span>
              <button onClick={() => markAll.mutate()} className="text-xs text-blue-600 hover:underline">{t('notifications.markAllRead')}</button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {(!data || data.length === 0) ? (
                <p className="text-center text-slate-400 text-sm py-6">{t('notifications.noNotifications')}</p>
              ) : data.slice(0, 20).map((n: any) => (
                <div key={n.id} className={`p-3 border-b last:border-0 text-sm ${n.isRead ? 'text-slate-500' : 'text-slate-800 font-medium bg-blue-50'}`}>
                  <p>{n.title}</p>
                  <p className="text-xs mt-0.5 text-slate-400">{n.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
