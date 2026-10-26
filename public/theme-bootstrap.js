// Keep the first paint consistent with presentationPreferences.ts, before React loads.
(() => {
  let preference = 'dark';
  try { preference = localStorage.getItem('gys:appearance:v1') || 'dark'; } catch { /* Storage may be unavailable. */ }
  const light = preference === 'orange' ||
    (preference === 'system' && window.matchMedia?.('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.gysTheme = light ? 'orange' : 'dark';
  document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
    meta.content = light ? '#FAF7F1' : '#0B0B0B';
  });
  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.content = light ? 'light' : 'dark';
})();
