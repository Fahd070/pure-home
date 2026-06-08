import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import TitleBar from './TitleBar';
import Sidebar from './Sidebar';
import Header from './Header';

const titles: Record<string, string> = {
  '/dashboard': 'nav.dashboard', '/customers': 'nav.customers',
  '/appointments': 'nav.appointments', '/tasks': 'nav.tasks',
  '/technicians': 'nav.technicians', '/messages': 'nav.messages',
};

export default function Layout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const key = Object.keys(titles).find(k => pathname.startsWith(k)) || '/dashboard';
  return (
    <div className="h-screen flex flex-col bg-slate-100">
      <TitleBar title="Pure Home — Admin" />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header title={t(titles[key])} />
          <main className="flex-1 overflow-y-auto p-4">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
