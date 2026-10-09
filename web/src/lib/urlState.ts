import { useSearchParams } from 'react-router'

/**
 * A page's state kept in its address (filters, tabs, the open item), so a reload, the back button and links
 * keep it. `update` changes several at once; an empty value takes one out. The address is replaced, not
 * added to the history, so Back leaves the page rather than stepping through its filters.
 */
export function useUrlParams() {
  const [params, setParams] = useSearchParams()
  const update = (changes: Record<string, string | null | undefined>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        for (const [name, value] of Object.entries(changes)) {
          if (value) next.set(name, value)
          else next.delete(name)
        }
        return next
      },
      { replace: true },
    )
  return [params, update] as const
}
