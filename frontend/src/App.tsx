// Маршруты сайта. Доступ проверяет и сервер (api_pages.py), и клиент: без входа — на /login,
// с временным паролем — на /setup, админские разделы — только администраторам.
import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from './lib/theme';
import { MeProvider, useMe } from './lib/me';
import { ToastProvider } from './lib/toast';
import { InboxProvider } from './lib/inbox';
import { CabinetProvider } from './lib/cabinet';
import { installActivityLog } from './lib/activity';
import { ConfirmProvider } from './ui/confirm';
import { Spinner } from './ui';
import { AppShell } from './blocks/AppShell';
import { TourHost } from './tour';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import Setup from './pages/auth/Setup';
import Cabinet from './pages/cabinet/Cabinet';

const Users = lazy(() => import('./pages/admin/Users'));
const Plans = lazy(() => import('./pages/admin/Plans'));
const Documents = lazy(() => import('./pages/admin/Documents'));
const Messages = lazy(() => import('./pages/admin/Messages'));
const Questions = lazy(() => import('./pages/admin/Questions'));
const Logs = lazy(() => import('./pages/service/Logs'));
const PlansDb = lazy(() => import('./pages/service/PlansDb'));
const NotifyTest = lazy(() => import('./pages/service/NotifyTest'));
const QueueTest = lazy(() => import('./pages/service/QueueTest'));
const S3Browser = lazy(() => import('./pages/service/S3Browser'));
const DocumentsTable = lazy(() => import('./pages/service/DocumentsTable'));
const DocumentsBoard = lazy(() => import('./pages/service/DocumentsBoard'));
const DocBreakdown = lazy(() => import('./pages/service/DocBreakdown'));
const GlobalTest = lazy(() => import('./pages/service/GlobalTest'));
const MessageTest = lazy(() => import('./pages/service/MessageTest'));

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

/** Разделы администратора: один сайдбар на все страницы, страницы грузятся по требованию. */
function AdminLayout() {
  const { isAdmin } = useMe();
  if (!isAdmin) return <Navigate to="/" replace />;
  return <AppShell><Suspense fallback={<Spinner />}><Outlet /></Suspense></AppShell>;
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
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
            <MeProvider>
              <Titles />
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/setup" element={<Setup />} />
                <Route element={<Protected />}>
                  <Route path="/" element={<CabinetProvider><Cabinet /></CabinetProvider>} />
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
    </BrowserRouter>
  );
}
