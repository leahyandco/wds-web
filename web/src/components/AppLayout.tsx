import {
  ActionIcon,
  AppShell,
  Badge,
  Burger,
  Group,
  NavLink,
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
  IconMoon,
  IconRocket,
  IconSettings,
  IconSun,
} from '@tabler/icons-react'
import { Outlet, NavLink as RouterNavLink, useLocation } from 'react-router'
import { useConnection, useTarget } from '../api/queries'

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

export function AppLayout() {
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
            <Title order={4}>WDS Console</Title>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <ServerStatus />
            <ColorSchemeToggle />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
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
      <Badge variant="dot" color={color} size="lg" tt="none">
        {connection.data?.target ?? '…'}
        {connection.data?.mode === 'Remote' ? ' (remote)' : ''}
      </Badge>
    </Tooltip>
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
