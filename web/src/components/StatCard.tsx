import { Card, Group, Text, ThemeIcon, UnstyledButton } from '@mantine/core'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

interface StatCardProps {
  label: string
  value: ReactNode
  detail?: ReactNode
  icon: ReactNode
  color?: string
  to: string
}

export function StatCard({ label, value, detail, icon, color = 'blue', to }: StatCardProps) {
  return (
    <UnstyledButton component={Link} to={to}>
      <Card withBorder padding="lg" h="100%">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              {label}
            </Text>
            <Text fz={28} fw={700} lh={1.2} mt={6}>
              {value}
            </Text>
            {detail && (
              <Text size="sm" c="dimmed" mt={4}>
                {detail}
              </Text>
            )}
          </div>
          <ThemeIcon variant="light" color={color} size={40} radius="md">
            {icon}
          </ThemeIcon>
        </Group>
      </Card>
    </UnstyledButton>
  )
}
