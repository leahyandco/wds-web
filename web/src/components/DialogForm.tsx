import { Stack, type StackProps } from '@mantine/core'
import type { ReactNode } from 'react'

interface DialogFormProps extends StackProps {
  onSubmit: () => void
  /** Whether what's filled in can be submitted; Enter does nothing until it can. */
  canSubmit: boolean
  children: ReactNode
}

/** A dialog's fields as a form, so Enter in a field does what its submit button (type="submit") does. */
export function DialogForm({ onSubmit, canSubmit, children, ...stackProps }: DialogFormProps) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) onSubmit()
      }}
    >
      <Stack {...stackProps}>{children}</Stack>
    </form>
  )
}
