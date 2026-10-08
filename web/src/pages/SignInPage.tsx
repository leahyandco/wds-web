import { Alert, Button, Card, Center, PasswordInput, Stack, Text, TextInput, ThemeIcon, Title } from '@mantine/core'
import { IconAlertTriangle, IconServer } from '@tabler/icons-react'
import { useState } from 'react'
import { useSignIn } from '../api/queries'

/** Sign in with a Windows account that's allowed on the WDS server (by default, its administrators). */
export function SignInPage({ server }: { server: string }) {
  const signIn = useSignIn()
  const [userName, setUserName] = useState('')
  const [password, setPassword] = useState('')

  return (
    <Center mih="100vh" p="md">
      <Card withBorder padding="xl" w={400} maw="100%">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            signIn.mutate({ userName: userName.trim(), password })
          }}
        >
          <Stack>
            <ThemeIcon size={44} radius="md" variant="light">
              <IconServer size={24} />
            </ThemeIcon>
            <div>
              <Title order={3}>WDS Console</Title>
              <Text size="sm" c="dimmed" mt={4}>
                Sign in with your Windows account, such as DOMAIN\you or you@domain, to manage WDS on {server}.
              </Text>
            </div>
            <TextInput
              label="User name"
              autoComplete="username"
              value={userName}
              onChange={(event) => setUserName(event.currentTarget.value)}
              required
              autoFocus
            />
            <PasswordInput
              label="Password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
            />
            {signIn.error && (
              <Alert color="red" icon={<IconAlertTriangle />}>
                {signIn.error.message}
              </Alert>
            )}
            <Button type="submit" loading={signIn.isPending}>
              Sign in
            </Button>
          </Stack>
        </form>
      </Card>
    </Center>
  )
}
