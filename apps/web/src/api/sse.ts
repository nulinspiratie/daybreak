/** Opens the SSE feed. EventSource reconnects by itself; the returned function closes it. */
export function connectEvents(onChanged: () => void, onDayChanged: (today: string) => void): () => void {
  const source = new EventSource('/events/stream')
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
