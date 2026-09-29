import { Badge, Tooltip } from '@mantine/core'
import type { BootStatus } from '../api/types'
import { bootStatus } from '../lib/boot'

export function BootStatusBadge({ status }: { status: BootStatus }) {
  const { label, color, description } = bootStatus[status]
  return (
    <Tooltip label={description} multiline maw={280}>
      <Badge color={color} variant="light" tt="none">
        {label}
      </Badge>
    </Tooltip>
  )
}
