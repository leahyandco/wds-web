import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from './client'
import type {
  ActivityResponse,
  ClearedRequests,
  ConnectionInfo,
  ConsoleInfo,
  DeviceApproval,
  DeviceChanges,
  Devices,
  DriverCatalog,
  DriverGroupChanges,
  DriverPackageBatch,
  DriverPackageChanges,
  EventsResponse,
  ImageFileInfo,
  ImageKind,
  ImageUnattend,
  ImportDriversBody,
  ImportJob,
  ImportRequestBody,
  InstallImages,
  NewDevice,
  NewDriverGroup,
  ServerConfig,
  ServerImageFile,
  SessionInfo,
  SettingsGroup,
  SettingsResult,
  TargetInfo,
  WdsRecord,
} from './types'

export const useSession = () =>
  useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => apiGet<SessionInfo>('/auth/me', signal),
    staleTime: Infinity,
    retry: false,
  })

export const useSignIn = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (credentials: { userName: string; password: string }) => apiSend<SessionInfo>('POST', '/auth/login', credentials),
    onSuccess: (session) => {
      queryClient.setQueryData(['session'], session)
      // Anything fetched before signing in failed with 401; fetch it again.
      void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'session' })
    },
  })
}

export const useSignOut = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiSend('POST', '/auth/logout'),
    onSuccess: () => {
      queryClient.clear()
      void queryClient.invalidateQueries({ queryKey: ['session'] })
    },
  })
}

export const useConnection = () =>
  useQuery({
    queryKey: ['connection'],
    queryFn: ({ signal }) => apiGet<ConnectionInfo>('/connection', signal),
    staleTime: Infinity,
  })

export const useConsoleInfo = () =>
  useQuery({
    queryKey: ['console'],
    queryFn: ({ signal }) => apiGet<ConsoleInfo>('/console', signal),
    staleTime: Infinity,
  })

export const useTarget = () =>
  useQuery({
    queryKey: ['target'],
    queryFn: ({ signal }) => apiGet<TargetInfo>('/target', signal),
    staleTime: 5 * 60_000,
  })

export const useServerConfig = () =>
  useQuery({
    queryKey: ['server-config'],
    queryFn: ({ signal }) => apiGet<ServerConfig>('/server/config', signal),
  })

export const useBootImages = () =>
  useQuery({
    queryKey: ['boot-images'],
    queryFn: ({ signal }) => apiGet<WdsRecord[]>('/boot-images', signal),
  })

export const useInstallImages = () =>
  useQuery({
    queryKey: ['install-images'],
    queryFn: ({ signal }) => apiGet<InstallImages>('/install-images', signal),
  })

export const useDrivers = () =>
  useQuery({
    queryKey: ['drivers'],
    queryFn: ({ signal }) => apiGet<DriverCatalog>('/drivers', signal),
    staleTime: 5 * 60_000,
  })

export const useDevices = () =>
  useQuery({
    queryKey: ['devices'],
    queryFn: ({ signal }) => apiGet<Devices>('/devices', signal),
  })

export const useEvents = (hours: number, includeRoutine = false) =>
  useQuery({
    queryKey: ['events', hours, includeRoutine],
    queryFn: ({ signal }) => apiGet<EventsResponse>(`/events?hours=${hours}&routine=${includeRoutine}`, signal),
    refetchInterval: 30_000,
  })

/** PXE boots, refreshed often enough to watch a client come up. */
export const useActivity = (hours: number) =>
  useQuery({
    queryKey: ['activity', hours],
    queryFn: ({ signal }) => apiGet<ActivityResponse>(`/activity?hours=${hours}`, signal),
    refetchInterval: 10_000,
  })

/** Image files already on the WDS server that could be imported. */
export const useServerImageFiles = (enabled: boolean) =>
  useQuery({
    queryKey: ['image-files'],
    queryFn: ({ signal }) => apiGet<ServerImageFile[]>('/images/files', signal),
    enabled,
  })

export const useInspectImage = () =>
  useMutation({
    mutationFn: (path: string) => apiSend<ImageFileInfo>('POST', '/images/inspect', { path }),
  })

/** Import jobs: polled quickly while one is queued or running, slowly otherwise. */
export const useJobs = () =>
  useQuery({
    queryKey: ['jobs'],
    queryFn: ({ signal }) => apiGet<ImportJob[]>('/jobs', signal),
    refetchInterval: (query) =>
      query.state.data?.some((job) => job.status === 'queued' || job.status === 'running') ? 2_000 : 15_000,
  })

export const useStartImport = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: ImportRequestBody) => apiSend<ImportJob>('POST', '/images/import', request),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  })
}

/** .zip and .cab files of drivers already on the WDS server. */
export const useServerDriverFiles = (enabled: boolean) =>
  useQuery({
    queryKey: ['driver-files'],
    queryFn: ({ signal }) => apiGet<ServerImageFile[]>('/drivers/files', signal),
    enabled,
  })

export const useImportDrivers = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: ImportDriversBody) => apiSend<ImportJob>('POST', '/drivers/import', request),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  })
}

