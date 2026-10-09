import { lazy, type ComponentType } from 'react'

const RELOADED = 'wdsweb:reloaded-for-update'

const storage = {
  get: () => {
    try {
      return sessionStorage.getItem(RELOADED) !== null
    } catch {
      return true
    }
  },
  set: (on: boolean) => {
    try {
      if (on) sessionStorage.setItem(RELOADED, '1')
      else sessionStorage.removeItem(RELOADED)
    } catch {
      // Without storage, don't reload: the error shows instead.
    }
  },
}

/**
 * A page whose code loads when it's first opened. When the console has been updated since the tab was
 * loaded, the old page files are gone, so the tab reloads once to pick up the new ones; if loading fails
 * again, the error shows.
 */
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>) {
  return lazy(async () => {
    try {
      const page = await load()
      storage.set(false)
      return { default: page }
    } catch (error) {
      if (storage.get()) throw error
      storage.set(true)
      window.location.reload()
      // The reload takes over; render nothing meanwhile.
      return new Promise<never>(() => {})
    }
  })
}
