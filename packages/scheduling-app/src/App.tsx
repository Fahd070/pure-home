import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import ServerSetup from './pages/ServerSetup';
import Login from './pages/Login';
import Layout from './components/Layout';
import CustomerList from './pages/CustomerList';
import Appointments from './pages/Appointments';
import NewAppointment from './pages/NewAppointment';
import AppointmentDetail from './pages/AppointmentDetail';
import Messages from './pages/Messages';

function Protected({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  if (user?.role !== 'SCHEDULING') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/setup" element={<ServerSetup />} />
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Protected><Layout /></Protected>}>
          <Route index element={<Navigate to="/appointments" replace />} />
          <Route path="customers" element={<CustomerList />} />
          <Route path="appointments" element={<Appointments />} />
          <Route path="appointments/new" element={<NewAppointment />} />
          <Route path="appointments/:id" element={<AppointmentDetail />} />
          <Route path="messages" element={<Messages />} />
        </Route>
        <Route path="*" element={<Navigate to="/appointments" replace />} />
      </Routes>
    </HashRouter>
  );
}
