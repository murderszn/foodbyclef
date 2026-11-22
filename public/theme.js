(function () {
  const STORAGE_KEY = 'clef-theme';
  const root = document.documentElement;

  function scheduledTheme() {
    const hour = new Date().getHours();
    return (hour >= 20 || hour < 8) ? 'dark' : 'light';
  }

  function getSavedTheme() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === 'dark' || value === 'light' ? value : null;
    } catch {
      return null;
    }
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#050505' : '#f6f4ec');
    const button = document.getElementById('theme-toggle');
    if (button) {
      const isDark = theme === 'dark';
      button.setAttribute('aria-pressed', String(isDark));
      button.setAttribute('title', isDark ? 'Switch to light mode (auto dark 8 PM–8 AM)' : 'Switch to dark mode (auto dark 8 PM–8 AM)');
      button.innerHTML = isDark
        ? '<span aria-hidden="true">☀</span><span>Light</span>'
        : '<span aria-hidden="true">☾</span><span>Dark</span>';
    }
  }

  applyTheme(getSavedTheme() || scheduledTheme());

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(root.dataset.theme || scheduledTheme());
    const button = document.getElementById('theme-toggle');
    button?.addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
      applyTheme(next);
    });
  });
})();
