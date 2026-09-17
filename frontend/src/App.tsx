import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { initActivityLogging } from './lib/activity';
import Login from './pages/Login';
import Register from './pages/Register';
import Setup from './pages/Setup';
import Employee from './pages/Employee';
import Admin from './pages/Admin';
import Logs from './pages/Logs';
import PlansDb from './pages/PlansDb';
import QueueTest from './pages/QueueTest';
import S3Browser from './pages/S3Browser';
import DocumentsTable from './pages/DocumentsTable';
import DocumentsBoard from './pages/DocumentsBoard';
import DocBreakdown from './pages/DocBreakdown';
import NotifyTest from './pages/NotifyTest';

export default function App() {
  useEffect(() => { initActivityLogging(); }, []);
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/" element={<Employee />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/logs" element={<Logs />} />
      <Route path="/plans-db" element={<PlansDb />} />
      <Route path="/queue-test" element={<QueueTest />} />
      <Route path="/s3" element={<S3Browser />} />
      <Route path="/documents-table" element={<DocumentsTable />} />
      <Route path="/documents-board" element={<DocumentsBoard />} />
      <Route path="/doc-breakdown" element={<DocBreakdown />} />
      <Route path="/notify-test" element={<NotifyTest />} />
      <Route path="*" element={<div className="app-page"><div className="empty-hint">Страница не найдена.</div></div>} />
    </Routes>
  );
}
