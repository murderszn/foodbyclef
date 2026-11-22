(function () {
  const root = document.documentElement;

  function applyScheduledTheme() {
    const hour = new Date().getHours();
    const theme = (hour >= 20 || hour < 8) ? 'dark' : 'light';
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#050505' : '#f6f4ec');
  }

  applyScheduledTheme();
  setInterval(applyScheduledTheme, 60000);
})();
