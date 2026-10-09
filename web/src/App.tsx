import { Alert, Button, Center, Loader, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router'
import { SIGNED_OUT_EVENT } from './api/client'
import { useSession } from './api/queries'
import type { SessionInfo } from './api/types'
import { AppLayout } from './components/AppLayout'
import { ActivityPage } from './pages/ActivityPage'
import { BootImagesPage } from './pages/BootImagesPage'
import { DashboardPage } from './pages/DashboardPage'
import { DevicesPage } from './pages/DevicesPage'
import { DriversPage } from './pages/DriversPage'
import { EventsPage } from './pages/EventsPage'
import { InstallImagesPage } from './pages/InstallImagesPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ServerSettingsPage } from './pages/ServerSettingsPage'
import { SignInAgain, SignInPage } from './pages/SignInPage'

export function App() {
  const session = useSession()
  const queryClient = useQueryClient()

  // Any 401 means the session ended (expired, or the service restarted with new keys).
  useEffect(() => {
    const signedOut = () =>
      queryClient.setQueryData<SessionInfo>(['session'], (current) => (current ? { ...current, authenticated: false, userName: null } : current))
    window.addEventListener(SIGNED_OUT_EVENT, signedOut)
    return () => window.removeEventListener(SIGNED_OUT_EVENT, signedOut)
  }, [queryClient])

  // Who was signed in on this page, if anyone: once someone has been, a lost session is a sign-in over the
  // page rather than a page of its own, so what's open underneath survives it.
  const [lastUser, setLastUser] = useState<string | null | undefined>(undefined)
  if (session.data?.authenticated && lastUser !== (session.data.userName ?? null)) setLastUser(session.data.userName ?? null)

  if (session.isPending) {
    return (
      <Center mih="100vh">
        <Loader />
      </Center>
    )
  }
  if (session.isError) return <ServiceUnreachable message={session.error.message} onRetry={session.refetch} retrying={session.isFetching} />
  if (!session.data.authenticated && lastUser === undefined) return <SignInPage server={session.data.server} />

  return (
    <>
      {!session.data.authenticated && <SignInAgain server={session.data.server} userName={lastUser ?? null} />}
      <AppRoutes session={session.data} />
    </>
  )
}

function AppRoutes({ session }: { session: SessionInfo }) {
  return (
    <Routes>
      <Route element={<AppLayout session={session} />}>
        <Route index element={<DashboardPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="boot-images" element={<BootImagesPage />} />
        <Route path="install-images" element={<InstallImagesPage />} />
        <Route path="drivers" element={<DriversPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="server" element={<ServerSettingsPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

const RETRY_SECONDS = 5

/** The service didn't answer, usually because it's restarting (after an update, say): keep trying until it does. */
function ServiceUnreachable({ message, onRetry, retrying }: { message: string; onRetry: () => unknown; retrying: boolean }) {
  useEffect(() => {
    const timer = setInterval(onRetry, RETRY_SECONDS * 1000)
    return () => clearInterval(timer)
  }, [onRetry])

  return (
    <Center mih="100vh" p="md">
      <Alert color="red" icon={<IconAlertTriangle />} title="Can't reach the WDS Console service" maw={480}>
        <Text size="sm">{message}</Text>
        <Text size="sm" c="dimmed" mt="xs">
          Trying again every {RETRY_SECONDS} seconds; this page carries on by itself once the service answers.
        </Text>
        <Button mt="sm" size="xs" variant="light" color="red" onClick={onRetry} loading={retrying}>
          Try now
        </Button>
      </Alert>
    </Center>
  )
}
