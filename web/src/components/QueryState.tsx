import { Alert, Button, Center, Group, Loader, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'

interface QueryStateProps<T> {
  query: UseQueryResult<T>
  children: (data: T) => ReactNode
}

const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' })

/**
 * A spinner while the query loads; the server's own error and a retry button if it fails. If a later refresh
 * fails, what was loaded stays on screen under a note saying so.
 */
export function QueryState<T>({ query, children }: QueryStateProps<T>) {
  if (query.isPending) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    )
  }

  if (query.isLoadingError) {
    return (
      <Alert color="red" icon={<IconAlertTriangle />} title="Couldn't load this from the WDS server" m="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {query.error.message}
          </Text>
          <Button size="xs" variant="light" color="red" onClick={() => query.refetch()} loading={query.isFetching}>
            Retry
          </Button>
        </Group>
      </Alert>
    )
  }

  return (
    <>
      {query.isRefetchError && (
        <Alert color="yellow" icon={<IconAlertTriangle />} p="xs" mb="sm">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
              Couldn't refresh at {time.format(query.errorUpdatedAt)}, so this is from {time.format(query.dataUpdatedAt)}:{' '}
              {query.error.message}
            </Text>
            <Button size="compact-xs" variant="light" color="yellow" onClick={() => query.refetch()} loading={query.isFetching}>
              Retry
            </Button>
          </Group>
        </Alert>
      )}
      {children(query.data)}
    </>
  )
}
