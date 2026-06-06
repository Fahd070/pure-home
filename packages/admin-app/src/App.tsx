import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import ServerSetup from './pages/ServerSetup';
import Login from './pages/Login';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Customers from './pages/Customers';
import AddCustomer from './pages/AddCustomer';
import CustomerDetail from './pages/CustomerDetail';
import Appointments from './pages/Appointments';
import Tasks from './pages/Tasks';
import Technicians from './pages/Technicians';
import Messages from './pages/Messages';

function Protected({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  if (user?.role !== 'ADMIN') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/setup" element={<ServerSetup />} />
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Protected><Layout /></Protected>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="customers" element={<Customers />} />
          <Route path="customers/add" element={<AddCustomer />} />
          <Route path="customers/:id" element={<CustomerDetail />} />
          <Route path="appointments" element={<Appointments />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="technicians" element={<Technicians />} />
          <Route path="messages" element={<Messages />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </HashRouter>
  );
}
