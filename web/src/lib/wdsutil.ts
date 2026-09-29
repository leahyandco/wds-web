import type { WdsUtilNode } from '../api/types'

/**
 * Finds a node in WDSUTIL's report by its label path, e.g. ['Server State', 'Standalone configuration'].
 * The path starts below the upper-case banners, which are searched in order.
 */
export function findNode(sections: WdsUtilNode[], path: string[]): WdsUtilNode | undefined {
  for (const section of sections) {
    let nodes = section.children
    let found: WdsUtilNode | undefined
    for (const name of path) {
      found = nodes.find((n) => n.name.toLowerCase() === name.toLowerCase())
      if (!found) break
      nodes = found.children
    }
    if (found) return found
  }
  return undefined
}

export const findValue = (sections: WdsUtilNode[], path: string[]) => findNode(sections, path)?.value ?? null
