// Разбор строки инбокса (scheduled_messages) в вид для показа — те же поля/форматы,
// что и в кабинете на сайте: заголовок = «Этап — Подэтап», тело = текст сообщения.
export type Msg = {
  id?: string;            // id строки инбокса (<сотрудник>:<сообщение>) — для «прочитано»/ответов
  message_id?: string;
  kind?: string;          // message | reminder | checklist | system_check | survey | quiz | handover
  payload?: any;          // структура под тип (msgconvert): пункты, вопросы, варианты
  answers?: Record<string, any>;
  title?: string;
  body?: string;
  send_at?: string;
  delivered_at?: string;
  read_at?: string;
  status?: string;
};

export function title(m: Msg): string {
  return String(m.title || "Сообщение плана");
}

export function body(m: Msg): string {
  return String(m.body || "");
}

// Момент попадания в инбокс (для чата важна дата доставки, а не план-время).
// Сервер отдаёт время в UTC с зоной — переводим в местное время телефона.
function whenDate(m: Msg): Date | null {
  const raw = String(m.delivered_at || m.send_at || "");
  if (!raw) return null;
  const d = new Date(raw.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

// Локальная дата YYYY-MM-DD (для сравнения с датой сообщения).
export function ymd(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Местная дата сообщения YYYY-MM-DD.
export function dayOf(m: Msg): string {
  const d = whenDate(m);
  return d ? ymd(d) : "";
}

// Местное время HH:MM для пузыря.
export function hhmm(m: Msg): string {
  const d = whenDate(m);
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Ключ сортировки по времени доставки.
export function ts(m: Msg): number {
  return whenDate(m)?.getTime() || 0;
}

// Человекочитаемая дата-заголовок группы в «Истории».
export function dayLabel(iso: string): string {
  const today = ymd();
  const yest = ymd(new Date(Date.now() - 86400000));
  if (iso === today) return "Сегодня";
  if (iso === yest) return "Вчера";
  const [y, mo, d] = iso.split("-");
  const months = ["янв", "фев", "мар", "апр", "мая", "июн",
                  "июл", "авг", "сен", "окт", "ноя", "дек"];
  const mi = Number(mo) - 1;
  return `${Number(d)} ${months[mi] || mo} ${y}`;
}
