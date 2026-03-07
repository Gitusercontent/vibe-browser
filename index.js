const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')

const configPath = path.join(__dirname, 'uwu-config.json')

let downloadWin = null
let downloadCounter = 0
const activeDownloads = {}

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {}
  return { searchEngine: 'https://www.google.com/search?q=', homepage: '' }
}

function saveConfig(data) {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2))
}

function openDownloads() {
  if (!downloadWin || downloadWin.isDestroyed()) {
    downloadWin = new BrowserWindow({
      width: 800,
      height: 600,
      title: 'Downloads',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    })
    downloadWin.loadFile('downloads.html')
    downloadWin.setMenu(null)
  } else {
    downloadWin.focus()
  }
}

function openSettings() {
  const settingsWin = new BrowserWindow({
    width: 700,
    height: 600,
    title: 'Vibe :3 - Settings',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  settingsWin.loadFile('settings.html')
  settingsWin.setMenu(null)
}

function buildContextMenu(params, win) {
  const menuItems = []

  if (params.selectionText) {
    menuItems.push(
      { label: 'Copy', role: 'copy' },
      { label: `Search for "${params.selectionText.slice(0, 20)}"`, click: () => {
        win.webContents.send('open-search', params.selectionText)
      }},
      { type: 'separator' }
    )
  }

  if (params.isEditable) {
    menuItems.push(
      { label: 'Cut', role: 'cut' },
      { label: 'Copy', role: 'copy' },
      { label: 'Paste', role: 'paste' },
      { type: 'separator' },
      { label: 'Select All', role: 'selectAll' },
      { type: 'separator' }
    )
  }

  if (params.linkURL) {
    menuItems.push(
      { label: 'Open link in new tab', click: () => {
        win.webContents.send('open-new-tab', params.linkURL)
      }},
      { label: 'Copy link address', click: () => {
        require('electron').clipboard.writeText(params.linkURL)
      }},
      { type: 'separator' }
    )
  }

  if (params.srcURL && params.mediaType === 'image') {
    menuItems.push(
      { label: 'Copy image address', click: () => {
        require('electron').clipboard.writeText(params.srcURL)
      }},
      { type: 'separator' }
    )
  }

  menuItems.push(
    { label: 'Back', click: () => win.webContents.send('go-back') },
    { label: 'Forward', click: () => win.webContents.send('go-forward') },
    { label: 'Reload', click: () => win.webContents.send('reload-tab') },
    { type: 'separator' },
    { label: 'View page source', click: () => {
      win.webContents.send('open-new-tab', 'view-source:' + (params.pageURL || ''))
    }},
    { label: 'Inspect element', click: () => {
      win.webContents.send('inspect-element', { x: params.x, y: params.y })
    }}
  )

  return Menu.buildFromTemplate(menuItems)
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Vibe :3',
    icon: path.join(__dirname, 'icon256.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      webSecurity: true
    }
  })

  win.loadFile('index.html')
  win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    callback({ requestHeaders: details.requestHeaders })
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    win.webContents.send('open-new-tab', url)
    return { action: 'deny' }
  })

  win.webContents.session.on('will-download', (event, item) => {
    downloadCounter++
    const id = downloadCounter
    const filename = item.getFilename()
    const savePath = path.join(app.getPath('downloads'), filename)
    item.setSavePath(savePath)
    activeDownloads[id] = item

    openDownloads()

    downloadWin.webContents.once('did-finish-load', () => {
      downloadWin.webContents.send('download-started', { id, filename, savePath })
    })

    if (!downloadWin.webContents.isLoading()) {
      downloadWin.webContents.send('download-started', { id, filename, savePath })
    }

    item.on('updated', (e, state) => {
      if (state === 'progressing' && !item.isPaused() && downloadWin && !downloadWin.isDestroyed()) {
        const received = item.getReceivedBytes()
        const total = item.getTotalBytes()
        const percent = total > 0 ? Math.round((received / total) * 100) : 0
        downloadWin.webContents.send('download-progress', { id, percent, received, total })
      }
    })

    item.once('done', (e, state) => {
      delete activeDownloads[id]
      if (downloadWin && !downloadWin.isDestroyed()) {
        downloadWin.webContents.send('download-done', { id, state })
      }
    })
  })

  win.webContents.on('context-menu', (event, params) => {
    buildContextMenu(params, win).popup()
  })

  app.on('web-contents-created', (event, contents) => {
    if (contents.getType() === 'webview') {
      contents.on('context-menu', (e, params) => {
        buildContextMenu(params, win).popup()
      })
    }
    app.on('web-contents-created', (event, contents) => {
        if (contents.getType() === 'webview') {
          contents.on('context-menu', (e, params) => {
            buildContextMenu(params, win).popup()
          })
          contents.setWindowOpenHandler(({ url }) => {
            win.webContents.send('open-new-tab', url)
            return { action: 'deny' }
          })
        }
    })
  })
}

ipcMain.handle('get-config', () => loadConfig())
ipcMain.handle('save-config', (event, data) => { saveConfig(data); return true })
ipcMain.on('open-settings', () => openSettings())
ipcMain.on('open-downloads', () => openDownloads())
ipcMain.on('cancel-download', (e, id) => {
  if (activeDownloads[id]) {
    activeDownloads[id].cancel()
    delete activeDownloads[id]
  }
})
ipcMain.on('open-file', (e, filePath) => shell.openPath(filePath))
ipcMain.on('show-file', (e, filePath) => shell.showItemInFolder(filePath))
ipcMain.on('open-bookmarks', () => {
  const bookmarksWin = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Bookmarks',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  bookmarksWin.loadFile('bookmarks.html')
  bookmarksWin.setMenu(null)
})

ipcMain.on('add-bookmark', (e, { title, url }) => {
  const bookmarksPath = path.join(__dirname, 'bookmarks.json')
  let bookmarks = []
  try {
    if (fs.existsSync(bookmarksPath)) bookmarks = JSON.parse(fs.readFileSync(bookmarksPath, 'utf8'))
  } catch {}
  bookmarks.push({ title, url })
  fs.writeFileSync(bookmarksPath, JSON.stringify(bookmarks, null, 2))
})

ipcMain.on('open-bookmark', (e, url) => {
  BrowserWindow.getAllWindows()[0].webContents.send('open-new-tab', url)
})

app.whenReady().then(() => {
  createWindow()
  app.setDesktopFileName('vibe-browser')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})