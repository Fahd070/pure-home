import React from "react";
import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAppStore } from "./store/appStore";
import AppTitleBar from "./components/AppTitleBar";
import UpdateBanner from "./components/UpdateBanner";
import ErrorBoundary from "./components/ErrorBoundary";

import DepartmentSelector from "./pages/DepartmentSelector";
import CodeEntry from "./pages/CodeEntry";
import ServerSetup from "./pages/ServerSetup";

import AdminLayout from "./admin/components/Layout";
import Dashboard from "./admin/pages/Dashboard";
import Customers from "./admin/pages/Customers";
import AddCustomer from "./admin/pages/AddCustomer";
import CustomerDetail from "./admin/pages/CustomerDetail";
import AdminAppointments from "./admin/pages/Appointments";
import AppointmentAcceptance from "./admin/pages/AppointmentAcceptance";
import Technicians from "./admin/pages/Technicians";
import AdminMessages from "./admin/pages/Messages";
import AdminNotifications from "./admin/pages/Notifications";
import AdminDirectMessages from "./admin/pages/DirectMessages";
import AdminReports from "./admin/pages/Reports";
import AdminUrgentAppointments from "./admin/pages/UrgentAppointments";
import AdminExpenses from "./admin/pages/Expenses";
import AccessCodes from "./admin/pages/AccessCodes";
import Employees from "./admin/pages/Employees";
import AdminSettings from "./admin/pages/Settings";
import AdminCallReports from "./admin/pages/CallReports";

import SchedulingLayout from "./scheduling/components/Layout";
import CustomerList from "./scheduling/pages/CustomerList";
import SchedDashboard from "./scheduling/pages/Dashboard";
import SchedAddCustomer from "./scheduling/pages/AddCustomer";
import SchedCallReports from "./scheduling/pages/CallReports";
import SchedMessages from "./scheduling/pages/Messages";
import SchedNotifications from "./scheduling/pages/Notifications";
import SchedDirectMessages from "./scheduling/pages/DirectMessages";
import SchedSettings from "./scheduling/pages/Settings";
import { api as schedulingApi } from "./scheduling/api/client";

import TechnicianLayout from "./technician/components/Layout";
import WorkQueue from "./technician/pages/WorkQueue";
import TaskDetail from "./technician/pages/TaskDetail";
import TechUrgentAppointments from "./technician/pages/UrgentAppointments";
import TechExpenses from "./technician/pages/Expenses";
import TechNotifications from "./technician/pages/Notifications";
import TechDirectMessages from "./technician/pages/DirectMessages";
import TechSettings from "./technician/pages/Settings";

/**
 * The three route guards.
 *
 * v4 Requirement #13: an unauthenticated visit to a protected route goes to the
 * DEPARTMENT SELECTOR, not to that department's code entry. These used to send
 * the user straight back to `/code-entry/<dept>`, which made logging out
 * indistinguishable from locking the department you were already in -- and made
 * the browser Back button reopen that same code-entry screen. Leaving the
 * workspace now always returns to the point where a department is chosen.
 *
 * This covers session expiry too: the API clients clear the stored auth on a
 * 401 (see each department's api/client.ts), so a token that dies mid-session
 * lands on the selector by the same path as an explicit logout.
 */
function AdminGuard({ children }: { children: React.ReactNode }) {
  const { adminAuth } = useAppStore();
  if (!adminAuth) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function SchedulingGuard({ children }: { children: React.ReactNode }) {
  const { schedulingAuth } = useAppStore();
  if (!schedulingAuth) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function TechnicianGuard({ children }: { children: React.ReactNode }) {
  const { technicianAuth } = useAppStore();
  if (!technicianAuth) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppShell() {
  return (
    <div className="h-screen flex flex-col">
      <AppTitleBar />
      <UpdateBanner />
      <div className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<DepartmentSelector />} />
          <Route path="/setup" element={<ServerSetup />} />
          <Route path="/code-entry/:dept" element={<CodeEntry />} />

          <Route path="/admin" element={<AdminGuard><AdminLayout /></AdminGuard>}>
            <Route index element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="customers" element={<Customers />} />
            <Route path="customers/add" element={<AddCustomer />} />
            <Route path="customers/:id/edit" element={<AddCustomer />} />
            <Route path="customers/:id" element={<CustomerDetail />} />
            <Route path="appointments" element={<AdminAppointments />} />
            <Route path="appointment-acceptance" element={<AppointmentAcceptance />} />
            <Route path="urgent-appointments" element={<AdminUrgentAppointments />} />
            <Route path="technicians" element={<Technicians />} />
            <Route path="expenses" element={<AdminExpenses />} />
            <Route path="messages" element={<AdminMessages />} />
            <Route path="notifications" element={<AdminNotifications />} />
            <Route path="messaging" element={<AdminDirectMessages />} />
            <Route path="reports" element={<AdminReports />} />
            <Route path="call-reports" element={<AdminCallReports />} />
            <Route path="employees" element={<Employees />} />
            <Route path="access-codes" element={<AccessCodes />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>

          <Route path="/scheduling" element={<SchedulingGuard><SchedulingLayout /></SchedulingGuard>}>
            <Route index element={<Navigate to="/scheduling/dashboard" replace />} />
            <Route path="dashboard" element={<SchedDashboard />} />
            <Route path="customers" element={<CustomerList />} />
            <Route path="customers/add" element={<SchedAddCustomer />} />
            <Route path="customers/:id/edit" element={<SchedAddCustomer />} />
            <Route path="customers/:id" element={<CustomerDetail apiClient={schedulingApi} queryScope="scheduling" />} />
            <Route path="call-reports" element={<SchedCallReports />} />
            <Route path="messages" element={<SchedMessages />} />
            <Route path="notifications" element={<SchedNotifications />} />
            <Route path="messaging" element={<SchedDirectMessages />} />
            <Route path="settings" element={<SchedSettings />} />
          </Route>

          <Route path="/technician" element={<TechnicianGuard><TechnicianLayout /></TechnicianGuard>}>
            <Route index element={<Navigate to="/technician/queue" replace />} />
            <Route path="queue" element={<WorkQueue />} />
            <Route path="queue/:id" element={<TaskDetail />} />
            <Route path="urgent-appointments" element={<TechUrgentAppointments />} />
            <Route path="expenses" element={<TechExpenses />} />
            <Route path="notifications" element={<TechNotifications />} />
            <Route path="messaging" element={<TechDirectMessages />} />
            <Route path="settings" element={<TechSettings />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <AppShell />
      </HashRouter>
    </ErrorBoundary>
  );
}
