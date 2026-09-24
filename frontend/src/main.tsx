import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import './styles/glass.css';
import './styles/app.css';
import './tour/tour.css';
import App from './App';
import { installDomGuard } from './lib/domGuard';
import { installErrorReporting } from './lib/errors';

// До первой отрисовки: ошибки загрузки тоже попадут в журнал, расширения не уронят страницу.
installErrorReporting();
installDomGuard();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
