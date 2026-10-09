import { Badge, Tooltip, VisuallyHidden } from '@mantine/core'
import type { DeploymentStage } from '../api/types'
import { deploymentStage } from '../lib/deployments'

/** How far an install got, explained on hover, and read out in full by screen readers. */
export function DeploymentStageBadge({ stage }: { stage: DeploymentStage }) {
  const { label, color, description } = deploymentStage[stage]
  return (
    <Tooltip label={description} multiline w={260} withArrow>
      <Badge color={color} variant="light" tt="none">
        {label}
        <VisuallyHidden>: {description}</VisuallyHidden>
      </Badge>
    </Tooltip>
  )
}
