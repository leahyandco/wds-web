import { Badge, Text } from '@mantine/core'
import { EMPTY } from '../lib/format'
import { windowsRelease } from '../lib/windows'

/** An image or package name, with its description underneath when that says something more. */
export function NameCell({ name, description }: { name: unknown; description?: unknown }) {
  const title = typeof name === 'string' && name ? name : EMPTY
  const detail = typeof description === 'string' && description && description !== name ? description : null
  return (
    <div>
      <Text size="sm" fw={500}>
        {title}
      </Text>
      {detail && (
        <Text size="xs" c="dimmed">
          {detail}
        </Text>
      )}
    </div>
  )
}

/** The Windows release a version belongs to, with the raw version underneath. */
export function VersionCell({ version }: { version: unknown }) {
  const release = windowsRelease(version)
  return (
    <div>
      <Text size="sm">{release ?? (typeof version === 'string' ? version : EMPTY)}</Text>
      {release && (
        <Text size="xs" c="dimmed">
          {String(version)}
        </Text>
      )}
    </div>
  )
}

export function EnabledBadge({ enabled }: { enabled: unknown }) {
  return enabled === false ? (
    <Badge color="gray" variant="light" tt="none">
      Disabled
    </Badge>
  ) : (
    <Badge color="green" variant="light" tt="none">
      Enabled
    </Badge>
  )
}
