// Тема сайта: светлая/тёмная. Выбор хранится в браузере (nm_theme), по умолчанию —
// как в системе. Атрибут <html data-theme="dark"> ставит ещё theme-init.js до React.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Mode = 'light' | 'dark';
type Ctx = { mode: Mode; dark: boolean; setMode: (m: Mode) => void; toggle: () => void };

const ThemeCtx = createContext<Ctx>({ mode: 'light', dark: false, setMode: () => {}, toggle: () => {} });

function initial(): Mode {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(initial);
  useEffect(() => {
    if (mode === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  }, [mode]);
  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    try { localStorage.setItem('nm_theme', m); } catch { /* приватный режим */ }
  }, []);
  const toggle = useCallback(() => setMode(mode === 'dark' ? 'light' : 'dark'), [mode, setMode]);
  return <ThemeCtx.Provider value={{ mode, dark: mode === 'dark', setMode, toggle }}>{children}</ThemeCtx.Provider>;
}

export const useThemeMode = () => useContext(ThemeCtx);
