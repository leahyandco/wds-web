import { Route, Routes } from 'react-router'
import { AppLayout } from './components/AppLayout'
import { ActivityPage } from './pages/ActivityPage'
import { BootImagesPage } from './pages/BootImagesPage'
import { DashboardPage } from './pages/DashboardPage'
import { DevicesPage } from './pages/DevicesPage'
import { DriversPage } from './pages/DriversPage'
import { EventsPage } from './pages/EventsPage'
import { InstallImagesPage } from './pages/InstallImagesPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ServerSettingsPage } from './pages/ServerSettingsPage'

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="boot-images" element={<BootImagesPage />} />
        <Route path="install-images" element={<InstallImagesPage />} />
        <Route path="drivers" element={<DriversPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="server" element={<ServerSettingsPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
