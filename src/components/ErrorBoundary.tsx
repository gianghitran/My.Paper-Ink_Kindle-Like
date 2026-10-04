import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

const isChunkError = (err: unknown) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk/i.test(String((err as Error)?.message ?? err))

interface Props {
  children: ReactNode

  resetKey?: string
}

export class ErrorBoundary extends Component<Props, { error: unknown }> {
  state = { error: null as unknown }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Page crashed', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    const updated = isChunkError(this.state.error)
    return (
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="size-10 text-muted-foreground" />
        <p className="text-[16px] font-semibold">{updated ? 'PaperInk was updated' : 'Something went wrong on this page'}</p>
        <p className="max-w-sm text-[13px] text-muted-foreground">
          {updated ? 'Reload to get the latest version. Your library is safe in your account.' : 'Your data is safe. Reload the page or go back to your library.'}
        </p>
        <div className="flex gap-2">
          <Button onClick={() => location.reload()}>Reload</Button>
          {!updated && (
            <Button variant="secondary" onClick={() => (location.hash = '#/')}>
              Library
            </Button>
          )}
        </div>
      </div>
    )
  }
}
