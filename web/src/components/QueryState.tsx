import { Alert, Button, Center, Group, Loader, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'

interface QueryStateProps<T> {
  query: UseQueryResult<T>
  children: (data: T) => ReactNode
}

/** A spinner while the query loads; the server's own error and a retry button if it fails. */
export function QueryState<T>({ query, children }: QueryStateProps<T>) {
  if (query.isPending) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    )
  }

  if (query.isError) {
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

  return <>{children(query.data)}</>
}
