import type { KeyboardEvent } from 'react'

/**
 * For a table row that opens on click: Enter or Space opens it too, like a button. Only when the row itself has
 * the focus, so a key pressed on a checkbox or menu in the row does its own thing.
 */
export const openOnKey = (open: () => void) => (event: KeyboardEvent<HTMLElement>) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
    event.preventDefault()
    open()
  }
}
