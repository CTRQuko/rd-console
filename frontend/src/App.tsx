import { Monitor } from 'lucide-react'

function App() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center gap-3">
          <Monitor className="h-10 w-10 text-primary" />
          <h1 className="text-4xl font-semibold tracking-tight">rd-console</h1>
        </div>
        <p className="text-muted-foreground">
          Self-hosted RustDesk Server admin panel — scaffold ready.
        </p>
        <p className="text-xs text-muted-foreground">
          Next: run Claude Design prompt to generate full UI.
        </p>
      </div>
    </div>
  )
}

export default App
