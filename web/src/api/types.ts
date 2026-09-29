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
  /** Boot program files under RemoteInstall, e.g. Boot\x64\wdsmgfw.efi. */
  bootPrograms: string[]
  interfaces: ServerInterface[]
}

export interface ServerInterface {
  name: string
  ipAddress: string
  macAddress: string | null
  status: string | null
}

export type SettingsGroup = 'pxe' | 'boot' | 'client' | 'pending-devices' | 'bind' | 'transport'

export interface SettingsResult {
  applied: { command: string; message: string }[]
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

export interface DriverPackage {
  id: string
  name: string
  architecture: string | null
  className: string | null
  classGuid: string | null
  provider: string | null
  version: string | null
  /** The driver's own date, yyyy-MM-dd. */
  date: string | null
  /** When it was added to WDS, in the server's local time. */
  dateAdded: string | null
  enabled: boolean
  signed: boolean
  infPath: string | null
  locale: string | null
  groups: string[]
}

export interface DriverGroup {
  name: string
  id: string | null
  applicability: string | null
  enabled: boolean
  packageCount: number
}

export interface DriverCatalog {
  groups: DriverGroup[]
  packages: DriverPackage[]
}

export type ImageKind = 'boot' | 'install'

export interface UploadInfo {
  id: string
  fileName: string
  size: number
  received: number
  createdAt: string
  /** Where the file is on the WDS server. */
  serverPath: string
  complete: boolean
}

/** An .iso, .wim or .esd found on the WDS server. */
export interface ServerImageFile {
  path: string
  size: number
  modified: string
}

/** One image inside a .wim or .esd. */
export interface ImageEntry {
  index: number
  name: string
  description: string | null
  size: number
  architecture: string
  version: string
  editionId: string | null
  installationType: string | null
  languages: string[]
  bootable: boolean
  modified: string | null
}

export interface ImageFileEntry {
  /** For an ISO, the file inside it, e.g. sources\install.wim. */
  innerPath: string | null
  role: ImageKind
  format: string
  size: number
  images: ImageEntry[]
}

/** What's inside a file that could be imported. */
export interface ImageFileInfo {
  path: string
  name: string
  size: number
  format: 'iso' | 'wim' | 'esd'
  label: string | null
  warning: string | null
  files: ImageFileEntry[]
}

export interface ImportRequestBody {
  uploadId?: string
  serverPath?: string
  innerPath?: string | null
  kind: ImageKind
  index: number
  imageGroup?: string
  createGroup?: boolean
  name: string
  description?: string
  fileName?: string
  deleteUploadAfter?: boolean
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface ImportJob {
  id: string
  request: {
    sourcePath: string
    innerPath: string | null
    kind: ImageKind
    index: number
    imageGroup: string | null
    name: string
    fileName: string
  }
  status: JobStatus
  stage: string | null
  percent: number | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  log: { time: string; text: string }[]
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
