export interface ConnectionInfo {
  mode: 'Local' | 'Remote'
  target: string
}

export interface TargetInfo {
  computerName: string
  osCaption: string
  osVersion: string
  osBuild: string
  lastBootTime: string
  partOfDomain: boolean
  domain: string
  psVersion: string
  features: { name: string; displayName: string; installed: boolean }[]
  wdsService: { status: string; startType: string } | null
  wdsModule: string | null
}

/** A line of WDSUTIL's report, with the lines indented beneath it as children. */
export interface WdsUtilNode {
  name: string
  value: string | null
  children: WdsUtilNode[]
}

export interface ServerConfig {
  wdsUtilExitCode: number
  sections: WdsUtilNode[]
  raw: string
  remoteInstall: { path: string; totalBytes: number; freeBytes: number } | null
  /** 1 = the insecure hands-free override is on, 0 = explicitly off, null = the update's default (off). */
  allowHandsFreeFunctionality: number | null
}

/** A WDS object as the WDS module reports it: CIM property names, values reduced to JSON. */
export type WdsRecord = Record<string, unknown>

export interface InstallImages {
  groups: WdsRecord[]
  images: WdsRecord[]
}

export interface Devices {
  prestaged: WdsRecord[]
  autoAdd: WdsRecord[]
  errors: string[]
}

export interface WdsEvent {
  time: string
  id: number
  /** Windows event level: 1 critical, 2 error, 3 warning, 4 information, 5 verbose. */
  level: number
  levelName: string | null
  log: string
  provider: string
  recordId: number
  message: string | null
  /** The event's named fields (UserData elements, or EventData values keyed by name or position). */
  data: Record<string, string>
}

export interface EventsResponse {
  events: WdsEvent[]
  /** Routine TFTP and management-call events left out of `events`. */
  routineHidden: number
  warnings: string[]
}

export type BootStatus = 'pxeOnly' | 'bootMenu' | 'downloading' | 'loaded' | 'failed' | 'incomplete'

export interface TftpTransfer {
  fileName: string
  fileSize: number | null
  startedAt: string | null
  finishedAt: string | null
  succeeded: boolean | null
  errorCode: string | null
}

/** One client's PXE boot and the files it then fetched over TFTP. */
export interface BootSession {
  clientIp: string
  macAddress: string | null
  deviceId: string | null
  /** WDS's own name for the client's architecture (e.g. x64uefi), when it served the client a BCD. */
  architecture: string | null
  /** The architecture number from the PXE event, whose meaning WDS doesn't document. */
  architectureCode: number | null
  prestaged: boolean | null
  firstSeen: string
  lastSeen: string
  status: BootStatus
  bootImage: string | null
  transfers: TftpTransfer[]
}

export interface ActivityResponse {
  sessions: BootSession[]
  /** The oldest event in WDS's Operational log; boots before this aren't known. */
  logStartsAt: string | null
  logMaxBytes: number
}
