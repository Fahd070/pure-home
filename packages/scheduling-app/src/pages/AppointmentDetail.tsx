import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import toast from 'react-hot-toast';

export default function AppointmentDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['appointment', id], queryFn: () => api.get(`/appointments/${id}`).then(r => r.data.data) });

  const changeStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/appointments/${id}/status`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['appointment', id] }); qc.invalidateQueries({ queryKey: ['appointments'] }); toast.success(t('common.success')); }
  });

  if (isLoading) return <p className="text-center py-12">{t('common.loading')}</p>;
  if (!data) return <p className="text-center py-12">{t('common.error')}</p>;

  const a = data;
  return (
    <div className="max-w-lg mx-auto space-y-4">
      <button onClick={() => navigate(-1)} className="text-slate-500 hover:text-slate-700">← {t('common.back')}</button>
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-3">
        <h2 className="text-lg font-bold">{a.customer?.name}</h2>
        <p className="text-slate-500 text-sm">{a.customer?.phone}</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-slate-400">{t('common.date')}: </span>{new Date(a.scheduledDate).toLocaleString()}</div>
          <div><span className="text-slate-400">{t('appointments.type')}: </span>{a.type}</div>
          <div><span className="text-slate-400">{t('common.status')}: </span>{a.status}</div>
          <div><span className="text-slate-400">{t('appointments.technician')}: </span>{a.task?.technician?.name || '—'}</div>
        </div>
        {a.notes && <p className="text-sm text-slate-500 border-t pt-2">{a.notes}</p>}
        <div className="border-t pt-3">
          <p className="text-sm font-medium mb-2">{t('common.status')}</p>
          <div className="flex gap-2 flex-wrap">
            {['SCHEDULED','RESCHEDULED','CANCELLED','PENDING'].map(s => (
              <button key={s} disabled={a.status === s || changeStatus.isPending}
                onClick={() => changeStatus.mutate(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${a.status === s ? 'bg-green-600 text-white border-green-600' : 'hover:bg-slate-50'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
