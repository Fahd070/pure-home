import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import toast from 'react-hot-toast';

export default function NewAppointment() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [form, setForm] = useState({ type: 'MAINTENANCE', scheduledDate: '', notes: '' });

  const { data: customers } = useQuery({
    queryKey: ['customers-search', customerSearch],
    queryFn: () => api.get('/customers', { params: { search: customerSearch, limit: 10 } }).then(r => r.data.data),
    enabled: customerSearch.length > 1
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCustomer) { toast.error('Select a customer'); return; }
    if (!form.scheduledDate) { toast.error('Select a date'); return; }
    setLoading(true);
    try {
      await api.post('/appointments', { customerId: selectedCustomer.id, type: form.type, scheduledDate: new Date(form.scheduledDate).toISOString(), notes: form.notes || undefined });
      toast.success(t('common.success'));
      navigate('/appointments');
    } catch (err: any) {
      toast.error(err.response?.data?.message || t('common.error'));
    } finally { setLoading(false); }
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(-1)} className="text-slate-500 hover:text-slate-700">← {t('common.back')}</button>
        <h2 className="text-lg font-semibold">{t('appointments.new')}</h2>
      </div>
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">{t('appointments.customer')} *</label>
          {selectedCustomer ? (
            <div className="flex items-center justify-between border rounded-lg px-3 py-2 bg-green-50">
              <span className="font-medium text-sm">{selectedCustomer.name} — {selectedCustomer.phone}</span>
              <button type="button" onClick={() => setSelectedCustomer(null)} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
            </div>
          ) : (
            <div className="relative">
              <input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} placeholder={t('common.search')}
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
              {customers && customers.length > 0 && (
                <div className="absolute top-full start-0 end-0 bg-white border rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                  {customers.map((c: any) => (
                    <div key={c.id} onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); }}
                      className="px-3 py-2 hover:bg-green-50 cursor-pointer text-sm border-b last:border-0">
                      <span className="font-medium">{c.name}</span> <span className="text-slate-400">{c.phone}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t('appointments.type')}</label>
          <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="MAINTENANCE">{t('appointments.maintenance')}</option>
            <option value="INSTALLATION">{t('appointments.installation')}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t('common.date')} *</label>
          <input type="datetime-local" value={form.scheduledDate} onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t('common.notes')}</label>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div className="flex gap-3">
          <button type="submit" disabled={loading} className="flex-1 bg-green-600 text-white py-2 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50">
            {loading ? t('common.loading') : t('common.save')}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="flex-1 border py-2 rounded-lg hover:bg-slate-50">{t('common.cancel')}</button>
        </div>
      </form>
    </div>
  );
}
