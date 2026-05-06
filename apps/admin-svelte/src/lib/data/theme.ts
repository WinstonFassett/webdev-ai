/** Theme toggle — dark/light with system preference default */

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'webdev-theme'

function getSystemTheme(): Theme {
  return 'dark'
}

function getStoredTheme(): Theme | null {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : null
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function initTheme(): Theme {
  const theme = getStoredTheme() ?? getSystemTheme()
  applyTheme(theme)
  return theme
}

export function toggleTheme(current: Theme): Theme {
  const next: Theme = current === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  localStorage.setItem(STORAGE_KEY, next)
  return next
}
