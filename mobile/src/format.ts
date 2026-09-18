// Разбор строки инбокса (scheduled_messages) в вид для показа — те же поля/форматы,
// что и в кабинете на сайте: заголовок = «Этап — Подэтап», тело = текст сообщения.
export type Msg = {
  message_id?: string;
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
function when(m: Msg): string {
  return String(m.delivered_at || m.send_at || "");
}

// Локальная дата YYYY-MM-DD (для сравнения с датой сообщения).
export function ymd(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Дата сообщения как YYYY-MM-DD (обрезаем время; терпим и 'T', и пробел).
export function dayOf(m: Msg): string {
  return when(m).replace(" ", "T").slice(0, 10);
}

// Время HH:MM для пузыря.
export function hhmm(m: Msg): string {
  const s = when(m).replace(" ", "T");
  const t = s.slice(11, 16);
  return t || "";
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
