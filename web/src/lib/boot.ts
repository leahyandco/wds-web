import type { BootSession, BootStatus } from '../api/types'

export const bootStatus: Record<BootStatus, { label: string; color: string; description: string }> = {
  pxeOnly: {
    label: 'PXE request',
    color: 'gray',
    description: 'Asked WDS to network boot but downloaded nothing from it: another PXE server may have answered, or TFTP was blocked.',
  },
  bootProgram: {
    label: 'Boot program',
    color: 'gray',
    description:
      "Ran WDS's boot program and went no further: usually nobody answered its network boot prompt (F12, or Enter on UEFI), or it's waiting for approval.",
  },
  bootMenu: { label: 'Boot menu', color: 'blue', description: "Reached WDS's boot menu but didn't start a boot image." },
  downloading: { label: 'Downloading', color: 'cyan', description: 'Downloading a boot image over TFTP.' },
  loaded: { label: 'Loaded', color: 'green', description: 'Downloaded a boot image and started WinPE.' },
  failed: { label: 'Failed', color: 'red', description: 'A TFTP download failed.' },
  incomplete: {
    label: 'Incomplete',
    color: 'yellow',
    description: "A boot image download never finished: the client was turned off or restarted, or it's stalled.",
  },
}

/** The file name from a WDS path such as \Boot\x64\Images\boot.wim. */
export const baseName = (path: string) => path.split('\\').pop() ?? path

export const architectureLabel = (session: BootSession) => session.architecture ?? 'Unknown'

/** WDS logs a client it ignored before DHCP gave it an address as 0.0.0.0. */
export const clientAddress = (session: BootSession) => (session.clientIp === '0.0.0.0' ? 'No address yet' : session.clientIp)

/** How long the boot image took to download, in seconds, when both ends were logged. */
export function imageSeconds(session: BootSession): number | null {
  const image = session.transfers.findLast((t) => t.fileName === session.bootImage)
  if (!image?.startedAt || !image.finishedAt) return null
  return (new Date(image.finishedAt).getTime() - new Date(image.startedAt).getTime()) / 1000
}
