import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useSocket } from '../hooks/useSocket';
import { useEffect } from 'react';

const STATUS_COLORS: Record<string, string> = { APPROVED: 'bg-blue-100 text-blue-700', IN_PROGRESS: 'bg-orange-100 text-orange-700', PENDING_APPROVAL: 'bg-yellow-100 text-yellow-700' };

export default function WorkQueue() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const socket = useSocket();

  const { data, isLoading } = useQuery({ queryKey: ['tasks'], queryFn: () => api.get('/tasks').then(r => r.data.data) });

  useEffect(() => {
    if (!socket) return;
    socket.on('task:approved', () => qc.invalidateQueries({ queryKey: ['tasks'] }));
    return () => { socket.off('task:approved'); };
  }, [socket, qc]);

  const active = (data || []).filter((t: any) => ['APPROVED','IN_PROGRESS'].includes(t.status));

  if (isLoading) return <p className="text-center py-12">{t('common.loading')}</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t('nav.workQueue')} ({active.length})</h2>
      {active.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center text-slate-400">
          <p className="text-4xl mb-3">✓</p>
          <p>{t('common.all')} {t('tasks.completed')}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {active.map((task: any) => {
            const appt = task.appointment;
            const customer = appt?.customer;
            const addr = customer?.address;
            return (
              <div key={task.id} className="bg-white rounded-xl shadow-sm p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/queue/${task.id}`)}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="font-bold text-base">{customer?.name}</p>
                    <p className="text-slate-500 text-sm">{customer?.phone}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[task.status] || ''}`}>{task.status.replace('_',' ')}</span>
                </div>
                {addr && (
                  <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
                    <p><span className="text-slate-400">{t('customers.city')}: </span>{addr.city}</p>
                    <p><span className="text-slate-400">{t('customers.district')}: </span>{addr.district}</p>
                    <p><span className="text-slate-400">{t('customers.street')}: </span>{addr.street}</p>
                    {addr.buildingNo && <p><span className="text-slate-400">{t('customers.buildingNo')}: </span>{addr.buildingNo}</p>}
                  </div>
                )}
                <div className="mt-3 flex justify-between text-xs text-slate-400">
                  <span>{appt?.type === 'INSTALLATION' ? t('appointments.installation') : t('appointments.maintenance')}</span>
                  <span>{new Date(appt?.scheduledDate).toLocaleDateString()}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
