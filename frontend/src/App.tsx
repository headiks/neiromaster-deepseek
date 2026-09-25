// Маршруты сайта. Доступ проверяет и сервер (api_pages.py), и клиент: без входа — на /login,
// с временным паролем — на /setup, админские разделы — только администраторам.
import { useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from './lib/theme';
import { MeProvider, useMe } from './lib/me';
import { ToastProvider } from './lib/toast';
import { InboxProvider } from './lib/inbox';
import { CabinetProvider } from './lib/cabinet';
import { installActivityLog } from './lib/activity';
import { ConfirmProvider } from './ui/confirm';
import { Spinner } from './ui';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { AppShell } from './blocks/AppShell';
import { TourHost } from './tour';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import Setup from './pages/auth/Setup';
import Cabinet from './pages/cabinet/Cabinet';
import AndroidApp from './pages/cabinet/AndroidApp';
// Все страницы — в основной сборке: переход между разделами ничего не догружает из сети,
// поэтому не может сорваться из-за связи, выкатки новой версии или кэша по дороге.
import Users from './pages/admin/Users';
import Plans from './pages/admin/Plans';
import Documents from './pages/admin/Documents';
import Messages from './pages/admin/Messages';
import Questions from './pages/admin/Questions';
import Logs from './pages/service/Logs';
import PlansDb from './pages/service/PlansDb';
import NotifyTest from './pages/service/NotifyTest';
import QueueTest from './pages/service/QueueTest';
import S3Browser from './pages/service/S3Browser';
import DocumentsTable from './pages/service/DocumentsTable';
import DocumentsBoard from './pages/service/DocumentsBoard';
import DocBreakdown from './pages/service/DocBreakdown';
import GlobalTest from './pages/service/GlobalTest';
import MessageTest from './pages/service/MessageTest';


function Loading() {
  return <div className="nm-auth"><Spinner /></div>;
}

/** Вошёл и задал свой пароль: общий слой для кабинета и админки (входящие, тур). */
function Protected() {
  const { me, loading } = useMe();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  if (me.must_change_credentials) return <Navigate to="/setup" replace />;
  return (
    <InboxProvider enabled>
      <Outlet />
      <TourHost />
    </InboxProvider>
  );
}

/** Разделы администратора: один сайдбар на все страницы. */
function AdminLayout() {
  const { isAdmin } = useMe();
  const { pathname } = useLocation();
  if (!isAdmin) return <Navigate to="/" replace />;
  return (
    <AppShell>
      <ErrorBoundary key={pathname} where="admin-page"><Outlet /></ErrorBoundary>
    </AppShell>
  );
}

function Titles() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);
  return null;
}

export default function App() {
  useEffect(() => { installActivityLog(); }, []);
  return (
    <BrowserRouter>
      <ErrorBoundary where="app">
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
            <MeProvider>
              <Titles />
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/setup" element={<Setup />} />
                <Route path="/app" element={<ErrorBoundary where="app-download"><AndroidApp /></ErrorBoundary>} />
                <Route element={<Protected />}>
                  <Route path="/" element={<ErrorBoundary where="cabinet"><CabinetProvider><Cabinet /></CabinetProvider></ErrorBoundary>} />
                  <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
                  <Route element={<AdminLayout />}>
                    <Route path="/admin/users" element={<Users />} />
                    <Route path="/admin/plans" element={<Plans />} />
                    <Route path="/admin/documents" element={<Documents />} />
                    <Route path="/admin/messages" element={<Messages />} />
                    <Route path="/admin/questions" element={<Questions />} />
                    <Route path="/logs" element={<Logs />} />
                    <Route path="/plans-db" element={<PlansDb />} />
                    <Route path="/notify-test" element={<NotifyTest />} />
                    <Route path="/queue-test" element={<QueueTest />} />
                    <Route path="/s3" element={<S3Browser />} />
                    <Route path="/documents-table" element={<DocumentsTable />} />
                    <Route path="/documents-board" element={<DocumentsBoard />} />
                    <Route path="/doc-breakdown" element={<DocBreakdown />} />
                    <Route path="/globaltest" element={<GlobalTest />} />
                    <Route path="/message-test" element={<MessageTest />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </MeProvider>
          </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
