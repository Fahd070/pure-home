import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';

const links = [
  { to: '/dashboard', label: 'nav.dashboard', icon: '⊞' },
  { to: '/customers', label: 'nav.customers', icon: '👥' },
  { to: '/appointments', label: 'nav.appointments', icon: '📅' },
  { to: '/tasks', label: 'nav.tasks', icon: '✓' },
  { to: '/technicians', label: 'nav.technicians', icon: '🔧' },
  { to: '/messages', label: 'nav.messages', icon: '💬' },
];

export default function Sidebar() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  return (
    <aside className="w-56 bg-blue-800 text-white flex flex-col h-full">
      <div className="p-4 border-b border-blue-700">
        <p className="font-bold text-sm truncate">{user?.name}</p>
        <p className="text-blue-300 text-xs">{t('auth.appName')}</p>
      </div>
      <nav className="flex-1 py-2">
        {links.map(l => (
          <NavLink key={l.to} to={l.to}
            className={({ isActive }) => `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${isActive ? 'bg-blue-600 font-medium' : 'hover:bg-blue-700'}`}>
            <span>{l.icon}</span>
            <span>{t(l.label)}</span>
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-blue-700 space-y-1">
        <button onClick={() => i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar')}
          className="w-full text-xs py-1.5 px-3 rounded bg-blue-700 hover:bg-blue-600">
          {i18n.language === 'ar' ? 'English' : 'عربي'}
        </button>
        <button onClick={() => { logout(); navigate('/login'); }}
          className="w-full text-xs py-1.5 px-3 rounded bg-red-700 hover:bg-red-600">
          {t('auth.logout')}
        </button>
      </div>
    </aside>
  );
}
