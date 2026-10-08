import type { DeploymentStage } from '../api/types'

/** How each stage of an install is shown. */
export const deploymentStage: Record<DeploymentStage, { label: string; color: string; description: string }> = {
  started: { label: 'WDS client started', color: 'blue', description: 'Windows Setup started in WDS mode and is waiting for an image to be chosen.' },
  imageSelected: { label: 'Image chosen', color: 'blue', description: 'An install image was chosen.' },
  transferring: { label: 'Downloading image', color: 'cyan', description: 'The install image is downloading from WDS.' },
  applying: { label: 'Applying image', color: 'indigo', description: 'The install image is being written to the disk.' },
  finishing: { label: 'Finishing', color: 'violet', description: 'Adding drivers, the unattend file and boot files.' },
  finished: {
    label: 'Image applied',
    color: 'green',
    description: 'The WDS client finished. Windows Setup carries on from the disk after a restart, which WDS no longer sees.',
  },
  failed: { label: 'Install failed', color: 'red', description: 'The WDS client reported an error it could not get past.' },
}
