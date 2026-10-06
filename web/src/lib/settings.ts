import type { SettingsGroup } from '../api/types'

/** The WDSUTIL report sections whose settings the console can change, and which form changes them. */
const editorsByPolicy: Record<string, SettingsGroup> = {
  'answer policy': 'pxe',
  'boot program policy': 'boot',
  'boot image policy': 'boot',
  'wds client policy': 'client',
  'pending device policy': 'pending-devices',
  'interface bind policy': 'bind',
  'wds transport server policy': 'transport',
}

export const editorFor = (policyName: string): SettingsGroup | null => editorsByPolicy[policyName.toLowerCase()] ?? null

export const ARCHITECTURES = ['x64uefi', 'x64', 'x86uefi', 'x86', 'arm64', 'arm'] as const

/** The RemoteInstall\Boot folder an architecture's files live in: x64uefi shares Boot\x64. */
export const bootFolder = (architecture: string) =>
  architecture.startsWith('x64') ? 'x64' : architecture.startsWith('x86') ? 'x86' : architecture

/** UEFI and ARM clients boot .efi programs; BIOS clients boot .com and .n12 ones. */
export const bootsEfi = (architecture: string) => architecture.endsWith('uefi') || architecture.startsWith('arm')

export const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').toLowerCase() === (b ?? '').toLowerCase()

/** What a PXE client does about network booting, for the server's prompt policies and a device's own. */
export const promptOptions = [
  { value: 'OptIn', label: 'Press F12 to network boot (OptIn)' },
  { value: 'NoPrompt', label: 'Always network boot (NoPrompt)' },
  { value: 'OptOut', label: 'Network boot unless Esc is pressed (OptOut)' },
  { value: 'Abort', label: 'Never network boot (Abort)' },
]
