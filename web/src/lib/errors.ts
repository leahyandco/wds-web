// What common error codes in WDS's logs mean, and what to try. Codes are matched in the error's text.

const installHints: [code: RegExp, hint: string][] = [
  [/0x80070570\b/i, 'The image file is damaged or unreadable. Import the image again, and check the disk RemoteInstall is on.'],
  [/0x8007000[23]\b/i, "A file WDS needed isn't there. Import the image again, or check that RemoteInstall is intact."],
  [/0x80070005\b/i, 'Access was denied. The account signed in to the WDS client may not be allowed to read the image.'],
  [/0x80070070\b/i, "The client's disk is full: there isn't room for the image."],
  [/0x8004242d\b/i, "Setup couldn't format the disk. Clean the disk first, and check its partition style matches the firmware: GPT for UEFI, MBR for BIOS."],
  [/0x8030002[4-5]\b|0x80300001\b/i, "Windows can't be installed on that disk or partition: check the partition style (GPT for UEFI, MBR for BIOS) and the disk's mode in the firmware."],
  [/0x80070017\b/i, 'The disk returned a CRC error while being written: the disk, its cable or its controller driver may be failing.'],
  [/0x80070026\b/i, 'The image ended before it should have: the download may have been cut off. Try the install again.'],
]

/** A hint for an install error, from the code in its text, if it's a known one. */
export function installErrorHint(text: string | null | undefined): string | null {
  if (!text) return null
  return installHints.find(([code]) => code.test(text))?.[1] ?? null
}

// TFTP failures carry Windows system error numbers.
const tftpHints: Record<string, string> = {
  '1460': 'The client stopped answering (a timeout). Often the network drops large TFTP packets: try a smaller maximum block size, or turn off the variable window, under Server settings → TFTP and multicast.',
  '121': 'The transfer timed out. The network between the client and WDS may be dropping packets.',
  '64': 'The client went away mid-download: it restarted, or lost its network link.',
  '1236': 'The client cut the connection off.',
  '2': "The file isn't in RemoteInstall any more: the boot image may have been removed or renamed. Boot the client again.",
  '5': "WDS couldn't read the file: check the permissions on RemoteInstall.",
}

/** A hint for a failed TFTP download, from its error code, if it's a known one. */
export const tftpErrorHint = (code: string | null | undefined): string | null => (code ? (tftpHints[code.trim()] ?? null) : null)
