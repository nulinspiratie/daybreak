import { useDrainInvalidation, useLiveUpdates } from './api/hooks'
import { useKeyboard } from './keyboard/useKeyboard'
import { ConfirmLive } from './shell/ConfirmNote'
import { TitleBar } from './shell/TitleBar'
import { Toast } from './shell/Toast'
import { TreePane } from './tree/TreePane'

export function App() {
  useLiveUpdates()
  useDrainInvalidation()
  useKeyboard()
  return (
    <div className="app">
      <TitleBar />
      <div className="body">
        <TreePane />
        <section className="pane pane--day" aria-label="My Day">
          <div className="pane__head"><h2>My Day</h2></div>
        </section>
      </div>
      <Toast />
      <ConfirmLive />
    </div>
  )
}
