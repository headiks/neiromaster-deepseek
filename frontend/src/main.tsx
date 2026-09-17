import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
// Порядок как в исходном admin.html: базовые структурные стили, затем app.css
// (визуальная система Industry с !important) перекрывает их.
import './styles/admin.css';
import './styles/app.css';
import './styles/pages.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
