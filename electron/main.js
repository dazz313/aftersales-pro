/**
 * AfterSales Pro — Electron Main Process
 * =======================================
 * Versi desktop Windows: membungkus aplikasi Next.js (standalone build) ke
 * dalam jendela desktop native, dengan database SQLite di folder userData.
 *
 * Alur startup:
 *   1. Single instance lock
 *   2. Siapkan database di %APPDATA%/AfterSalesPro (copy template pada first run,
 *      lalu `prisma db push` untuk sinkronisasi schema saat upgrade)
 *   3. Spawn Next.js standalone server pada localhost:port bebas
 *      (process.execPath + ELECTRON_RUN_AS_NODE=1 → runtime Node bawaan Electron,
 *       tidak butuh Node.js terinstal di mesin user)
 *   4. Tunggu server siap → buka BrowserWindow
 *   5. Tulis konfigurasi siap-pakai untuk Claude Desktop MCP ke userData
 */

const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const { spawn, spawnSync } = require('node:child_process')

// ---------- Konstanta ----------

const APP_TITLE = 'AfterSales Pro'
const BASE_PORT = 34567
const SERVER_READY_TIMEOUT_MS = 60_000
let isQuitting = false

// ---------- Path runtime ----------

const isDev = !app.isPackaged
const resourcesRoot = isDev ? path.join(__dirname, '..') : process.resourcesPath
const standaloneDir = path.join(resourcesRoot, 'app', 'standalone')
const serverJs = path.join(standaloneDir, 'server.js')
const prismaCli = path.join(resourcesRoot, 'app', 'node_modules', 'prisma', 'build', 'index.js')
const schemaPath = path.join(resourcesRoot, 'prisma', 'schema.prisma')
const templateDb = path.join(resourcesRoot, 'prisma', 'template.db')
const mcpServerPath = path.join(resourcesRoot, 'app', 'mcp', 'server.cjs')

// ---------- Util ----------

function log(...args) {
  console.log(`[AfterSalesPro ${new Date().toISOString()}]`, ...args)
}

function findFreePort(startPort) {
  return new Promise((resolve) => {
    const net = require('node:net')
    let port = startPort
    const tryPort = () => {
      const srv = net.createServer()
      srv.once('error', () => {
        port += 1
        if (port > startPort + 50) return resolve(startPort)
        tryPort()
      })
      srv.once('listening', () => srv.close(() => resolve(port)))
      srv.listen(port, '127.0.0.1')
    }
    tryPort()
  })
}

function httpGetStatus(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume()
      resolve(res.statusCode || 0)
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(0)
    })
    req.on('error', () => resolve(0))
  })
}

async function waitUntilReady(url, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await httpGetStatus(url)
    if (status >= 200 && status < 500) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

// ---------- Persiapan database ----------

function getDbDir() {
  const dir = path.join(app.getPath('userData'), 'data')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function prepareDatabase(dbPath) {
  // 1. First run — salin template database (schema penuh + pengguna awal)
  if (!fs.existsSync(dbPath)) {
    fs.copyFileSync(templateDb, dbPath)
    log('Database dibuat dari template:', dbPath)
  }
  // 2. Sinkronisasi schema (idempotent — menangani upgrade versi)
  try {
    const res = spawnSync(
      process.execPath,
      [prismaCli, 'db', 'push', '--skip-generate', '--accept-data-loss', '--schema', schemaPath],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          DATABASE_URL: `file:${dbPath}`,
          PRISMA_HIDE_UPDATE_MESSAGE: '1',
        },
        timeout: 90_000,
        encoding: 'utf8',
        windowsHide: true,
      }
    )
    if (res.status === 0) log('Schema database tersinkronisasi')
    else log('Peringatan db push (lanjut dengan template):', (res.stderr || res.stdout || '').slice(-300))
  } catch (e) {
    log('db push gagal (lanjut):', e.message)
  }
}

// ---------- Server Next.js ----------

let serverProc = null
let serverPort = BASE_PORT

