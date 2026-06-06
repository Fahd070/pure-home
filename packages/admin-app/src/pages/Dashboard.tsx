import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useSocket } from '../hooks/useSocket';
import { useEffect } from 'react';

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`bg-white rounded-xl p-4 border-s-4 shadow-sm ${color}`}>
      <p className="text-2xl font-bold">{value ?? '—'}</p>
      <p className="text-slate-500 text-sm mt-1">{label}</p>
    </div>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const socket = useSocket();
  const { data: stats } = useQuery({ queryKey: ['dashboard-stats'], queryFn: () => api.get('/dashboard/stats').then(r => r.data.data) });
  const { data: activity } = useQuery({ queryKey: ['dashboard-activity'], queryFn: () => api.get('/dashboard/activity').then(r => r.data.data) });

  useEffect(() => {
    if (!socket) return;
    const refresh = () => { qc.invalidateQueries({ queryKey: ['dashboard-stats'] }); qc.invalidateQueries({ queryKey: ['dashboard-activity'] }); };
    socket.on('task:completed', refresh); socket.on('appointment:created', refresh); socket.on('customer:created', refresh);
    return () => { socket.off('task:completed', refresh); socket.off('appointment:created', refresh); socket.off('customer:created', refresh); };
  }, [socket, qc]);

  const statusColor: Record<string, string> = { COMPLETED: 'text-green-600 bg-green-50', IN_PROGRESS: 'text-blue-600 bg-blue-50', POSTPONED: 'text-orange-600 bg-orange-50', PENDING_APPROVAL: 'text-yellow-600 bg-yellow-50', APPROVED: 'text-purple-600 bg-purple-50', NO_TASK: 'text-slate-400 bg-slate-50' };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label={t('dashboard.totalTasks')} value={stats?.total} color="border-blue-500" />
        <StatCard label={t('dashboard.completedTasks')} value={stats?.completed} color="border-green-500" />
        <StatCard label={t('dashboard.thisMonth')} value={stats?.thisMonth} color="border-indigo-500" />
        <StatCard label={t('dashboard.nextMonth')} value={stats?.nextMonth} color="border-purple-500" />
        <StatCard label={t('dashboard.pendingTasks')} value={stats?.pending} color="border-yellow-500" />
        <StatCard label={t('dashboard.activeCustomers')} value={stats?.activeCustomers} color="border-teal-500" />
        <StatCard label={t('dashboard.pendingApproval')} value={stats?.pendingApproval} color="border-red-500" />
      </div>
      <div className="bg-white rounded-xl shadow-sm p-4">
        <h3 className="font-semibold mb-3">{t('dashboard.recentActivity')}</h3>
        <div className="space-y-2">
          {(activity || []).map((a: any) => (
            <div key={a.customerId} className="flex items-center justify-between py-2 border-b last:border-0">
              <div>
                <p className="font-medium text-sm">{a.customerName}</p>
                <p className="text-xs text-slate-400">{a.phone}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColor[a.status] || ''}`}>{a.status.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
