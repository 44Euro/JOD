// Sets the theme before the first paint so a dark screen never flashes light. A file, not inline, so the page's
// content security policy can refuse every inline script.
try {
  var choice = localStorage.getItem('jod-theme') || 'system'
  var dark = choice === 'dark' || (choice === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
} catch (e) {}
