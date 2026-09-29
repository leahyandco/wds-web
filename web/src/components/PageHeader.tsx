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

export function PageHeader({ title, description, onRefresh, refreshing, actions }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="flex-end" mb="lg" wrap="nowrap">
      <div>
        <Title order={2}>{title}</Title>
        {description && (
          <Text c="dimmed" size="sm" mt={4}>
            {description}
          </Text>
        )}
      </div>
      <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
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
