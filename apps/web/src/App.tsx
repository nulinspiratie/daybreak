import { useLiveUpdates } from './api/hooks'
import { TitleBar } from './shell/TitleBar'

export function App() {
  useLiveUpdates()
  return (
    <div className="app">
      <TitleBar />
      <div className="body">
        <section className="pane pane--tree" aria-label="Projects">
          <div className="pane__head"><h1>Projects</h1></div>
        </section>
        <section className="pane pane--day" aria-label="My Day">
          <div className="pane__head"><h2>My Day</h2></div>
        </section>
      </div>
    </div>
  )
}
