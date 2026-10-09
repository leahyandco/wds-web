import { Button, Group, Text, Title } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  onRefresh?: () => void
  refreshing?: boolean
  /** Buttons shown before Refresh, such as "Import". */
  actions?: ReactNode
}

/** The page's title and buttons; on a narrow screen the buttons wrap below the title. */
export function PageHeader({ title, description, onRefresh, refreshing, actions }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="flex-end" mb="lg" gap="sm">
      <div style={{ flex: '1 1 20rem', minWidth: 0 }}>
        <Title order={2}>{title}</Title>
        {description && (
          <Text c="dimmed" size="sm" mt={4}>
            {description}
          </Text>
        )}
      </div>
      <Group gap="sm">
        {actions}
        {onRefresh && (
          <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={onRefresh} loading={refreshing}>
            Refresh
          </Button>
        )}
      </Group>
    </Group>
  )
}
