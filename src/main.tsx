import React from 'react'
import ReactDOM from 'react-dom/client'
import { attachConsole, error as logError } from '@tauri-apps/plugin-log'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import './index.css'

// Forward frontend console messages (console.error, console.warn, etc.) to Tauri log file
void attachConsole().catch(() => {})

// Catch unhandled global JavaScript errors
window.addEventListener('error', (event) => {
  const message = `[Uncaught Error] ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`
  void logError(message).catch(() => {})
})

// Catch unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error
    ? `${event.reason.message}\n${event.reason.stack || ''}`
    : String(event.reason)
  const message = `[Unhandled Rejection] ${reason}`
  void logError(message).catch(() => {})
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

