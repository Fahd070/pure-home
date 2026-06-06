import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

export default function Technicians() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({ queryKey: ['technicians-detail'], queryFn: () => api.get('/technicians').then(r => r.data.data) });

  if (isLoading) return <p className="text-center py-12">{t('common.loading')}</p>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {(data || []).map((tech: any) => (
        <div key={tech.id} className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-lg">
              {tech.name[0]}
            </div>
            <div>
              <p className="font-semibold">{tech.name}</p>
              <p className="text-xs text-slate-400">{tech.email}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="bg-green-50 rounded-lg p-3">
              <p className="text-xl font-bold text-green-700">{tech.completedTasks}</p>
              <p className="text-xs text-green-600">{t('technicians.completedTasks')}</p>
            </div>
            <div className="bg-yellow-50 rounded-lg p-3">
              <p className="text-xl font-bold text-yellow-700">{tech.pendingTasks}</p>
              <p className="text-xs text-yellow-600">{t('technicians.pendingTasks')}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
