// Тема сайта до загрузки React: сохранённый выбор или системная настройка.
(function () {
  try {
    var saved = localStorage.getItem('nm_theme');
    var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  } catch (e) { /* без localStorage — светлая тема */ }
})();

// Сайт не загрузился (файл сборки не пришёл: обрыв связи, выкатка новой версии, старая
// страница в кэше по дороге) — вместо белого экрана: один раз обновляем вкладку сами,
// если не помогло — сообщение с кнопкой. Этот файл грузится раньше сборки, поэтому видит её сбой.
(function () {
  var KEY = 'nm_boot_reload';
  var shown = false;

  function message() {
    var root = document.getElementById('root');
    if (shown || !root || root.childNodes.length) return;      // приложение всё-таки отрисовалось
    shown = true;
    var box = document.createElement('div');
    box.setAttribute('style', 'min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'gap:14px;padding:24px;text-align:center;font:15px/1.5 system-ui,sans-serif;color:#565d78');
    var text = document.createElement('p');
    text.style.margin = '0';
    text.textContent = 'Не удалось загрузить сайт. Проверьте связь и обновите страницу.';
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Обновить страницу';
    button.setAttribute('style', 'padding:10px 18px;border:0;border-radius:999px;background:#4c6fff;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer');
    button.onclick = function () { location.reload(); };
    box.appendChild(text);
    box.appendChild(button);
    root.appendChild(box);
  }

  function failed() {
    var again = false;
    try {
      var last = +sessionStorage.getItem(KEY) || 0;
      if (Date.now() - last > 30000) { sessionStorage.setItem(KEY, String(Date.now())); again = true; }
    } catch (e) { /* без sessionStorage — только сообщение */ }
    if (again) { location.reload(); return; }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', message);
    else message();
  }

  window.addEventListener('error', function (e) {
    var t = e.target;
    var url = t && (t.src || t.href) || '';
    if (t && (t.tagName === 'SCRIPT' || t.tagName === 'LINK') && url.indexOf('/static/app/assets/') !== -1) failed();
  }, true);

  // Страховка: страница загрузилась, а приложение так и не отрисовалось.
  window.addEventListener('load', function () {
    setTimeout(function () {
      var root = document.getElementById('root');
      if (root && !root.childNodes.length) failed();
    }, 20000);
  });
})();
