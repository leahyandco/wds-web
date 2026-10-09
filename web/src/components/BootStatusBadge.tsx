import { Badge, Tooltip, VisuallyHidden } from '@mantine/core'
import type { BootStatus } from '../api/types'
import { bootStatus } from '../lib/boot'

/** A boot's status, explained on hover, and read out in full by screen readers. */
export function BootStatusBadge({ status }: { status: BootStatus }) {
  const { label, color, description } = bootStatus[status]
  return (
    <Tooltip label={description} multiline maw={280}>
      <Badge color={color} variant="light" tt="none">
        {label}
        <VisuallyHidden>: {description}</VisuallyHidden>
      </Badge>
    </Tooltip>
  )
}
