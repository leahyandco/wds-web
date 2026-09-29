// Windows releases by build number, as WDS reports image versions (major.minor.build).
const releases: [build: number, name: string][] = [
  [28000, 'Windows 11 26H1'],
  [26200, 'Windows 11 25H2'],
  [26100, 'Windows 11 24H2 / Server 2025'],
  // Also the WinPE in ADK 10.1.25398, which MDT setups often pin.
  [25398, 'Server 23H2 / ADK 25398'],
  [22631, 'Windows 11 23H2'],
  [22621, 'Windows 11 22H2'],
  [22000, 'Windows 11 21H2'],
  [20348, 'Server 2022'],
  [19041, 'Windows 10 2004–22H2'],
  [18362, 'Windows 10 1903/1909'],
  [17763, 'Windows 10 1809 / Server 2019'],
  [17134, 'Windows 10 1803'],
  [16299, 'Windows 10 1709'],
  [15063, 'Windows 10 1703'],
  [14393, 'Windows 10 1607 / Server 2016'],
  [10240, 'Windows 10 1507'],
  [9600, 'Windows 8.1 / Server 2012 R2'],
]

/** The Windows release a build belongs to, e.g. "10.0.19041" → "Windows 10 2004–22H2". */
export function windowsRelease(version: unknown): string | null {
  if (typeof version !== 'string') return null
  const build = Number(version.split('.')[2])
  if (!Number.isFinite(build)) return null
  const exact = releases.find(([b]) => b === build)
  if (exact) return exact[1]
  // Windows 10 2004 to 22H2 share the 19041 base and report 19041-19045.
  if (build >= 19041 && build <= 19045) return 'Windows 10 2004–22H2'
  return null
}
