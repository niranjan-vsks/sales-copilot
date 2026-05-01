import React from "react";
import "@/App.css";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";

import LoginPage         from "@/pages/LoginPage";
import DashboardPage     from "@/pages/DashboardPage";
import ChatPage          from "@/pages/ChatPage";
import ActivitiesPage    from "@/pages/ActivitiesPage";
import ConnectionsPage   from "@/pages/admin/ConnectionsPage";
import TeamPage          from "@/pages/admin/TeamPage";
import MonitoringPage    from "@/pages/admin/MonitoringPage";
import FileManagementPage from "@/pages/admin/FileManagementPage";

import AuthGuard         from "@/components/AuthGuard";
import SidebarLayout     from "@/layouts/SidebarLayout";

function AppRouter() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />

      {/* All authenticated routes — SidebarLayout */}
      <Route
        element={
          <AuthGuard>
            <SidebarLayout />
          </AuthGuard>
        }
      >
        <Route path="/dashboard"  element={<DashboardPage />} />
        <Route path="/chat"       element={<ChatPage />} />
        <Route path="/activities" element={<ActivitiesPage />} />
        <Route path="/excel"      element={<Navigate to="/admin/file-management" replace />} />
      </Route>

      {/* Admin-only routes */}
      <Route
        element={
          <AuthGuard requireAdmin>
            <SidebarLayout />
          </AuthGuard>
        }
      >
        <Route path="/admin/connections"      element={<ConnectionsPage />} />
        <Route path="/admin/team"             element={<TeamPage />} />
        <Route path="/admin/monitoring"       element={<MonitoringPage />} />
        <Route path="/admin/file-management"  element={<FileManagementPage />} />
      </Route>

      {/* Default redirects */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/login"     replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <div className="App dark">
      <Toaster data-testid="global-toaster" richColors position="top-center" />
      <HashRouter>
        <AppRouter />
      </HashRouter>
    </div>
  );
}
