// Тема сайта до загрузки React: сохранённый выбор или системная настройка.
(function () {
  try {
    var saved = localStorage.getItem('nm_theme');
    var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  } catch (e) { /* без localStorage — светлая тема */ }
})();
