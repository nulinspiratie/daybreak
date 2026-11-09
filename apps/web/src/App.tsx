import { useDrainInvalidation, useLiveUpdates } from './api/hooks'
import { useKeyboard } from './keyboard/useKeyboard'
import { MyDayPane } from './myday/MyDayPane'
import { PickerHost } from './picker/PickerHost'
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
        <MyDayPane />
      </div>
      <PickerHost />
      <Toast />
      <ConfirmLive />
    </div>
  )
}
