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

/** The number a value starts with: "10 seconds" → 10, "256 KBps" → 256. */
export function leadingNumber(value: string | null, fallback: number): number {
  const match = value?.match(/^\s*(\d+)/)
  return match ? Number(match[1]) : fallback
}

export const isYes = (value: string | null) => value?.trim().toLowerCase() === 'yes'

/** A per-architecture list such as "Default boot programs", as { x64uefi: 'Boot\\x64\\wdsmgfw.efi', ... }. */
export function architectureValues(sections: WdsUtilNode[], path: string[]): Record<string, string | null> {
  return Object.fromEntries((findNode(sections, path)?.children ?? []).map((n) => [n.name, n.value]))
}
