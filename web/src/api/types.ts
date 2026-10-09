export interface SessionInfo {
  /** False in development, where there's no sign-in. */
  authEnabled: boolean
  authenticated: boolean
  userName: string | null
  /** The WDS server this console manages. */
  server: string
}

export interface ConnectionInfo {
  mode: 'Local' | 'Remote' | 'Demo'
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

/** A group or account allowed to sign in, as configured, and whether Windows could find it. */
export interface AllowedAccount {
  name: string
  kind: 'group' | 'user'
  /** Why it can't be used (it doesn't exist, or the lookup failed); null when it can. */
  problem: string | null
  resolved: boolean
}

/** How this console is set up: what it manages, as whom, and who may use it. */
export interface ConsoleInfo {
  version: string
  mode: 'local' | 'remote' | 'demo'
  server: string
  consoleHost: string
  /** The account the WDS server sees the console as. */
  connectsAs: string
  serviceAccount: string
  settingsFile: string
  settingsFileExists: boolean
  stagingPath: string
  stagingAccess: string
  signInRequired: boolean
  allowedAccounts: AllowedAccount[]
  /** A TimeSpan, e.g. 08:00:00. */
  sessionLifetime: string
}

/** An install image's unattend file, which Windows Setup reads when it installs the image. */
export interface ImageUnattend {
  present: boolean
  /** Where WDS keeps it on the server. */
  path: string
  content: string | null
}

export interface Devices {
  prestaged: WdsRecord[]
  autoAdd: WdsRecord[]
  /** False while the pending-device policy is off; WDS then keeps no requests. */
  pendingPolicyEnabled: boolean
  errors: string[]
}

/** A prestaged device's settings. Null or '' leaves a setting to the server. */
export interface DeviceSettings {
  group?: string | null
  pxePromptPolicy?: string | null
  bootImagePath?: string | null
  wdsClientUnattend?: string | null
  /** Whether the WDS client joins the computer to the domain under the device's name. */
  joinDomain?: boolean | null
}

export interface NewDevice extends DeviceSettings {
  name: string
  deviceId: string
}

/** Changes to a device: null leaves a value as it is, '' clears it. */
export interface DeviceChanges extends DeviceSettings {
  deviceId?: string | null
}

export interface DeviceApproval {
  name?: string | null
  bootImagePath?: string | null
  wdsClientUnattend?: string | null
  joinDomain?: boolean | null
}

/** Which answered requests to delete; WDS deletes them only by status. */
export interface ClearedRequests {
  approved: boolean
  rejected: boolean
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

/** Which clients get a driver group's packages. Types and chassis types are as WDSUTIL takes them, e.g. ChassisType, MiniTower. */
export interface DriverGroupFilter {
  type: string
  /** Include: only clients that match get the group. Exclude: clients that match don't. */
  policy: 'Include' | 'Exclude'
  values: string[]
}

export interface DriverGroup {
  name: string
  id: string | null
  /** Matched: clients get the packages that match their hardware. All: every package. */
  applicability: string | null
  enabled: boolean
  packageCount: number
  /** With none, every client gets the group. */
  filters: DriverGroupFilter[]
}

export interface NewDriverGroup {
  name: string
  enabled: boolean
  applicability: 'Matched' | 'All'
  filters: DriverGroupFilter[]
}

/** Changes to a driver group; null leaves a value as it is. Filters replace the group's whole set. */
export interface DriverGroupChanges {
  name?: string | null
  enabled?: boolean | null
  applicability?: string | null
  filters?: DriverGroupFilter[] | null
}

export interface DriverPackageChanges {
  name?: string | null
  enabled?: boolean | null
}

export type DriverPackageAction = 'enable' | 'disable' | 'remove' | 'addToGroup' | 'removeFromGroup'

export interface DriverPackageBatch {
  ids: string[]
  action: DriverPackageAction
  group?: string | null
}

/** Drivers to add from an uploaded .zip or .cab, or from a file or folder on the WDS server. */
export interface ImportDriversBody {
  uploadId?: string
  serverPath?: string
  driverGroup?: string | null
  createGroup: boolean
  /** x86, x64, arm or arm64 to add only those drivers; null for all. */
  architecture?: string | null
  deleteUploadAfter: boolean
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

export interface ImageImportRequest {
  kind: ImageKind
  sourcePath: string
  innerPath: string | null
  index: number
  imageGroup: string | null
  name: string
  fileName: string
}

export interface DriverImportRequest {
  kind: 'drivers'
  sourcePath: string
  /** The .zip, .cab or folder the drivers come from. */
  name: string
  driverGroup: string | null
  architecture: string | null
}

/** What a driver import found and did. */
export interface DriverImportResult {
  summary: string
  found: number
  /** Packages WDS didn't have before; null if it couldn't be counted. */
  new: number | null
  added: string[]
  otherArchitecture: string[]
  failed: { inf: string; reason: string }[]
  driverGroup: string | null
}

/** Driver packages being written into a boot image. */
export interface BootImageDriversRequest {
  kind: 'boot-drivers'
  /** The boot image. */
  name: string
  imageName: string
  architecture: string
  fileName: string | null
  packageIds: string[]
}

/** What writing drivers into a boot image did. */
export interface BootImageDriversResult {
  summary: string
  added: string[]
  failed: { id: string; reason: string }[]
  image: string
}

export type ImportKind = ImageKind | 'drivers' | 'boot-drivers'

export interface ImportJob {
  id: string
  request: ImageImportRequest | DriverImportRequest | BootImageDriversRequest
  status: JobStatus
  stage: string | null
  percent: number | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  log: { time: string; text: string }[]
  /** What the import's script reported: the image imported, or a DriverImportResult. */
  result: unknown
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
  /** The newest of the matching events, as many as were asked for. */
  events: WdsEvent[]
  /** How many events matched, which can be more than `events` holds. */
  total: number
  /** Routine TFTP and management-call events left out of `events`. */
  routineHidden: number
  warnings: string[]
}

export type BootStatus = 'pxeOnly' | 'bootProgram' | 'bootMenu' | 'downloading' | 'loaded' | 'failed' | 'incomplete'

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
  /** Stays the same as the boot goes on, so it can be followed and linked to. */
  id: string
  clientIp: string
  macAddress: string | null
  deviceId: string | null
  /** The client's architecture and firmware, such as "x64 UEFI", from the files it fetched. */
  architecture: string | null
  /** The architecture number from the PXE event, whose meaning WDS doesn't document. */
  architectureCode: number | null
  prestaged: boolean | null
  firstSeen: string
  lastSeen: string
  status: BootStatus
  bootImage: string | null
  transfers: TftpTransfer[]
  notes: BootNote[]
  /** The install that followed, when WDS client logging is on. */
  deployment: Deployment | null
}

/** Something WDS logged about a boot besides its downloads. */
export interface BootNote {
  time: string
  /**
   * unattendBlocked: WDS refused Windows Setup's request for the WDS client unattend file.
   * notRecognized: WDS ignored the PXE request, as it answers only prestaged clients.
   */
  kind: 'unattendBlocked' | 'notRecognized'
}

export type DeploymentStage = 'started' | 'imageSelected' | 'transferring' | 'applying' | 'finishing' | 'finished' | 'failed'

export interface DeploymentNote {
  time: string
  level: 'info' | 'warning' | 'error'
  text: string
}

/** An install, as the WDS client reported it. */
export interface Deployment {
  stage: DeploymentStage
  startedAt: string
  lastSeen: string
  clientVersion: string | null
  winPeVersion: string | null
  imageGroup: string | null
  imageName: string | null
  imageLanguage: string | null
  imageArchitecture: string | null
  userName: string | null
  multicastNamespace: string | null
  /** The image came straight from the server's share rather than by multicast. */
  unicast: boolean
  transferStartedAt: string | null
  transferFinishedAt: string | null
  applyStartedAt: string | null
  applyFinishedAt: string | null
  finishedAt: string | null
  error: string | null
  /** The WDS client couldn't join the computer to the domain, as its device asked. */
  domainJoinFailed: boolean
  timeline: DeploymentNote[]
}

export interface ActivityResponse {
  sessions: BootSession[]
  /** The oldest event in WDS's Operational log; boots before this aren't known. */
  logStartsAt: string | null
  logMaxBytes: number
}
