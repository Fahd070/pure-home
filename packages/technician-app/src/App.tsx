import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import ServerSetup from './pages/ServerSetup';
import Login from './pages/Login';
import Layout from './components/Layout';
import WorkQueue from './pages/WorkQueue';
import TaskDetail from './pages/TaskDetail';
import Messages from './pages/Messages';

function Protected({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  if (user?.role !== 'TECHNICIAN') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/setup" element={<ServerSetup />} />
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Protected><Layout /></Protected>}>
          <Route index element={<Navigate to="/queue" replace />} />
          <Route path="queue" element={<WorkQueue />} />
          <Route path="queue/:id" element={<TaskDetail />} />
          <Route path="messages" element={<Messages />} />
        </Route>
        <Route path="*" element={<Navigate to="/queue" replace />} />
      </Routes>
    </HashRouter>
  );
}
