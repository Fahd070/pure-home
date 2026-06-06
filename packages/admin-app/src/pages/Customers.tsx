import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import toast from 'react-hot-toast';

export default function Customers() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', search, page],
    queryFn: () => api.get('/customers', { params: { search, page, limit: 20 } }).then(r => r.data)
  });

  const toggle = useMutation({
    mutationFn: (id: string) => api.patch(`/customers/${id}/toggle-active`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); toast.success(t('common.success')); }
  });

  const cycleLabel: Record<string, string> = { DAILY: t('customers.daily'), WEEKLY: t('customers.weekly'), MONTHLY: t('customers.monthly') };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder={t('common.search')}
          className="border rounded-lg px-3 py-2 flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={() => navigate('/customers/add')} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium">
          + {t('customers.add')}
        </button>
      </div>
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? <p className="text-center py-8 text-slate-400">{t('common.loading')}</p> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-start px-4 py-3">{t('common.name')}</th>
                <th className="text-start px-4 py-3">{t('common.phone')}</th>
                <th className="text-start px-4 py-3">{t('customers.maintenanceCycle')}</th>
                <th className="text-start px-4 py-3">{t('common.status')}</th>
                <th className="text-start px-4 py-3">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.data || []).map((c: any) => (
                <tr key={c.id} className="border-b hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium cursor-pointer text-blue-600 hover:underline" onClick={() => navigate(`/customers/${c.id}`)}>{c.name}</td>
                  <td className="px-4 py-3">{c.phone}</td>
                  <td className="px-4 py-3">{cycleLabel[c.maintenanceCycle] || c.maintenanceCycle}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {c.isActive ? t('common.active') : t('common.inactive')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggle.mutate(c.id)} className="text-xs text-slate-500 hover:text-slate-700">{t('customers.toggleActive')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data?.meta && (
        <div className="flex justify-center gap-2">
          <button disabled={page === 1} onClick={() => setPage(p => p-1)} className="px-3 py-1 text-sm border rounded disabled:opacity-40">‹</button>
          <span className="px-3 py-1 text-sm">{page} / {Math.ceil(data.meta.total / 20) || 1}</span>
          <button disabled={page * 20 >= data.meta.total} onClick={() => setPage(p => p+1)} className="px-3 py-1 text-sm border rounded disabled:opacity-40">›</button>
        </div>
      )}
    </div>
  );
}
