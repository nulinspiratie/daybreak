import { useDrainInvalidation, useLiveUpdates } from './api/hooks'
import { DetailPanel } from './detail/DetailPanel'
import { useKeyboard } from './keyboard/useKeyboard'
import { MyDayPane } from './myday/MyDayPane'
import { PickerHost } from './picker/PickerHost'
import { ReviewScreen, useOpenReviewWhenDue } from './review/ReviewScreen'
import { ConfirmLive } from './shell/ConfirmNote'
import { TitleBar } from './shell/TitleBar'
import { Toast } from './shell/Toast'
import { useUi } from './ui/store'
import { DragAndDrop } from './tree/Dnd'
import { TreePane } from './tree/TreePane'

export function App() {
  useLiveUpdates()
  useDrainInvalidation()
  useKeyboard()
  useOpenReviewWhenDue()
  const detailOpen = useUi((s) => s.detailId !== null)
  const reviewOpen = useUi((s) => s.reviewOpen)
  return (
    <div className="app">
      {reviewOpen ? (
        <ReviewScreen />
      ) : (
        <>
          <TitleBar />
          <div className="body">
            <DragAndDrop>
              <TreePane />
              {detailOpen ? <DetailPanel /> : <MyDayPane />}
            </DragAndDrop>
          </div>
          <PickerHost />
        </>
      )}
      <Toast />
      <ConfirmLive />
    </div>
  )
}
