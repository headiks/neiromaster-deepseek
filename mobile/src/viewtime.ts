// Сколько сообщение плана было на экране — для статистики вовлечённости (backend/stats.py),
// как на сайте (frontend/src/lib/viewtime.ts). Раз в секунду, пока приложение активно,
// карточка меряется на экране: видна на 60 % или занимает полэкрана — секунда засчитана.
// На сервер копленое уходит раз в 15 с и при сворачивании приложения.
import { useEffect, useRef } from "react";
import { AppState, Dimensions, View } from "react-native";
import { api } from "./api";

const pending = new Map<string, number>();

function flush() {
  pending.forEach((ms, id) => { if (ms >= 500) api.view(id, ms).catch(() => {}); });
  pending.clear();
}

setInterval(flush, 15000);
AppState.addEventListener("change", (s) => { if (s !== "active") flush(); });

export function useViewTime(id: string) {
  const ref = useRef<View>(null);
  useEffect(() => {
    const t = setInterval(() => {
      if (AppState.currentState !== "active" || !ref.current) return;
      ref.current.measureInWindow((_x, y, w, h) => {
        if (!w || !h) return;                                  // вкладка не на экране
        const screen = Dimensions.get("window").height;
        const seen = Math.max(0, Math.min(y + h, screen) - Math.max(y, 0));
        if (seen >= h * 0.6 || seen >= screen * 0.5) pending.set(id, (pending.get(id) || 0) + 1000);
      });
    }, 1000);
    return () => clearInterval(t);
  }, [id]);
  return ref;
}
