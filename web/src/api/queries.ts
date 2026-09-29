import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'
import type {
  ActivityResponse,
  ConnectionInfo,
  Devices,
  EventsResponse,
  InstallImages,
  ServerConfig,
  TargetInfo,
  WdsRecord,
} from './types'

export const useConnection = () =>
  useQuery({
    queryKey: ['connection'],
    queryFn: ({ signal }) => apiGet<ConnectionInfo>('/connection', signal),
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
    queryFn: ({ signal }) => apiGet<WdsRecord[]>('/drivers', signal),
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
