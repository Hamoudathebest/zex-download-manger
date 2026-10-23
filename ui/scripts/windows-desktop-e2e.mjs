import { createHash, generateKeyPairSync } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const [appPath, repositoryRoot] = process.argv.slice(2)
if (!appPath || !repositoryRoot) {
  throw new Error('Usage: node windows-desktop-e2e.mjs <installed-app.exe> <repository-root>')
}

const timeout = 90_000
const fixtureBytes = 12 * 1024 * 1024
const fixture = Buffer.alloc(fixtureBytes)
for (let index = 0; index < fixture.length; index += 1) fixture[index] = (index * 31 + 7) & 0xff
const fixtureHash = createHash('sha256').update(fixture).digest('hex')
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zex-desktop-e2e-'))
const downloadDirectory = path.join(temporaryRoot, 'downloads')
await mkdir(downloadDirectory)

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/browser-test') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><title>ZEX browser integration test origin</title>')
    return
  }
  if (!['GET', 'HEAD'].includes(request.method ?? '') || !/^\/(paused|queued|cancelled|held|extension)\.bin$/.test(request.url ?? '')) {
    response.writeHead(404).end()
    return
  }
  const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
  const start = range ? Number(range[1]) : 0
  const end = range && range[2] ? Math.min(Number(range[2]), fixtureBytes - 1) : fixtureBytes - 1
  response.writeHead(range ? 206 : 200, {
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Type': 'application/octet-stream',
    ETag: '"zex-e2e-fixture-v1"',
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${fixtureBytes}` } : {}),
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  let offset = start
  const timer = setInterval(() => {
    if (response.destroyed) {
      clearInterval(timer)
      return
    }
    const next = Math.min(end + 1, offset + 32 * 1024)
    response.write(fixture.subarray(offset, next))
    offset = next
    if (offset > end) {
      clearInterval(timer)
      response.end()
    }
  }, 100)
  response.on('close', () => clearInterval(timer))
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const serverPort = server.address().port
const fixtureUrl = (name) => `http://127.0.0.1:${serverPort}/${name}.bin`

async function availablePort() {
  const probe = createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = probe.address().port
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitForCdp(port, process) {
  const urls = [
    `http://127.0.0.1:${port}/json/version`,
    `http://localhost:${port}/json/version`,
    `http://[::1]:${port}/json/version`,
  ]
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (process?.exitCode !== null && process?.exitCode !== undefined) {
      throw new Error(`Browser process exited before CDP initialized (exit ${process.exitCode}).\n${process.testLogs?.join('') ?? ''}`)
    }
    for (const url of urls) {
      try {
        const response = await fetch(url)
        if (response.ok) return
      } catch { /* WebView/Edge is still starting */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  let webViewProcesses = 'unavailable'
  try {
    webViewProcesses = execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Select-Object ProcessId,CommandLine | Format-List | Out-String`,
    ], { encoding: 'utf8', timeout: 10_000 }).trim()
  } catch { /* retain the endpoint failure if process diagnostics fail */ }
  throw new Error(`CDP endpoint did not start (${urls.join(', ')}). Process exit=${process?.exitCode}; WebView2: ${webViewProcesses}\n${process?.testLogs?.join('') ?? ''}`)
}

async function connectBrowser(port, process) {
  await waitForCdp(port, process)
  return chromium.connectOverCDP(`http://127.0.0.1:${port}`)
}

async function waitForCdpClosed(port) {
  const url = `http://127.0.0.1:${port}/json/version`
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        continue
      }
    } catch { return }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Previous WebView2 debugging endpoint did not close: ${url}`)
}

function startApp(port) {
  const child = spawn(appPath, [], {
    env: { ...process.env, ZEX_E2E_CDP_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.testLogs = []
  child.stdout.on('data', (data) => child.testLogs.push(data.toString()))
  child.stderr.on('data', (data) => child.testLogs.push(data.toString()))
  return child
}

async function appPage(browser) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (await page.title().catch(() => '') === 'ZEX Download Manager') {
          page.setDefaultTimeout(timeout)
          return page
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Tauri WebView did not expose the desktop application page over CDP.')
}

async function rowByName(page, name) {
  const row = page.getByRole('row').filter({ hasText: name }).first()
  await row.waitFor({ state: 'visible', timeout })
  return row
}

async function waitStatus(page, name, expected) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const row = page.getByRole('row').filter({ hasText: name }).first()
    if (await row.count()) {
      const status = (await row.locator('td').nth(1).innerText()).trim().toLowerCase()
      if (status === expected) return row
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const observedRows = await page.getByRole('row').allInnerTexts().catch(() => [])
  throw new Error(`Timed out waiting for ${name} to reach ${expected}. Rows: ${JSON.stringify(observedRows)}`)
}

async function waitForProgress(row) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const value = Number(await row.getByRole('progressbar').getAttribute('aria-valuenow').catch(() => '0'))
    if (value > 0) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Download did not report nonzero progress.')
}

async function waitForInputValue(page, label, expected) {
  const input = page.getByLabel(label)
  const deadline = Date.now() + 15_000
  let observed = ''
  while (Date.now() < deadline) {
    observed = await input.inputValue().catch(() => '')
    if (observed === expected) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Setting ${label} did not load after restart (expected ${expected}; got ${observed}).`)
}

async function waitForExtensionWorker(context, id) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith(`chrome-extension://${id}/`))
    if (worker) return worker
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Test Chromium did not load the ZEX extension service worker for ${id}.`)
}

async function closeApp(page, browser, process) {
  await page.keyboard.press('Alt+F4').catch(() => {})
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline && process.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  await browser.close().catch(() => {})
  if (process.exitCode === null) {
    try { execFileSync('taskkill.exe', ['/PID', String(process.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* process exited during cleanup */ }
  }
}

async function removeWithRetry(target) {
  const retryable = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES'])
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true })
      return
    } catch (error) {
      if (!retryable.has(error?.code) || attempt === 29) throw error
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
}

function stopBrowserProfileProcesses(profile) {
  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      '$profile = $env:ZEX_E2E_BROWSER_PROFILE; Get-CimInstance Win32_Process | Where-Object { $_.Name -in @("chrome.exe", "chromium.exe") -and $_.CommandLine -like ("*" + $profile + "*") } | ForEach-Object { & taskkill.exe /PID $_.ProcessId /T /F | Out-Null }',
    ], {
      encoding: 'utf8',
      stdio: 'ignore',
      env: { ...process.env, ZEX_E2E_BROWSER_PROFILE: profile },
      timeout: 15_000,
    })
  } catch { /* the profile may already be fully closed */ }
}

let appProcess
let desktopBrowser
let browserContext
let extensionId
let extensionDownload
const browserProfile = path.join(temporaryRoot, 'chromium-profile')
try {
  let appPort = await availablePort()
  appProcess = startApp(appPort)
  desktopBrowser = await connectBrowser(appPort, appProcess)
  let page = await appPage(desktopBrowser)

  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByLabel('Download folder').fill(downloadDirectory)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByRole('button', { name: 'Connections & speed' }).click()
  await page.getByLabel('Connections per download').fill('2')
  await page.getByLabel('Maximum desktop downloads').fill('1')
  await page.getByLabel('Speed limit (KiB/s)').fill('512')
  await page.getByLabel('Retries per segment').fill('2')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByRole('status').filter({ hasText: 'Settings saved.' }).waitFor({ state: 'visible' })
  console.log('PASS settings persisted through desktop form')

  await page.getByRole('button', { name: 'Add download' }).click()
  await page.getByLabel('Download URL').fill(fixtureUrl('paused'))
  await page.getByRole('button', { name: 'Download now' }).click()
  await page.getByRole('link', { name: 'Active Downloads' }).click()
  let row = await rowByName(page, 'paused.bin')
  await row.getByRole('button', { name: 'Pause', exact: true }).waitFor({ state: 'visible', timeout })
  await waitForProgress(row)
  const speedText = (await row.locator('td').nth(4).innerText()).trim()
  if (speedText === '—') throw new Error('Engine speed sample was not displayed.')
  const speedMatch = speedText.match(/^([\d.]+)\s*(B|KB|MB|GB)\/s$/)
  if (!speedMatch) throw new Error(`Unrecognized speed display: ${speedText}`)
  const scale = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[speedMatch[2]]
  if (Number(speedMatch[1]) * scale > 850 * 1024) throw new Error(`Configured speed limit was not applied: ${speedText}`)
  if ((await row.locator('td').nth(5).innerText()).trim() === '—') throw new Error('Engine ETA sample was not displayed.')

  await page.getByRole('button', { name: 'Add download' }).click()
  await page.getByLabel('Download URL').fill(fixtureUrl('queued'))
  await page.getByRole('button', { name: 'Download now' }).click()
  await page.getByRole('link', { name: 'Download Queue' }).click()
  await waitStatus(page, 'queued.bin', 'queued')
  console.log('PASS configured one-slot download queue retains waiting work')

  await page.getByRole('link', { name: 'Active Downloads' }).click()
  await row.getByRole('button', { name: 'Pause', exact: true }).click()
  row = await waitStatus(page, 'paused.bin', 'paused')
  await row.getByRole('button', { name: 'Resume', exact: true }).waitFor({ state: 'visible', timeout })
  console.log('PASS Add Download and Pause created a resumable checkpoint')
  await waitStatus(page, 'queued.bin', 'active')
  await page.getByRole('link', { name: 'Completed Downloads' }).click()
  await waitStatus(page, 'queued.bin', 'completed')

  await closeApp(page, desktopBrowser, appProcess)
  desktopBrowser = undefined
  await waitForCdpClosed(appPort)
  appProcess = startApp(appPort)
  desktopBrowser = await connectBrowser(appPort, appProcess)
  page = await appPage(desktopBrowser)
  await page.getByRole('link', { name: 'Settings' }).click()
  await waitForInputValue(page, 'Download folder', downloadDirectory)
  await page.getByRole('button', { name: 'Connections & speed' }).click()
  await waitForInputValue(page, 'Connections per download', '2')
  await waitForInputValue(page, 'Speed limit (KiB/s)', '512')
  await page.getByRole('link', { name: 'Active Downloads' }).click()
  row = await rowByName(page, 'paused.bin')
  if (!(await row.getByRole('button', { name: 'Resume', exact: true }).isVisible())) {
    throw new Error('Paused download was not resumable after restarting the desktop application.')
  }
  await row.getByRole('button', { name: 'Resume', exact: true }).click()
  await page.getByRole('link', { name: 'Completed Downloads' }).click()
  row = await waitStatus(page, 'paused.bin', 'completed')
  const resumedData = await readFile(path.join(downloadDirectory, 'paused.bin'))
  if (resumedData.length !== fixtureBytes || createHash('sha256').update(resumedData).digest('hex') !== fixtureHash) {
    throw new Error('Resumed download bytes did not match the loopback fixture.')
  }
  await row.getByRole('progressbar', { name: 'Progress for paused.bin' }).waitFor({ state: 'visible' })
  console.log('PASS Resume after application restart completed the download')

  await page.getByRole('button', { name: 'Add download' }).click()
  await page.getByLabel('Download URL').fill(fixtureUrl('cancelled'))
  await page.getByRole('button', { name: 'Download now' }).click()
  await page.getByRole('link', { name: 'Active Downloads' }).click()
  row = await rowByName(page, 'cancelled.bin')
  await row.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('link', { name: 'Download History' }).click()
  row = await waitStatus(page, 'cancelled.bin', 'cancelled')
  if (await row.getByRole('button', { name: 'Resume', exact: true }).count()) throw new Error('Cancelled job unexpectedly exposes Resume.')
  for (const suffix of ['.part', '.checkpoint.json']) {
    try {
      await readFile(path.join(downloadDirectory, `cancelled.bin${suffix}`))
      throw new Error(`Cancelled download left ${suffix} behind.`)
    } catch (reason) {
      if (reason instanceof Error && reason.message.includes('left ')) throw reason
      if (reason?.code !== 'ENOENT') throw reason
    }
  }
  console.log('PASS Cancel removed active partial state and retained history')

  await page.getByRole('button', { name: 'Add download' }).click()
  await page.getByLabel('Download URL').fill(fixtureUrl('held'))
  await page.getByRole('checkbox', { name: /Start immediately/ }).uncheck()
  await page.getByRole('button', { name: 'Add to queue' }).click()
  row = await waitStatus(page, 'held.bin', 'queued')
  await row.getByRole('button', { name: 'Start', exact: true }).click()
  await page.getByRole('link', { name: 'Completed Downloads' }).click()
  await waitStatus(page, 'held.bin', 'completed')
  console.log('PASS manually held queue item starts only after explicit action')

  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const extensionDirectory = path.join(temporaryRoot, 'extension')
  await cp(path.join(repositoryRoot, 'extension'), extensionDirectory, { recursive: true })
  const manifestPath = path.join(extensionDirectory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const publicDer = publicKey.export({ type: 'spki', format: 'der' })
  manifest.key = publicDer.toString('base64')
  manifest.web_accessible_resources = [
    ...(manifest.web_accessible_resources ?? []),
    { resources: ['popup.html', 'popup.js', 'popup.css'], matches: ['http://127.0.0.1/*'] },
  ]
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const keyHash = createHash('sha256').update(publicDer).digest()
  extensionId = [...keyHash.subarray(0, 16)]
    .flatMap((byte) => [byte >> 4, byte & 15])
    .map((digit) => String.fromCharCode(97 + digit))
    .join('')

  await page.getByRole('link', { name: 'Browser Integration' }).click()
  await page.getByLabel('Chromium extension ID(s)').fill(extensionId)
  await page.getByRole('button', { name: 'Register Native Messaging host' }).click()
  await page.getByRole('status').filter({ hasText: 'Registered Native Messaging' }).waitFor({ state: 'visible' })

  browserContext = await chromium.launchPersistentContext(browserProfile, {
    channel: 'chromium',
    headless: true,
    timeout: 60_000,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--no-first-run', '--no-default-browser-check', '--disable-default-apps',
      `--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`,
    ],
  })
  await waitForExtensionWorker(browserContext, extensionId)
  const extensionPage = await browserContext.newPage()
  extensionPage.setDefaultTimeout(timeout)
  await extensionPage.goto(`http://127.0.0.1:${serverPort}/browser-test`)
  await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`)
  await extensionPage.getByRole('button', { name: 'Check connection' }).click()
  await extensionPage.getByText('Connected', { exact: true }).waitFor({ state: 'visible', timeout })
  console.log('PASS Windows Playwright Chromium extension completed a live Native Messaging ping')

  extensionDownload = path.join(downloadDirectory, 'extension.bin')
  await extensionPage.getByLabel('Send a chosen URL directly to the desktop app').fill(fixtureUrl('extension'))
  await extensionPage.getByRole('button', { name: 'Send chosen URL to app' }).click()
  await extensionPage.getByText('Sent to the desktop app.', { exact: true }).waitFor({ state: 'visible', timeout })
  await page.getByRole('link', { name: 'Active Downloads' }).click()
  row = await waitStatus(page, 'extension.bin', 'active')
  await waitForProgress(row)
  if ((await row.locator('td').nth(4).innerText()).trim() === '—') {
    throw new Error('Native Messaging download did not expose checkpoint-derived speed.')
  }
  if ((await row.locator('td').nth(5).innerText()).trim() === '—') {
    throw new Error('Native Messaging download did not expose checkpoint-derived ETA.')
  }
  console.log('PASS desktop UI polls Native Messaging engine checkpoint progress/speed/ETA')
  await page.getByRole('link', { name: 'Download History' }).click()
  row = await waitStatus(page, 'extension.bin', 'completed')
  const downloaded = await readFile(extensionDownload)
  if (downloaded.length !== fixtureBytes || createHash('sha256').update(downloaded).digest('hex') !== fixtureHash) {
    throw new Error('Native Messaging download bytes did not match the loopback fixture.')
  }
  console.log('PASS extension Native Messaging request downloaded exact bytes and reached desktop history')

  await page.getByRole('link', { name: 'Download History' }).click()
  await page.getByRole('button', { name: 'Clear non-resumable' }).click()
  await page.getByText('Your downloads will appear here when they are added.').waitFor({ state: 'visible' })
  console.log('PASS finished download history can be cleared from the desktop UI')
} finally {
  if (browserContext) {
    await Promise.race([
      browserContext.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ])
  }
  stopBrowserProfileProcesses(browserProfile)
  await new Promise((resolve) => setTimeout(resolve, 500))
  if (desktopBrowser && appProcess) {
    const pages = desktopBrowser.contexts().flatMap((context) => context.pages())
    const page = pages[0]
    if (page) await closeApp(page, desktopBrowser, appProcess).catch(() => {})
  } else if (appProcess?.exitCode === null) {
    try { execFileSync('taskkill.exe', ['/PID', String(appProcess.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* app exited during cleanup */ }
  }
  if (extensionId) {
    for (const key of [
      'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.downloadmanager.nextgen',
      'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.downloadmanager.nextgen',
      'HKCU\\Software\\BraveSoftware\\Brave\\NativeMessagingHosts\\com.downloadmanager.nextgen',
    ]) {
      try { execFileSync('reg.exe', ['delete', key, '/f'], { stdio: 'ignore' }) } catch { /* no key to clean */ }
    }
  }
  if (extensionDownload) await rm(extensionDownload, { force: true }).catch(() => {})
  await new Promise((resolve) => server.close(() => resolve()))
  await removeWithRetry(temporaryRoot)
}
