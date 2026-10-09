import {
  ActionIcon,
  AppShell,
  Badge,
  Burger,
  Button,
  Group,
  Menu,
  NavLink,
  Text,
  Title,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import {
  IconCpu,
  IconDevices,
  IconDisc,
  IconHistory,
  IconLayoutDashboard,
  IconListDetails,
  IconLogout,
  IconMoon,
  IconRocket,
  IconSettings,
  IconSun,
  IconUser,
} from '@tabler/icons-react'
import { Outlet, NavLink as RouterNavLink, useLocation } from 'react-router'
import { useConnection, useConsoleInfo, useSignOut, useTarget } from '../api/queries'
import type { SessionInfo } from '../api/types'

const links = [
  { to: '/', label: 'Dashboard', icon: IconLayoutDashboard },
  { to: '/activity', label: 'Boot activity', icon: IconHistory },
  { to: '/boot-images', label: 'Boot images', icon: IconRocket },
  { to: '/install-images', label: 'Install images', icon: IconDisc },
  { to: '/drivers', label: 'Drivers', icon: IconCpu },
  { to: '/devices', label: 'Devices', icon: IconDevices },
  { to: '/server', label: 'Server settings', icon: IconSettings },
  { to: '/events', label: 'Events', icon: IconListDetails },
]

export function AppLayout({ session }: { session: SessionInfo }) {
  const [opened, { toggle, close }] = useDisclosure()
  const { pathname } = useLocation()

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 230, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="lg"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <Title order={4} style={{ whiteSpace: 'nowrap' }}>
              WDS Console
            </Title>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <ServerStatus />
            {session.authEnabled && session.userName && <UserMenu userName={session.userName} />}
            <ColorSchemeToggle />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <AppShell.Section grow>
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              component={RouterNavLink}
              to={to}
              label={label}
              leftSection={<Icon size={18} stroke={1.6} />}
              active={to === '/' ? pathname === '/' : pathname.startsWith(to)}
              onClick={close}
            />
          ))}
        </AppShell.Section>
        <AppShell.Section>
          <Version />
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  )
}

/** Which server the console manages, and whether the last call to it worked. */
function ServerStatus() {
  const connection = useConnection()
  const target = useTarget()

  const color = target.isError ? 'red' : target.isSuccess ? 'green' : 'gray'
  const tooltip = target.isError
    ? target.error.message
    : target.data
      ? `${target.data.osCaption}, build ${target.data.osBuild}`
      : 'Connecting…'

  return (
    <Tooltip label={tooltip} multiline maw={360}>
      {/* On a phone a long server name is cut short, to leave room for the title and buttons beside it. */}
      <Badge variant="dot" color={color} size="lg" tt="none" maw={{ base: 130, sm: 360 }} styles={{ root: { minWidth: 0 } }}>
        {connection.data?.target ?? '…'}
        {connection.data?.mode === 'Remote' ? ' (remote)' : connection.data?.mode === 'Demo' ? ' (demo)' : ''}
      </Badge>
    </Tooltip>
  )
}

function Version() {
  const { data } = useConsoleInfo()
  if (!data) return null
  return (
    <Text size="xs" c="dimmed" px="sm" py={6}>
      WDS Console {data.version}
    </Text>
  )
}

/** Who's signed in, and Sign out: a button with the name, or on a phone an icon whose menu names them. */
function UserMenu({ userName }: { userName: string }) {
  const signOut = useSignOut()
  const dropdown = (
    <Menu.Dropdown>
      <Menu.Label>Signed in as {userName}</Menu.Label>
      <Menu.Item leftSection={<IconLogout size={14} />} onClick={() => signOut.mutate()}>
        Sign out
      </Menu.Item>
    </Menu.Dropdown>
  )
  return (
    <>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Button variant="default" leftSection={<IconUser size={16} />} loading={signOut.isPending} visibleFrom="sm">
            {userName}
          </Button>
        </Menu.Target>
        {dropdown}
      </Menu>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="default" size="lg" aria-label={`Signed in as ${userName}`} loading={signOut.isPending} hiddenFrom="sm">
            <IconUser size={18} />
          </ActionIcon>
        </Menu.Target>
        {dropdown}
      </Menu>
    </>
  )
}

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme()
  const dark = useComputedColorScheme('light') === 'dark'

  return (
    <ActionIcon
      variant="default"
      size="lg"
      onClick={() => setColorScheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Use light theme' : 'Use dark theme'}
    >
      {dark ? <IconSun size={18} /> : <IconMoon size={18} />}
    </ActionIcon>
  )
}
