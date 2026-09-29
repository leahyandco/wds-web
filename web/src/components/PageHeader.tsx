import { Button, Group, Text, Title } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'

interface PageHeaderProps {
  title: string
  description?: string
  onRefresh?: () => void
  refreshing?: boolean
}

export function PageHeader({ title, description, onRefresh, refreshing }: PageHeaderProps) {
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
      {onRefresh && (
        <Button
          variant="default"
          leftSection={<IconRefresh size={16} />}
          onClick={onRefresh}
          loading={refreshing}
          style={{ flexShrink: 0 }}
        >
          Refresh
        </Button>
      )}
    </Group>
  )
}
