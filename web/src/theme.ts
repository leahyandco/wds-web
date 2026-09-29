import { Badge, createTheme } from '@mantine/core'

export const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
  fontFamilyMonospace: '"Cascadia Mono", Consolas, ui-monospace, monospace',
  components: {
    // Badges carry states such as "Enabled" or "Failed"; never let a table squeeze them to "E…".
    Badge: Badge.extend({ styles: { root: { minWidth: 'max-content' } } }),
  },
})
