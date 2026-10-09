import { Alert, Button, Card, Center, Modal, PasswordInput, Stack, Text, TextInput, ThemeIcon, Title } from '@mantine/core'
import { IconAlertTriangle, IconServer } from '@tabler/icons-react'
import { useState } from 'react'
import { useSignIn } from '../api/queries'

/** Sign in with a Windows account that's allowed on the WDS server (by default, its administrators). */
export function SignInPage({ server }: { server: string }) {
  return (
    <Center mih="100vh" p="md">
      <Card withBorder padding="xl" w={400} maw="100%">
        <SignInForm server={server} />
      </Card>
    </Center>
  )
}

/**
 * The session ended while the console was open (it expired, or the service restarted): sign in again over the
 * page, so the dialogs and work in progress underneath stay as they were.
 */
export function SignInAgain({ server, userName }: { server: string; userName: string | null }) {
  return (
    <Modal opened onClose={() => {}} withCloseButton={false} closeOnClickOutside={false} closeOnEscape={false} centered size="sm">
      <SignInForm server={server} userName={userName} expired />
    </Modal>
  )
}

function SignInForm({ server, userName: lastUser = null, expired = false }: { server: string; userName?: string | null; expired?: boolean }) {
  const signIn = useSignIn()
  const [userName, setUserName] = useState(lastUser ?? '')
  const [password, setPassword] = useState('')

  return (
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
          <Title order={3}>{expired ? 'Sign in again' : 'WDS Console'}</Title>
          <Text size="sm" c="dimmed" mt={4}>
            {expired
              ? 'Your session has ended. Sign in to carry on where you were; nothing on the page is lost.'
              : `Sign in with your Windows account, such as DOMAIN\\you or you@domain, to manage WDS on ${server}.`}
          </Text>
        </div>
        <TextInput
          label="User name"
          autoComplete="username"
          value={userName}
          onChange={(event) => setUserName(event.currentTarget.value)}
          required
          autoFocus={!lastUser}
        />
        <PasswordInput
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          required
          autoFocus={!!lastUser}
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
  )
}
