import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['customer', id], queryFn: () => api.get(`/customers/${id}`).then(r => r.data.data) });

  if (isLoading) return <p className="text-center py-12">{t('common.loading')}</p>;
  if (!data) return <p className="text-center py-12">{t('common.error')}</p>;

  const c = data;
  const addr = c.address;
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <button onClick={() => navigate(-1)} className="text-slate-500 hover:text-slate-700">← {t('common.back')}</button>
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold">{c.name}</h2>
            <p className="text-slate-500">{c.phone}</p>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
            {c.isActive ? t('common.active') : t('common.inactive')}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-slate-400">{t('customers.maintenanceCycle')}: </span>{c.maintenanceCycle}</div>
          <div><span className="text-slate-400">{t('customers.frequency')}: </span>{c.maintenanceFrequency}</div>
        </div>
        {addr && (
          <div className="mt-4 p-3 bg-slate-50 rounded-lg text-sm">
            <p className="font-medium mb-1">{t('customers.address')}</p>
            <p>{addr.city}، {addr.district}، {addr.street}</p>
            {addr.buildingNo && <p>{t('customers.buildingNo')}: {addr.buildingNo} {addr.floorNo && `| ${t('customers.floorNo')}: ${addr.floorNo}`}</p>}
          </div>
        )}
        {c.notes && <p className="mt-3 text-sm text-slate-500">{c.notes}</p>}
      </div>
      {c.appointments?.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h3 className="font-semibold mb-3">{t('nav.appointments')}</h3>
          <div className="space-y-2">
            {c.appointments.map((a: any) => (
              <div key={a.id} className="flex justify-between text-sm py-2 border-b last:border-0">
                <span>{new Date(a.scheduledDate).toLocaleDateString()} — {a.type}</span>
                <span className="text-slate-500">{a.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
