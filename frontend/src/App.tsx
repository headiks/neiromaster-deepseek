// Маршруты сайта. Доступ проверяет и сервер (api_pages.py), и клиент: без входа — на /login,
// с временным паролем — на /setup, админские разделы — только администраторам.
import { Suspense, useEffect } from 'react';
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
import { lazyPage, preloadWhenIdle } from './lib/lazyPage';
import { AppShell } from './blocks/AppShell';
import { TourHost } from './tour';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import Setup from './pages/auth/Setup';
import Cabinet from './pages/cabinet/Cabinet';

const Users = lazyPage(() => import('./pages/admin/Users'));
const Plans = lazyPage(() => import('./pages/admin/Plans'));
const Documents = lazyPage(() => import('./pages/admin/Documents'));
const Messages = lazyPage(() => import('./pages/admin/Messages'));
const Questions = lazyPage(() => import('./pages/admin/Questions'));
const Logs = lazyPage(() => import('./pages/service/Logs'));
const PlansDb = lazyPage(() => import('./pages/service/PlansDb'));
const NotifyTest = lazyPage(() => import('./pages/service/NotifyTest'));
const QueueTest = lazyPage(() => import('./pages/service/QueueTest'));
const S3Browser = lazyPage(() => import('./pages/service/S3Browser'));
const DocumentsTable = lazyPage(() => import('./pages/service/DocumentsTable'));
const DocumentsBoard = lazyPage(() => import('./pages/service/DocumentsBoard'));
const DocBreakdown = lazyPage(() => import('./pages/service/DocBreakdown'));
const GlobalTest = lazyPage(() => import('./pages/service/GlobalTest'));
const MessageTest = lazyPage(() => import('./pages/service/MessageTest'));
// Сначала — основные разделы, потом служебные.
const ADMIN_PAGES = [Users, Plans, Documents, Messages, Questions, Logs, PlansDb, NotifyTest, QueueTest,
  S3Browser, DocumentsTable, DocumentsBoard, DocBreakdown, GlobalTest, MessageTest];

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
  const { pathname } = useLocation();
  // Разделы подгружаются заранее, в простое: переход по меню не ждёт сеть.
  useEffect(() => { if (isAdmin) preloadWhenIdle(ADMIN_PAGES); }, [isAdmin]);
  if (!isAdmin) return <Navigate to="/" replace />;
  return (
    <AppShell>
      <ErrorBoundary key={pathname}>
        <Suspense fallback={<Spinner />}><Outlet /></Suspense>
      </ErrorBoundary>
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
      <ErrorBoundary>
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
      </ErrorBoundary>
    </BrowserRouter>
  );
}
