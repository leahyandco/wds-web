// Takes the README's screenshots (docs/images) from the demo, in the light and dark themes, with
// Microsoft Edge in headless mode, driven over the DevTools protocol: no packages to install.
//
// Start the demo first, serving the built frontend:
//   npm run build --prefix web
//   dotnet run --project src/WdsWeb.Api --launch-profile demo
// then: npm run screenshots --prefix web
//
// SCREENSHOT_URL points at another address; EDGE at another Chromium-based browser.
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const base = process.env.SCREENSHOT_URL ?? 'http://localhost:5080'
const edge = process.env.EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const output = fileURLToPath(new URL('../../docs/images/', import.meta.url))
const viewport = { width: 1440, height: 900 }

const shots = [
  { name: 'dashboard', path: '/' },
  { name: 'activity', path: '/activity' },
  // The demo's install under way, with its timeline.
  { name: 'install-detail', path: '/activity', open: '00-00-5E-00-53-41' },
  { name: 'boot-images', path: '/boot-images' },
  { name: 'drivers', path: '/drivers' },
  { name: 'devices', path: '/devices' },
  { name: 'server-settings', path: '/server' },
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Starts Edge headless and returns the DevTools address it prints on stderr. */
async function launchEdge() {
  const profile = await mkdtemp(join(tmpdir(), 'wdsweb-edge-'))
  const browser = spawn(
    edge,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  const url = await new Promise((resolve, reject) => {
    let text = ''
    browser.stderr.on('data', (chunk) => {
      text += chunk
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(text)
      if (match) resolve(match[1])
    })
    browser.on('error', reject)
    browser.on('exit', (code) => reject(new Error(`Edge exited (${code}) before it was ready:\n${text}`)))
  })
  return { browser, profile, url }
}

/** A minimal DevTools protocol client: commands, and waiting for an event. */
async function connect(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = () => reject(new Error(`Couldn't connect to ${url}`))
  })
  let next = 1
  const pending = new Map()
  const listeners = new Set()
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`))
      else resolve(message.result)
    } else {
      for (const listener of listeners) listener(message)
    }
  }
  return {
    send(method, params = {}, sessionId) {
      const id = next++
      socket.send(JSON.stringify({ id, method, params, sessionId }))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    },
    once(method, sessionId) {
      return new Promise((resolve) => {
        const listener = (message) => {
          if (message.method === method && message.sessionId === sessionId) {
            listeners.delete(listener)
            resolve(message.params)
          }
        }
        listeners.add(listener)
      })
    },
    close: () => socket.close(),
  }
}

/** Waits for the page's data: the app has rendered and nothing shows a loader, then for transitions. */
async function settle(page) {
  const ready = "document.querySelector('main h2') !== null && document.querySelectorAll('.mantine-Loader-root').length === 0"
  for (let attempt = 0; attempt < 75; attempt++) {
    const { result } = await page('Runtime.evaluate', { expression: ready, returnByValue: true })
    if (result.value) break
    await sleep(200)
  }
  await sleep(1000)
}

/** Clicks the table row containing some text, such as a MAC address, to open its details. */
async function openRow(page, text) {
  const expression = `(() => {
    const cell = [...document.querySelectorAll('td')].find((td) => td.textContent.includes(${JSON.stringify(text)}))
    cell?.closest('tr')?.click()
    return Boolean(cell)
  })()`
  const { result } = await page('Runtime.evaluate', { expression, returnByValue: true })
  if (!result.value) throw new Error(`There's no row with ${text} on the page.`)
  await sleep(1000)
  // The drawer focuses its close button, whose focus ring would show in the picture.
  await page('Runtime.evaluate', { expression: 'document.activeElement?.blur()' })
}

const { browser, profile, url } = await launchEdge()
try {
  const cdp = await connect(url)
  for (const scheme of ['light', 'dark']) {
    // A fresh page for each theme, so that nothing carries over between them.
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    const page = (method, params) => cdp.send(method, params, sessionId)
    await page('Page.enable')
    await page('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })

    for (const shot of shots) {
      const loaded = cdp.once('Page.loadEventFired', sessionId)
      await page('Page.navigate', { url: base + shot.path })
      await loaded
      await settle(page)
      if (shot.open) await openRow(page, shot.open)
      const { data } = await page('Page.captureScreenshot', { format: 'png' })
      const file = join(output, `${shot.name}-${scheme}.png`)
      await writeFile(file, Buffer.from(data, 'base64'))
      console.log(`Saved ${file}`)
    }
    await cdp.send('Target.closeTarget', { targetId })
  }
  cdp.close()
} finally {
  browser.kill()
  // Edge can hold its profile for a moment after exiting.
  await sleep(500)
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}
