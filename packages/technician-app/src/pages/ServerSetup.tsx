import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import axios from 'axios';

export default function ServerSetup() {
  const { t } = useTranslation();
  const { serverUrl, setServerUrl } = useAuthStore();
  const [url, setUrl] = useState(serverUrl);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleConnect() {
    setTesting(true); setError('');
    try {
      await axios.get(url + '/api/auth/login', { timeout: 5000 }).catch(e => {
        if (e.response?.status === 404 || e.response?.status === 405) return;
        throw e;
      });
      setServerUrl(url);
      navigate('/login');
    } catch {
      setError('Cannot connect to server at ' + url);
    } finally { setTesting(false); }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-center mb-2">{t('auth.appName')}</h1>
        <p className="text-slate-500 text-center mb-6">{t('auth.serverSetup')}</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t('auth.serverUrl')}</label>
            <input
              value={url} onChange={e => setUrl(e.target.value)}
              placeholder="http://localhost:3001"
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button onClick={handleConnect} disabled={testing}
            className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
            {testing ? t('common.loading') : t('auth.connect')}
          </button>
          <button onClick={() => { setServerUrl(url); navigate('/login'); }}
            className="w-full text-slate-500 text-sm hover:text-slate-700">
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
