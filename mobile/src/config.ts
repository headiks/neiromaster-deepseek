// Базовый URL API. По умолчанию — прод. Переопределяется переменной окружения
// EXPO_PUBLIC_API_BASE (сборка/дев), напр. http://192.168.0.10:8000 для локального бэка.
export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE?.replace(/\/$/, "") ||
  "https://neiromaster.duckdns.org";