function startServer(dbPath) {
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    PORT: String(serverPort),
    HOSTNAME: '127.0.0.1',
    DATABASE_URL: `file:${dbPath}`,
    ASPRO_DB_PATH: dbPath,
    ASPRO_BACKUP_DIR: path.join(getDbDir(), 'backups'),
    ASPRO_DESKTOP: '1',
  }
  const logDir = app.getPath('userData')
  const logStream = fs.createWriteStream(path.join(logDir, 'server.log'), { flags: 'a' })
  serverProc = spawn(process.execPath, [serverJs], {
    cwd: standaloneDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  serverProc.stdout.pipe(logStream)
  serverProc.stderr.pipe(logStream)
  serverProc.on('exit', (code) => log('Server process keluar, code =', code))
  log(`Server Next.js spawn di port ${serverPort}`)
}

function stopServer() {
  if (!serverProc) return
  try {
    if (process.platform === 'win32') {
      // Bunuh tree proses (server + worker threads)
      spawn('taskkill', ['/pid', String(serverProc.pid), '/T', '/F'], { windowsHide: true })
    } else {
      serverProc.kill('SIGTERM')
    }
  } catch (e) {
    log('Gagal stop server:', e.message)
  }
  serverProc = null
}

// ---------- Konfigurasi MCP untuk Claude Desktop ----------

function writeMcpConfig(dbPath) {
  try {
    const cfg = {
      _catatan: 'Salin isi mcpServers ke %APPDATA%\\Claude\\claude_desktop_config.json lalu restart Claude Desktop. Tidak butuh Node.js terinstal — memakai runtime bawaan AfterSales Pro.',
      mcpServers: {
        'aftersales-pro': {
          command: process.execPath, // exe AfterSales Pro terinstal
          args: [mcpServerPath],
          env: {
            ELECTRON_RUN_AS_NODE: '1',
            ASPRO_DB_PATH: dbPath,
          },
        },
      },
    }
    const file = path.join(app.getPath('userData'), 'claude-desktop-mcp-config.json')
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2))
    log('Konfigurasi MCP Claude Desktop ditulis:', file)
    return file
  } catch (e) {
    log('Gagal menulis config MCP:', e.message)
    return null
  }
}

// ---------- Window & Menu ----------

let mainWindow = null

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: APP_TITLE,
    show: false,
    backgroundColor: '#f8fafc',
    icon: isDev ? path.join(__dirname, '..', 'build', 'icon.png') : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  mainWindow.loadURL(`http://127.0.0.1:${port}/`)

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // Link target=_blank / window.open → buka di app default (browser/email client)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Cegah judul tab menimpa judul aplikasi
  mainWindow.on('page-title-updated', (e) => e.preventDefault())

  mainWindow.on('closed', () => (mainWindow = null))
}

function buildMenu() {
  const template = [
    {
      label: 'Berkas',
      submenu: [
        { label: 'Keluar', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'Tampilan',
      submenu: [
        { role: 'reload', label: 'Muat Ulang' },
        { role: 'forceReload', label: 'Muat Ulang Paksa' },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Perbesar' },
        { role: 'zoomOut', label: 'Perkecil' },
        { role: 'resetZoom', label: 'Ukuran Normal' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Layar Penuh' },
      ],
    },
    {
      label: 'Alat',
      submenu: [
        { role: 'toggleDevTools', label: 'Developer Tools' },
      ],
    },
    {
      role: 'help',
      label: 'Bantuan',
      submenu: [
        {
          label: 'Tentang AfterSales Pro',
          click: () => {
            shell.openExternal('https://github.com/')
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------- IPC (diakses lewat preload) ----------

function registerIpc(dbPath) {
  ipcMain.handle('aspro:get-desktop-info', () => ({
    isDesktop: true,
    version: app.getVersion(),
    platform: process.platform,
    dbPath,
    mcpServerPath,
    mcpConfigFile: path.join(app.getPath('userData'), 'claude-desktop-mcp-config.json'),
    userDataPath: app.getPath('userData'),
    exePath: process.execPath,
  }))
}

// ---------- Lifecycle ----------

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    const dbDir = getDbDir()
    const dbPath = path.join(dbDir, 'aftersales.db')

    // Dev mode: pakai DB proyek agar sama dengan `bun run dev`
    const devDbPath = path.join(__dirname, '..', 'db', 'custom.db')
    const finalDbPath = isDev && fs.existsSync(devDbPath) ? devDbPath : dbPath

    if (!isDev) {
      prepareDatabase(dbPath)
      registerIpc(dbPath)
      writeMcpConfig(dbPath)
    } else {
      registerIpc(finalDbPath)
    }

    if (isDev) {
      // Dev: server Next dev sudah jalan di :3000
      serverPort = 3000
      buildMenu()
      createWindow(serverPort)
    } else {
      serverPort = await findFreePort(BASE_PORT)
      startServer(finalDbPath)
      const ready = await waitUntilReady(`http://127.0.0.1:${serverPort}/`, SERVER_READY_TIMEOUT_MS)
      if (!ready) {
        dialogError('Server aplikasi gagal merespons setelah 60 detik. Periksa log di folder data aplikasi lalu coba lagi.')
        app.quit()
        return
      }
      log('Server siap — buka window')
      buildMenu()
      createWindow(serverPort)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(serverPort)
    })
  })
}

function dialogError(message) {
  // dialog di-import lazy agar dev mode tidak kegantungan
  try {
    const { dialog } = require('electron')
    dialog.showErrorBox(APP_TITLE, message)
  } catch {
    /* ignore */
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (isQuitting) return
  isQuitting = true
  log('Aplikasi keluar — hentikan server')
  stopServer()
})

process.on('uncaughtException', (e) => {
  log('uncaughtException:', e)
})
