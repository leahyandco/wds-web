import type { DriverGroupFilter } from '../api/types'

/** WDS's driver group filter types, as WDSUTIL takes them, with what they match on the client. */
export const filterTypes: { value: string; label: string; hint: string }[] = [
  { value: 'Manufacturer', label: 'Manufacturer', hint: 'As the firmware reports it, e.g. Dell Inc., HP or LENOVO (Win32_ComputerSystem.Manufacturer).' },
  { value: 'Model', label: 'Model', hint: 'As the firmware reports it, e.g. Latitude 5450 (Win32_ComputerSystem.Model).' },
  { value: 'ChassisType', label: 'Chassis type', hint: 'The kind of case the firmware reports, such as Laptop or Desktop.' },
  { value: 'BiosVendor', label: 'BIOS vendor', hint: 'The firmware maker (Win32_BIOS.Manufacturer).' },
  { value: 'BiosVersion', label: 'BIOS version', hint: 'The firmware version (Win32_BIOS.SMBIOSBIOSVersion).' },
  { value: 'UUID', label: 'SMBIOS GUID', hint: 'The machine’s GUID, which Boot activity shows as its device ID.' },
  { value: 'OsVersion', label: 'Windows version', hint: 'Of the image being installed.' },
  { value: 'OsEdition', label: 'Windows edition', hint: 'Of the image being installed.' },
  { value: 'OsLanguage', label: 'Windows language', hint: 'Of the image being installed, e.g. en-US.' },
  { value: 'ImageID', label: 'Install image', hint: 'The install image’s ID.' },
  { value: 'DeviceGroup', label: 'Device group', hint: 'The group a prestaged device is in.' },
]

/** Chassis types, as WDSUTIL takes them. */
export const chassisTypes: { value: string; label: string }[] = [
  { value: 'Desktop', label: 'Desktop' },
  { value: 'LowProfileDesktop', label: 'Low-profile desktop' },
  { value: 'MiniTower', label: 'Mini tower' },
  { value: 'Tower', label: 'Tower' },
  { value: 'AllInOne', label: 'All-in-one' },
  { value: 'SpaceSaving', label: 'Space-saving' },
  { value: 'Portable', label: 'Portable' },
  { value: 'Laptop', label: 'Laptop' },
  { value: 'Notebook', label: 'Notebook' },
  { value: 'SubNotebook', label: 'Sub-notebook' },
  { value: 'Handheld', label: 'Handheld' },
  { value: 'DockingStation', label: 'Docking station' },
  { value: 'PizzaBox', label: 'Pizza box' },
  { value: 'LunchBox', label: 'Lunch box' },
  { value: 'MainSystemChassis', label: 'Main system chassis' },
  { value: 'ExpansionChassis', label: 'Expansion chassis' },
  { value: 'SubChassis', label: 'Sub-chassis' },
  { value: 'BusExpansionChassis', label: 'Bus expansion chassis' },
  { value: 'PeripheralChassis', label: 'Peripheral chassis' },
  { value: 'StorageChassis', label: 'Storage chassis' },
  { value: 'RackMountChassis', label: 'Rack mount' },
  { value: 'SealedCaseComputer', label: 'Sealed-case computer' },
  { value: 'MultiSystemChassis', label: 'Multi-system chassis' },
  { value: 'CompactPci', label: 'CompactPCI' },
  { value: 'AdvancedTca', label: 'AdvancedTCA' },
  { value: 'Other', label: 'Other' },
  { value: 'UnknownChassis', label: 'Unknown' },
]

export const architectures = [
  { value: 'x64', label: 'x64' },
  { value: 'x86', label: 'x86' },
  { value: 'arm64', label: 'ARM64' },
  { value: 'arm', label: 'ARM' },
]

export const filterLabel = (type: string) => filterTypes.find((t) => t.value === type)?.label ?? type

const chassisLabel = (value: string) => chassisTypes.find((c) => c.value === value)?.label ?? value

/** "Model is Latitude 5440 or Latitude 5450", "Chassis type isn’t Desktop, Mini tower or Tower". */
export function describeFilter(filter: DriverGroupFilter): string {
  const values = filter.values.map((v) => (filter.type === 'ChassisType' ? chassisLabel(v) : v))
  const list = values.length > 1 ? `${values.slice(0, -1).join(', ')} or ${values[values.length - 1]}` : values[0]
  return `${filterLabel(filter.type)} ${filter.policy === 'Exclude' ? 'isn’t' : 'is'} ${list}`
}
