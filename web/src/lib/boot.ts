import type { BootSession, BootStatus } from '../api/types'

export const bootStatus: Record<BootStatus, { label: string; color: string; description: string }> = {
  pxeOnly: { label: 'PXE request', color: 'gray', description: "Asked WDS for a boot program but didn't download one (e.g. F12 not pressed)." },
  bootMenu: { label: 'Boot menu', color: 'blue', description: 'Loaded the WDS boot manager but no boot image yet.' },
  downloading: { label: 'Downloading', color: 'cyan', description: 'Downloading a boot image over TFTP.' },
  loaded: { label: 'Loaded', color: 'green', description: 'Downloaded a boot image and started WinPE.' },
  failed: { label: 'Failed', color: 'red', description: 'A TFTP download failed.' },
  incomplete: { label: 'Incomplete', color: 'yellow', description: 'A boot image download started but never reported finishing.' },
}

/** The file name from a WDS path such as \Boot\x64\Images\boot.wim. */
export const baseName = (path: string) => path.split('\\').pop() ?? path

export function architectureLabel(session: BootSession): string {
  if (session.architecture) return session.architecture
  if (session.architectureCode != null) return `Code ${session.architectureCode}`
  return 'Unknown'
}

/** How long the boot image took to download, in seconds, when both ends were logged. */
export function imageSeconds(session: BootSession): number | null {
  const image = session.transfers.findLast((t) => t.fileName === session.bootImage)
  if (!image?.startedAt || !image.finishedAt) return null
  return (new Date(image.finishedAt).getTime() - new Date(image.startedAt).getTime()) / 1000
}
