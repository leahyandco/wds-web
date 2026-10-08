import type { WdsRecord } from '../api/types'
import { promptOptions, sameText } from './settings'

const prompts = promptOptions.map((option) => option.value)

/** A device's own PXE prompt policy, or '' when it follows the server's (WDS reports 0 for that). */
export const devicePrompt = (device: WdsRecord) =>
  typeof device.PxePromptPolicy === 'string' && prompts.includes(device.PxePromptPolicy) ? device.PxePromptPolicy : ''

/** WDS checks device names like DNS host names: no spaces, no leading or trailing hyphen. */
export const isDeviceName = (value: string) => /^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$/.test(value.trim())

export const isMacAddress = (value: string) => /^[0-9a-f]{12}$/i.test(value.trim().replace(/[-:. ]/g, ''))

/** Only the dashed form: bare GUID digits are in a different byte order, so they'd name another machine. */
export const isGuid = (value: string) => /^\{?[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\}?$/i.test(value.trim())

export const isDeviceId = (value: string) => isMacAddress(value) || isGuid(value)

/** The same MAC address or GUID, whatever the separators, braces or case. */
const sameDeviceId = (a: unknown, b: unknown) => {
  const hex = (value: unknown) => String(value ?? '').replace(/[^0-9a-f]/gi, '').toUpperCase()
  return hex(a) !== '' && hex(a) === hex(b)
}

/** The approved request a prestaged device came from, while WDS still keeps it. */
export const approvedRequestFor = (device: WdsRecord, requests: WdsRecord[]) =>
  requests.find(
    (request) =>
      request.Status === 'Approved' &&
      (sameDeviceId(request.DeviceID, device.DeviceID) || (!!request.DeviceName && sameText(String(request.DeviceName), String(device.DeviceName)))),
  )

/** Firmware that doesn't set an SMBIOS GUID reports all zeros or all Fs, which many machines then share. */
export const isPlaceholderGuid = (value: string) => /^\{?(0{8}(-0{4}){3}-0{12}|f{8}(-f{4}){3}-f{12})\}?$/i.test(value.trim())

/**
 * Boot images a device can be sent to, as the RemoteInstall-relative paths WDS stores, labelled with the
 * image's name. A path the device already has but that's no longer registered is kept as a choice.
 */
export function bootImageChoices(bootImages: WdsRecord[], current: string) {
  const choices = bootImages.map((image) => {
    const architecture = String(image.Architecture ?? '').toLowerCase()
    return { value: `Boot\\${architecture}\\Images\\${String(image.FileName)}`, label: `${String(image.Name)} (${architecture})` }
  })
  const known = choices.find((choice) => sameText(choice.value, current))
  if (current && !known) choices.unshift({ value: current, label: current })
  return { choices, selected: known?.value ?? current }
}
