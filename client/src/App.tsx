import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import DashboardPage from './pages/DashboardPage';
import CertificatesPage from './pages/CertificatesPage';
import ScanningPage from './pages/ScanningPage';
import CreatePage from './pages/CreatePage';
import NotificationsPage from './pages/NotificationsPage';
import SettingsPage from './pages/SettingsPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';

function Guard({ children }: any) {
  const t = localStorage.getItem('certrecord_token');
  if (!t) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/" element={<Guard><Layout /></Guard>}>
          <Route index element={<DashboardPage />} />
          <Route path="certificates" element={<CertificatesPage />} />
          <Route path="scanning" element={<ScanningPage />} />
          <Route path="create" element={<CreatePage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
