// До первой отрисовки: язык и тема на <html>, чтобы не было вспышки чужой темы.
// Тема хранится JSON-строкой (useLocalStorage: '"notion"'); прежде её искали
// сырым значением, класс не ставился ни для одной темы, а светлая тема
// мигала тёмным фоном из index.html (R3-046). 'system' — как ThemeProvider.
try {
  var d = document.documentElement;
  d.lang = localStorage.getItem('app_language') || 'ru';
  var raw = localStorage.getItem('app-theme');
  var t = 'amethyst';
  if (raw) { try { t = JSON.parse(raw); } catch { t = raw; } }
  if (t === 'system') t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'amethyst' : 'notion';
  var bg = { modern: '#050506', notion: '#FAF8F5', spotify: '#090C0A', amethyst: '#0E0A18' };
  if (bg[t]) {
    d.classList.add('theme-' + t);
    d.style.background = bg[t];
    var light = t === 'notion';
    d.style.colorScheme = light ? 'light' : 'dark';
    var meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', light ? 'light' : 'dark');
  }
} catch { /* private mode: defaults stay */ }
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(function (e) { console.warn('SW registration failed:', e); });
}
