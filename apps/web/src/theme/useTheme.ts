import { useCallback, useState } from 'react'
import { syncThemeColor } from '../pwa/themeColor'

export type Theme = 'light' | 'dark'

function current(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(current)
  const toggle = useCallback(() => {
    const next: Theme = current() === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    syncThemeColor()
    try {
      localStorage.setItem('daybreak.theme', next)
    } catch {
      // storage unavailable: the choice just won't be remembered
    }
    setTheme(next)
  }, [])
  return { theme, toggle }
}
