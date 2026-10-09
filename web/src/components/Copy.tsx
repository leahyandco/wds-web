import { ActionIcon, Box, Code, Group, Text, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconCopy } from '@tabler/icons-react'
import { useEffect, useState, type ReactNode } from 'react'

/** Copies text, falling back to the old way where the page isn't served securely (the demo on another machine, say). */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Try the old way.
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  Object.assign(area.style, { position: 'fixed', top: '0', opacity: '0' })
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand('copy')
  } finally {
    area.remove()
  }
}

/** A small button that copies a value, and says so when it has. */
export function CopyIcon({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <Tooltip label={copied ? 'Copied' : label} withArrow>
      <ActionIcon
        variant="subtle"
        color={copied ? 'teal' : 'gray'}
        size="sm"
        aria-label={label}
        // In a row that opens on click or Enter, copying shouldn't also open it.
        onKeyDown={(event) => event.stopPropagation()}
        onClick={async (event) => {
          event.stopPropagation()
          if (await copyText(value)) setCopied(true)
          else notifications.show({ color: 'red', message: "Couldn't copy to the clipboard" })
        }}
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </ActionIcon>
    </Tooltip>
  )
}

/** A value, such as a MAC address, with a button that copies it. */
export function CopyValue({ value, label, children, monospace }: { value: string; label: string; children?: ReactNode; monospace?: boolean }) {
  return (
    <Group gap={4} wrap="nowrap">
      <Text size="sm" ff={monospace ? 'monospace' : undefined} style={{ wordBreak: 'break-all' }}>
        {children ?? value}
      </Text>
      <CopyIcon value={value} label={label} />
    </Group>
  )
}

/** A block of text, such as a log, with a button in its corner that copies all of it. */
export function CopyCode({ value, label }: { value: string; label: string }) {
  return (
    <Box pos="relative">
      <Code block pr={40}>
        {value}
      </Code>
      <Box pos="absolute" top={6} right={6}>
        <CopyIcon value={value} label={label} />
      </Box>
    </Box>
  )
}
