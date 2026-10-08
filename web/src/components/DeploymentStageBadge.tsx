import { Badge, Tooltip } from '@mantine/core'
import type { DeploymentStage } from '../api/types'
import { deploymentStage } from '../lib/deployments'

export function DeploymentStageBadge({ stage }: { stage: DeploymentStage }) {
  const { label, color, description } = deploymentStage[stage]
  return (
    <Tooltip label={description} multiline w={260} withArrow>
      <Badge color={color} variant="light" tt="none">
        {label}
      </Badge>
    </Tooltip>
  )
}