/** A change to the driver store, refreshing it once it's made. */
const useDriverMutation = <T>(mutationFn: (input: T) => Promise<unknown>) => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drivers'] }) })
}

export const useAddDriverGroup = () => useDriverMutation((group: NewDriverGroup) => apiSend('POST', '/drivers/groups', group))

export const useChangeDriverGroup = () =>
  useDriverMutation(({ name, changes }: { name: string; changes: DriverGroupChanges }) =>
    apiSend('PUT', `/drivers/groups/${encodeURIComponent(name)}`, changes),
  )

export const useRemoveDriverGroup = () =>
  useDriverMutation((name: string) => apiSend('DELETE', `/drivers/groups/${encodeURIComponent(name)}`))

export const useChangeDriverPackage = () =>
  useDriverMutation(({ id, changes }: { id: string; changes: DriverPackageChanges }) =>
    apiSend('PUT', `/drivers/packages/${encodeURIComponent(id)}`, changes),
  )

export const useDriverPackageBatch = () => useDriverMutation((batch: DriverPackageBatch) => apiSend('POST', '/drivers/packages/batch', batch))

export type ImageAction = 'enable' | 'disable' | 'remove'

export interface ImageActionInput {
  kind: ImageKind
  action: ImageAction
  name: string
  architecture?: string
  imageGroup?: string
  fileName?: string
}

export const useImageAction = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, action, ...image }: ImageActionInput) =>
      apiSend('POST', `/${kind === 'boot' ? 'boot-images' : 'install-images'}/${action}`, image),
    onSuccess: (_, input) =>
      queryClient.invalidateQueries({ queryKey: [input.kind === 'boot' ? 'boot-images' : 'install-images'] }),
  })
}

/** Which image to change: name plus architecture (boot) or group (install); the file tells apart namesakes. */
export interface ImageRef {
  name: string
  architecture?: string
  imageGroup?: string | null
  fileName?: string | null
}

/** Null leaves a property as it is. */
export interface ImageChanges {
  newName?: string | null
  newDescription?: string | null
  displayOrder?: number | null
  unattendXml?: string | null
  removeUnattend?: boolean
}

export const useSetImageProperties = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, image, changes }: { kind: ImageKind; image: ImageRef; changes: ImageChanges }) =>
      apiSend('PUT', `/${kind === 'boot' ? 'boot-images' : 'install-images'}/properties`, { ...image, ...changes }),
    onSuccess: (_, input) => {
      void queryClient.invalidateQueries({ queryKey: [input.kind === 'boot' ? 'boot-images' : 'install-images'] })
      void queryClient.invalidateQueries({ queryKey: ['image-unattend'] })
    },
  })
}

/** An install image's unattend file, read when `image` is given. */
export const useImageUnattend = (image: ImageRef | null) =>
  useQuery({
    queryKey: ['image-unattend', image?.name, image?.imageGroup, image?.fileName],
    queryFn: ({ signal }) => {
      const query = new URLSearchParams({ name: image!.name })
      if (image?.imageGroup) query.set('imageGroup', image.imageGroup)
      if (image?.fileName) query.set('fileName', image.fileName)
      return apiGet<ImageUnattend>(`/install-images/unattend?${query}`, signal)
    },
    enabled: image !== null,
  })

export const useApplySettings = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ group, body }: { group: SettingsGroup; body: unknown }) =>
      apiSend<SettingsResult>('PUT', `/server/settings/${group}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['server-config'] }),
  })
}

export const useRestartWds = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiSend<{ status: string }>('POST', '/server/restart'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['target'] })
      void queryClient.invalidateQueries({ queryKey: ['server-config'] })
    },
  })
}

/** A change to devices, refreshing the device list once it's made. */
const useDeviceMutation = <T>(mutationFn: (input: T) => Promise<unknown>) => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }) })
}

export const useAddDevice = () => useDeviceMutation((device: NewDevice) => apiSend('POST', '/devices', device))

export const useChangeDevice = () =>
  useDeviceMutation(({ name, changes }: { name: string; changes: DeviceChanges }) =>
    apiSend('PUT', `/devices/${encodeURIComponent(name)}`, changes),
  )

export const useRemoveDevice = () => useDeviceMutation((name: string) => apiSend('DELETE', `/devices/${encodeURIComponent(name)}`))

export const useAnswerDeviceRequest = () =>
  useDeviceMutation(({ requestId, approval }: { requestId: number; approval: DeviceApproval | 'reject' }) =>
    approval === 'reject'
      ? apiSend('POST', `/devices/requests/${requestId}/reject`)
      : apiSend('POST', `/devices/requests/${requestId}/approve`, approval),
  )

export const useClearDeviceRequests = () =>
  useDeviceMutation((cleared: ClearedRequests) => apiSend('POST', '/devices/requests/clear', cleared))

/** Allows or blocks hands-free deployment (the CVE-2026-0386 override). */
export const useSetHandsFree = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (allow: boolean) => apiSend<{ allowHandsFreeFunctionality: number }>('PUT', '/server/hands-free', { allow }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['server-config'] }),
  })
}

export const useRemoveImageGroup = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => apiSend('POST', '/image-groups/remove', { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['install-images'] }),
  })
}
