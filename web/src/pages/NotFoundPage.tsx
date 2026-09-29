import { Anchor, Stack, Title } from '@mantine/core'
import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <Stack align="center" py="xl">
      <Title order={3}>Page not found</Title>
      <Anchor component={Link} to="/">
        Back to the dashboard
      </Anchor>
    </Stack>
  )
}
