import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import axios from 'axios';
import toast from 'react-hot-toast';

export default function Login() {
  const { t } = useTranslation();
  const { serverUrl, login } = useAuthStore();
  const [email, setEmail] = useState('tech1@wfm.local');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      const res = await axios.post(serverUrl + '/api/auth/login', { email, password });
      const { token, user } = res.data.data;
      if (user.role !== 'TECHNICIAN') { toast.error('This app is for Technicians only'); return; }
      login(user, token);
      navigate('/queue');
    } catch { toast.error(t('auth.invalidCredentials')); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-900 to-orange-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-orange-600 rounded-full flex items-center justify-center mx-auto mb-3">
            <span className="text-white text-2xl font-bold">T</span>
          </div>
          <h1 className="text-xl font-bold">{t('auth.appName')}</h1>
          <p className="text-slate-500 text-sm mt-1">Technician Portal</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t('auth.email')}</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('auth.password')}</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-orange-600 text-white py-2 rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50">
            {loading ? t('common.loading') : t('auth.login')}
          </button>
        </form>
        <button onClick={() => navigate('/setup')} className="w-full text-center text-slate-400 text-xs mt-4 hover:text-slate-600">
          {t('auth.serverSetup')}
        </button>
      </div>
    </div>
  );
}
