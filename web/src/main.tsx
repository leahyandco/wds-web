import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import { theme } from './theme'

const queryClient = new QueryClient({
  defaultOptions: {
    // Each query is a PowerShell round trip to the WDS server and the data rarely changes, so
    // don't refetch on every window focus.
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          {/* Inside the router, so a notification can link to a page. */}
          <Notifications />
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
)
