import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

export default function CustomerList() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['customers', search],
    queryFn: () => api.get('/customers', { params: { search, limit: 50 } }).then(r => r.data)
  });

  return (
    <div className="space-y-4">
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('common.search')}
        className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? <p className="text-center py-8 text-slate-400">{t('common.loading')}</p> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-start px-4 py-3">{t('common.name')}</th>
                <th className="text-start px-4 py-3">{t('common.phone')}</th>
                <th className="text-start px-4 py-3">{t('customers.maintenanceCycle')}</th>
                <th className="text-start px-4 py-3">{t('customers.city')}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.data || []).map((c: any) => (
                <tr key={c.id} className="border-b hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3">{c.phone}</td>
                  <td className="px-4 py-3">{c.maintenanceCycle}</td>
                  <td className="px-4 py-3">{c.address?.city || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
