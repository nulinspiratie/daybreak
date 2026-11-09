/**
 * Opens the SSE feed. EventSource reconnects by itself: `stream.lost` on each error (the feed is
 * down, or a retry failed), `stream.open` each time it is up again. The returned function closes it.
 */
export function connectEvents(
  onChanged: () => void,
  onDayChanged: (today: string) => void,
  stream: { open: () => void; lost: () => void },
): () => void {
  const source = new EventSource('/events/stream')
  source.addEventListener('open', () => stream.open())
  source.addEventListener('error', () => stream.lost())
  source.addEventListener('changed', () => onChanged())
  source.addEventListener('day_changed', (e) => {
    try {
      const { today } = JSON.parse((e as MessageEvent<string>).data) as { today: string }
      onDayChanged(today)
    } catch {
      onDayChanged('')
    }
  })
  return () => source.close()
}
