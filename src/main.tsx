import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { Toaster } from 'sonner'
import { useAppStore } from './stores/useAppStore.ts'

function ThemedToaster() {
  const theme = useAppStore((state) => state.settings.theme)
  const toasterTheme = theme === 'Dark' ? 'dark' : theme === 'System' ? 'system' : 'light'

  return <Toaster position="top-center" richColors closeButton theme={toasterTheme} />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <ThemedToaster />
  </React.StrictMode>,
)
