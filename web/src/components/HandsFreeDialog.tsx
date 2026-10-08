import { Alert, Button, Checkbox, Group, Modal, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconShieldLock } from '@tabler/icons-react'
import { useState } from 'react'
import { useRestartWds, useSetHandsFree } from '../api/queries'

/**
 * Allows or blocks hands-free deployment: WDS handing the WDS client unattend file to clients that
 * haven't authenticated. Allowing it reopens CVE-2026-0386, so that needs the risk acknowledged.
 */
export function HandsFreeDialog({ opened, allowed, onClose }: { opened: boolean; allowed: boolean; onClose: () => void }) {
  return (
    <Modal opened={opened} onClose={onClose} title={allowed ? 'Block hands-free deployment?' : 'Allow hands-free deployment?'} size="lg" centered>
      {opened && <HandsFreeForm allowed={allowed} onDone={onClose} />}
    </Modal>
  )
}

function HandsFreeForm({ allowed, onDone }: { allowed: boolean; onDone: () => void }) {
  const setHandsFree = useSetHandsFree()
  const restart = useRestartWds()
  const [understood, setUnderstood] = useState(false)
  const [restartNow, setRestartNow] = useState(true)
  const error = setHandsFree.error ?? restart.error

  const apply = async () => {
    try {
      await setHandsFree.mutateAsync(!allowed)
      if (restartNow) await restart.mutateAsync()
      notifications.show({
        color: allowed ? 'green' : 'orange',
        message: `Hands-free deployment is ${allowed ? 'blocked' : 'allowed'}${restartNow ? ', and WDS has restarted' : '. Restart WDS to be sure it takes effect'}.`,
      })
      onDone()
    } catch {
      // Shown from the mutations' errors.
    }
  }

  return (
    <Stack>
      {allowed ? (
        <Text size="sm">
          WDS will stop handing the WDS client unattend file to clients that haven't authenticated, as Microsoft's April 2026 update
          intends. The WDS client then asks its questions (language, sign-in, which image) at each machine.
        </Text>
      ) : (
        <>
          <Text size="sm">
            With hands-free deployment, the WDS client takes its answers (language, the account to connect with, which image to install)
            from the WDS client unattend file, so machines install without anyone at them.
          </Text>
          <Alert color="red" icon={<IconAlertTriangle />} title="This reopens a security hole">
            Any device on the network can then download the WDS client unattend file without signing in, including any user name and
            password in it (CVE-2026-0386). Allow it only on an isolated deployment network, and give the unattend file an account that can
            do nothing but read images.
          </Alert>
          <Checkbox
            label="I understand that anyone on this network could read the unattend file"
            checked={understood}
            onChange={(e) => setUnderstood(e.currentTarget.checked)}
          />
        </>
      )}
      <Checkbox
        label="Restart WDS now so the change takes effect"
        description="Any PXE boot or download in progress is cut off."
        checked={restartNow}
        onChange={(e) => setRestartNow(e.currentTarget.checked)}
      />
      {error && (
        <Alert color="red" icon={<IconAlertTriangle />}>
          {error.message}
        </Alert>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onDone}>
          Cancel
        </Button>
        {allowed ? (
          <Button leftSection={<IconShieldLock size={16} />} onClick={apply} loading={setHandsFree.isPending || restart.isPending}>
            Block
          </Button>
        ) : (
          <Button color="red" onClick={apply} loading={setHandsFree.isPending || restart.isPending} disabled={!understood}>
            Allow hands-free deployment
          </Button>
        )}
      </Group>
    </Stack>
  )
}
