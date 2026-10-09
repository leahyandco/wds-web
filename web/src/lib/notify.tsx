import { Button, Group, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'

/** Says a change worked. With `undo`, the notification offers to reverse it. */
export function showDone(message: string, undo?: () => Promise<unknown>) {
  if (!undo) {
    notifications.show({ color: 'green', message })
    return
  }
  const id = notifications.show({
    color: 'green',
    // Long enough to notice a mistake and reach for Undo.
    autoClose: 10_000,
    message: (
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Text size="sm">{message}</Text>
        <Button
          size="compact-xs"
          variant="subtle"
          onClick={async () => {
            notifications.hide(id)
            try {
              await undo()
              notifications.show({ color: 'green', message: 'Undone' })
            } catch (error) {
              notifications.show({ color: 'red', title: "Couldn't undo it", message: error instanceof Error ? error.message : String(error) })
            }
          }}
        >
          Undo
        </Button>
      </Group>
    ),
  })
}
