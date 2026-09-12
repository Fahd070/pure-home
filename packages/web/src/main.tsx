// electronShim MUST be the very first import — it sets window.electron
// before any component code runs so that AppTitleBar / UpdateBanner / Reports
// see the stub instead of undefined.
import './electronShim';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';

// Shared sources from the Electron app — no copy, single source of truth.
import '../../unified-app/src/i18n';
import '../../unified-app/src/styles/globals.css';
import './web.css';
import App from '../../unified-app/src/App';
// The one QueryClient, shared with session teardown -- see unified-app/src/queryClient.ts.
import { queryClient } from '../../unified-app/src/queryClient';



ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="top-center" toastOptions={{ duration: 3000 }} />
    </QueryClientProvider>
  </React.StrictMode>
);
