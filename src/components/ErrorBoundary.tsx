import { Component, type ErrorInfo, type ReactNode } from 'react'
import { error as logError } from '@tauri-apps/plugin-log'
import { AlertCircle, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[React ErrorBoundary]', error, errorInfo)
    void logError(`[React ErrorBoundary] ${error.message}\n${error.stack || ''}\nComponent Stack:${errorInfo.componentStack || ''}`).catch(() => {})
  }

  private handleReload = () => {
    window.location.reload()
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-[100dvh] w-screen flex-col items-center justify-center bg-[var(--bg-app)] p-6 text-[var(--text-main)]">
          <div className="flex max-w-md flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-500">
              <AlertCircle className="h-6 w-6" />
            </div>
            <h2 className="mb-2 text-lg font-semibold">Application Error</h2>
            <p className="mb-6 text-sm text-[var(--text-muted)]">
              An unexpected error occurred. The incident has been recorded in the local system log.
            </p>
            {this.state.error && (
              <pre className="mb-6 max-h-32 w-full overflow-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-3 text-left font-mono text-xs text-red-400">
                {this.state.error.message}
              </pre>
            )}
            <button
              type="button"
              onClick={this.handleReload}
              className="flex items-center gap-2 rounded-md bg-[var(--action)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              <RotateCcw className="h-4 w-4" />
              Reload Application
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

