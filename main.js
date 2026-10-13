const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron')
const path = require('path')
const fs = require('fs')

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const WIN_W = 320
const WIN_H = 260
const PET_SIZE = 180
const HOVER_PADDING = 24

const DEFAULT_PHRASES = ['嘟嘟!!', 'Can i use my laptop?', '邹邦强? 邹邦弱!']
const DEFAULT_SHORTCUTS = [
  { id: 'flash', label: '闪烁', accelerator: 'CommandOrControl+Shift+D' },
  { id: 'crazy', label: '疯狂模式', accelerator: 'CommandOrControl+Shift+U' },
  { id: 'quit',  label: '退出', accelerator: 'CommandOrControl+Alt+Q' }
]

const pets = []
let phrasesData = []
let shortcutsData = []
let scoreData = 0
let shopData = { quantityUpgrades: 0, valueUpgrades: 0, autoChase: false, speedUpgrades: 0, dashLevel: 0 }
let phrasesWindow = null
let shortcutsWindow = null
let shopWindow = null
let menuWindow = null
let menuOwnerEntry = null
let foodWindow = null
let foodBroadcastTimer = null
let fxWindow = null

const AUTO_CHASE_PRICE = 1000
const SPEED_PRICE = 300
const MAX_SPEED_UPGRADES = 9
const BASE_CHASE_DURATION = 220
const DASH_PRICE = 1000
const MAX_DASH_LEVEL = 10

function phrasesFilePath() { return path.join(app.getPath('userData'), 'phrases.json') }
function loadPhrases() {
  try {
    const p = phrasesFilePath()
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (Array.isArray(data) && data.every(x => typeof x === 'string')) return data
    }
  } catch (e) {}
  return DEFAULT_PHRASES.slice()
}
function persistPhrases() {
  try { fs.writeFileSync(phrasesFilePath(), JSON.stringify(phrasesData, null, 2), 'utf8') } catch (e) {}
}

function shortcutsFilePath() { return path.join(app.getPath('userData'), 'shortcuts.json') }
function loadShortcuts() {
  try {
    const p = shortcutsFilePath()
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (Array.isArray(data)) {
        return DEFAULT_SHORTCUTS.map(def => {
          const found = data.find(x => x && x.id === def.id)
          return { id: def.id, label: def.label, accelerator: found ? String(found.accelerator || '') : def.accelerator }
        })
      }
    }
  } catch (e) {}
  return DEFAULT_SHORTCUTS.map(x => ({ ...x }))
}
function persistShortcuts() {
  try { fs.writeFileSync(shortcutsFilePath(), JSON.stringify(shortcutsData, null, 2), 'utf8') } catch (e) {}
}

function scoreFilePath() { return path.join(app.getPath('userData'), 'score.json') }
function loadScore() {
  try {
    const p = scoreFilePath()
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (data && typeof data.score === 'number' && isFinite(data.score)) return Math.max(0, Math.floor(data.score))
    }
  } catch (e) {}
  return 0
}
function persistScore() {
  try { fs.writeFileSync(scoreFilePath(), JSON.stringify({ score: scoreData }, null, 2), 'utf8') } catch (e) {}
}

function shopFilePath() { return path.join(app.getPath('userData'), 'shop.json') }
function loadShop() {
  try {
    const p = shopFilePath()
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (data) {
        return {
          quantityUpgrades: Math.max(0, Math.floor(data.quantityUpgrades || 0)),
          valueUpgrades: Math.max(0, Math.floor(data.valueUpgrades || 0)),
          autoChase: !!data.autoChase,
          speedUpgrades: Math.max(0, Math.min(MAX_SPEED_UPGRADES, Math.floor(data.speedUpgrades || 0))),
          dashLevel: Math.max(0, Math.min(MAX_DASH_LEVEL, Math.floor(data.dashLevel || 0)))
        }
      }
    }
  } catch (e) {}
  return { quantityUpgrades: 0, valueUpgrades: 0, autoChase: false, speedUpgrades: 0, dashLevel: 0 }
}
function persistShop() {
  try { fs.writeFileSync(shopFilePath(), JSON.stringify(shopData, null, 2), 'utf8') } catch (e) {}
}

function getFoodQuantityMultiplier() { return 1 + 0.2 * shopData.quantityUpgrades }
function getFoodValue() { return 1 + shopData.valueUpgrades }
function getQuantityPrice() { return Math.floor(100 * Math.pow(1.15, shopData.quantityUpgrades)) }
function getValuePrice() { return Math.floor(200 * Math.pow(1.4, shopData.valueUpgrades)) }
function getChaseDuration() { return Math.round(BASE_CHASE_DURATION * Math.pow(0.9, shopData.speedUpgrades)) }
function getSpeedPercent() { return Math.round(100 * Math.pow(0.9, shopData.speedUpgrades)) }
function getDashCd() { return shopData.dashLevel < 1 ? 0 : Math.max(1000, 10000 - (shopData.dashLevel - 1) * 1000) }

function broadcastAutoChase() {
  pets.forEach(p => { if (p.win && !p.win.isDestroyed()) p.win.webContents.send('set-auto-chase', !!shopData.autoChase) })
}
function broadcastChaseDuration() {
  const d = getChaseDuration()
  pets.forEach(p => { if (p.win && !p.win.isDestroyed()) p.win.webContents.send('set-chase-duration', d) })
}
function broadcastDash() {
  const level = shopData.dashLevel
  const cd = getDashCd()
  pets.forEach(p => { if (p.win && !p.win.isDestroyed()) p.win.webContents.send('set-dash', { level, cd }) })
}

function performAction(actionId) {
  if (actionId === 'flash') {
    const o = pets[0]
    if (o && o.win && !o.win.isDestroyed()) o.win.webContents.send('flash')
  } else if (actionId === 'crazy') {
    pets.forEach(p => { if (p.win && !p.win.isDestroyed()) p.win.webContents.send('crazy-start', 5000) })
  } else if (actionId === 'quit') {
    app.quit()
  }
}

function registerAllShortcuts() {
  globalShortcut.unregisterAll()
  shortcutsData.forEach(s => {
    if (!s.accelerator) return
    try {
      const ok = globalShortcut.register(s.accelerator, () => performAction(s.id))
      if (!ok) console.error('register failed:', s.accelerator)
    } catch (e) {}
  })
}

function openPhrasesEditor() {
  if (phrasesWindow && !phrasesWindow.isDestroyed()) { phrasesWindow.focus(); return }
  phrasesWindow = new BrowserWindow({
    width: 500, height: 580, title: '编辑词库',
    minimizable: false, maximizable: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  })
  phrasesWindow.loadFile('phrases.html')
  phrasesWindow.on('closed', () => { phrasesWindow = null })
}
function openShortcutsEditor() {
  if (shortcutsWindow && !shortcutsWindow.isDestroyed()) { shortcutsWindow.focus(); return }
  shortcutsWindow = new BrowserWindow({
    width: 520, height: 420, title: '快捷键设置',
    minimizable: false, maximizable: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  })
  shortcutsWindow.loadFile('shortcuts.html')
  shortcutsWindow.on('closed', () => { shortcutsWindow = null })
}
function openShopWindow() {
  if (shopWindow && !shopWindow.isDestroyed()) { shopWindow.focus(); return }
  shopWindow = new BrowserWindow({
    width: 480, height: 800, title: '点数商城',
    minimizable: false, maximizable: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  })
  shopWindow.loadFile('shop.html')
  shopWindow.on('closed', () => { shopWindow = null })
}

function createFxWindow() {
  if (fxWindow && !fxWindow.isDestroyed()) return
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea
  fxWindow = new BrowserWindow({
    x, y, width, height, frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, hasShadow: false, focusable: false, show: false,
    useContentSize: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })
  fxWindow.setAlwaysOnTop(true)
  fxWindow.setIgnoreMouseEvents(true, { forward: true })
  fxWindow.loadFile('fx.html')
  fxWindow.once('ready-to-show', () => { if (fxWindow && !fxWindow.isDestroyed()) fxWindow.showInactive() })
  fxWindow.on('closed', () => { fxWindow = null })
}

function openFoodWindow(duration) {
  if (foodWindow && !foodWindow.isDestroyed()) return
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea
  foodWindow = new BrowserWindow({
    x, y, width, height, frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, hasShadow: false, focusable: false, show: false,
    useContentSize: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })
  foodWindow.setAlwaysOnTop(true)
  foodWindow.setIgnoreMouseEvents(true, { forward: true })
  foodWindow.loadFile('food.html')

  foodWindow.webContents.once('did-finish-load', () => {
    if (!foodWindow || foodWindow.isDestroyed()) return
    foodWindow.showInactive()
    foodWindow.webContents.send('food-start', {
      duration: duration || 15000,
      quantityMultiplier: getFoodQuantityMultiplier(),
      foodValue: getFoodValue()
    })
    if (fxWindow && !fxWindow.isDestroyed()) fxWindow.setAlwaysOnTop(true)
  })

  foodBroadcastTimer = setInterval(() => {
    if (!foodWindow || foodWindow.isDestroyed()) return
    const positions = []
    pets.forEach(p => {
      if (!p.win || p.win.isDestroyed()) return
      const b = p.win.getBounds()
      positions.push({ x: b.x + (WIN_W - PET_SIZE) / 2, y: b.y + (WIN_H - PET_SIZE), w: PET_SIZE, h: PET_SIZE })
    })
    foodWindow.webContents.send('pet-positions', positions)
  }, 100)

  foodWindow.on('closed', () => {
    foodWindow = null
    if (foodBroadcastTimer) { clearInterval(foodBroadcastTimer); foodBroadcastTimer = null }
  })
}
function closeFoodWindow() { if (foodWindow && !foodWindow.isDestroyed()) foodWindow.destroy() }

function createPetWindow(spawnOffset) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const ox = spawnOffset?.x ?? 0
  const oy = spawnOffset?.y ?? 0
  const x = width - WIN_W - 60 + ox
  const y = height - WIN_H - 60 + oy

  const win = new BrowserWindow({
    width: WIN_W, height: WIN_H, x, y, frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false,
    focusable: false, show: false, useContentSize: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })

  win.setAlwaysOnTop(true)
  win.setIgnoreMouseEvents(true, { forward: true })
  win.loadFile('index.html')

  const entry = { win, dragTimer: null, hoverTimer: null, mode: 'move', dragging: false }

  win.once('ready-to-show', () => {
    win.show()
    if (!win.isDestroyed()) {
      win.webContents.send('set-auto-chase', !!shopData.autoChase)
      win.webContents.send('set-chase-duration', getChaseDuration())
      win.webContents.send('set-dash', { level: shopData.dashLevel, cd: getDashCd() })
    }
  })

  win.on('closed', () => {
    const i = pets.findIndex(p => p.win === win)
    if (i >= 0) {
      if (pets[i].dragTimer) clearInterval(pets[i].dragTimer)
      if (pets[i].hoverTimer) clearInterval(pets[i].hoverTimer)
      pets.splice(i, 1)
    }
  })

  entry.hoverTimer = setInterval(() => {
    if (win.isDestroyed()) return
    if (entry.dragging) {
      win.setIgnoreMouseEvents(false)
      return
    }
    const c = screen.getCursorScreenPoint()
    const b = win.getBounds()
    const petX = b.x + (WIN_W - PET_SIZE) / 2 - HOVER_PADDING
    const petY = b.y + (WIN_H - PET_SIZE) - HOVER_PADDING
    const petW = PET_SIZE + HOVER_PADDING * 2
    const petH = PET_SIZE + HOVER_PADDING * 2
    const inside = c.x >= petX && c.x <= petX + petW && c.y >= petY && c.y <= petY + petH
    win.setIgnoreMouseEvents(!inside, { forward: true })
  }, 40)

  pets.push(entry)
  return entry
}

function findEntry(sender) {
  const win = BrowserWindow.fromWebContents(sender)
  return pets.find(p => p.win === win) || null
}

function setPetPos(win, x, y) {
  if (!win || win.isDestroyed()) return
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: WIN_W, height: WIN_H })
}

function removeAllClones() {
  pets.slice(1).forEach(p => { if (p.win && !p.win.isDestroyed()) p.win.destroy() })
}

function closeMenuImmediate() { if (menuWindow && !menuWindow.isDestroyed()) menuWindow.destroy() }

function openCustomMenu(entry, screenX, screenY) {
  closeMenuImmediate()
  const isOriginal = pets[0] && pets[0].win === entry.win
  const statusText = entry.mode === 'move' ? '移动' : '固定'

  const items = isOriginal ? [
    { id: 'score', html: '<span class="score">点数: ' + scoreData + '</span>', enabled: false },
    { type: 'separator' },
    { id: 'clone', label: '克隆' },
    { id: 'delete-all-clones', label: '删除克隆体', enabled: pets.length > 1 },
    { type: 'separator' },
    { id: 'toggle-mode', label: `切换状态 (目前: ${statusText})` },
    { id: 'edit-phrases', label: '编辑词库' },
    { id: 'edit-shortcuts', label: '快捷键设置' },
    { id: 'eat-back', label: '吃回本' },
    { id: 'shop', label: '点数商城' },
    { type: 'separator' },
    { id: 'quit', label: '退出' }
  ] : [
    { id: 'toggle-mode', label: `切换状态 (目前: ${statusText})` },
    { type: 'separator' },
    { id: 'delete-self', label: '删除克隆体' }
  ]

  const ITEM_H = 32, SEP_H = 9, PAD = 12
  let h = PAD
  items.forEach(it => { h += (it.type === 'separator') ? SEP_H : ITEM_H })
  const W = 240

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  let mx = Math.max(4, Math.min(screenX, sw - W - 4))
  let my = Math.max(4, Math.min(screenY, sh - h - 4))

  menuWindow = new BrowserWindow({
    width: W, height: h, x: mx, y: my, frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, focusable: true, show: false, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  })

  menuOwnerEntry = entry
  if (entry.win && !entry.win.isDestroyed()) entry.win.webContents.send('set-menu-open', true)

  menuWindow.loadFile('menu.html')

  menuWindow.webContents.once('did-finish-load', () => {
    if (!menuWindow || menuWindow.isDestroyed()) return
    menuWindow.webContents.send('menu-items', items)
    menuWindow.show()
    menuWindow.focus()
  })

  menuWindow.on('closed', () => {
    const prev = menuOwnerEntry
    menuWindow = null
    menuOwnerEntry = null
    if (prev && prev.win && !prev.win.isDestroyed()) prev.win.webContents.send('set-menu-open', false)
  })
}

app.whenReady().then(() => {
  phrasesData = loadPhrases()
  shortcutsData = loadShortcuts()
  scoreData = loadScore()
  shopData = loadShop()
  registerAllShortcuts()
  createFxWindow()
  createPetWindow()
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())

ipcMain.on('start-drag', (event) => {
  const entry = findEntry(event.sender)
  if (!entry || !entry.win) return
  entry.dragging = true
  entry.win.setIgnoreMouseEvents(false)
  const startCursor = screen.getCursorScreenPoint()
  const [startX, startY] = entry.win.getPosition()
  if (entry.dragTimer) clearInterval(entry.dragTimer)
  entry.dragTimer = setInterval(() => {
    if (!entry.win || entry.win.isDestroyed()) return
    const c = screen.getCursorScreenPoint()
    setPetPos(entry.win, startX + (c.x - startCursor.x), startY + (c.y - startCursor.y))
  }, 30)
})

ipcMain.on('end-drag', (event) => {
  const entry = findEntry(event.sender)
  if (!entry) return
  entry.dragging = false
  if (entry.dragTimer) { clearInterval(entry.dragTimer); entry.dragTimer = null }
})

ipcMain.on('move-window', (event, { x, y }) => {
  const entry = findEntry(event.sender)
  if (!entry) return
  setPetPos(entry.win, x, y)
})

ipcMain.on('open-phrases-editor', () => openPhrasesEditor())
ipcMain.on('open-shortcuts-editor', () => openShortcutsEditor())
ipcMain.on('food-done', () => closeFoodWindow())

ipcMain.on('add-score', (_event, amount) => {
  const inc = (typeof amount === 'number' && isFinite(amount)) ? Math.max(0, Math.floor(amount)) : 1
  scoreData += inc
  persistScore()
})

ipcMain.on('food-positions', (_event, positions) => {
  const list = Array.isArray(positions) ? positions : []
  pets.forEach(p => { if (p.win && !p.win.isDestroyed()) p.win.webContents.send('food-positions', list) })
})

ipcMain.on('dash-started', (_event, info) => {
  if (foodWindow && !foodWindow.isDestroyed()) foodWindow.webContents.send('dash-sweep', info)
  if (fxWindow && !fxWindow.isDestroyed()) {
    fxWindow.setAlwaysOnTop(true)
    fxWindow.webContents.send('draw-dash-trail', info)
  }
})

ipcMain.on('food-exploded', (_event, info) => {
  if (fxWindow && !fxWindow.isDestroyed()) fxWindow.webContents.send('spawn-food-particles', info)
})

ipcMain.on('show-context-menu', (event, pos) => {
  const entry = findEntry(event.sender)
  if (!entry) return
  openCustomMenu(entry, pos?.x ?? 200, pos?.y ?? 200)
})

ipcMain.on('menu-close', () => closeMenuImmediate())

ipcMain.on('menu-click', (_e, id) => {
  const entry = menuOwnerEntry
  if (!entry) { closeMenuImmediate(); return }
  const win = entry.win
  const isOriginal = pets[0] && pets[0].win === win
  closeMenuImmediate()

  if (id === 'clone' && isOriginal) {
    const ox = -40 - Math.round(Math.random() * 60)
    const oy = -40 - Math.round(Math.random() * 60)
    createPetWindow({ x: ox, y: oy })
  } else if (id === 'delete-all-clones' && isOriginal) {
    removeAllClones()
  } else if (id === 'toggle-mode') {
    entry.mode = entry.mode === 'move' ? 'still' : 'move'
    if (win && !win.isDestroyed()) win.webContents.send('set-mode', entry.mode)
  } else if (id === 'edit-phrases' && isOriginal) {
    openPhrasesEditor()
  } else if (id === 'edit-shortcuts' && isOriginal) {
    openShortcutsEditor()
  } else if (id === 'eat-back' && isOriginal) {
    openFoodWindow(15000)
  } else if (id === 'shop' && isOriginal) {
    openShopWindow()
  } else if (id === 'quit') {
    app.quit()
  } else if (id === 'delete-self' && !isOriginal) {
    if (win && !win.isDestroyed()) win.destroy()
  }
})

ipcMain.handle('get-phrases', () => phrasesData)
ipcMain.handle('save-phrases', (_event, list) => {
  if (!Array.isArray(list)) return false
  phrasesData = list.filter(x => typeof x === 'string').map(x => x.trim()).filter(x => x.length > 0)
  persistPhrases()
  pets.forEach(p => { if (p.win && !p.win.isDestroyed()) p.win.webContents.send('phrases-updated', phrasesData) })
  return true
})

ipcMain.handle('get-shortcuts', () => shortcutsData)
ipcMain.handle('save-shortcuts', (_event, list) => {
  if (!Array.isArray(list)) return false
  shortcutsData = DEFAULT_SHORTCUTS.map(def => {
    const found = list.find(x => x && x.id === def.id)
    return { id: def.id, label: def.label, accelerator: found ? String(found.accelerator || '') : '' }
  })
  persistShortcuts()
  registerAllShortcuts()
  return true
})

ipcMain.handle('get-score', () => scoreData)
ipcMain.handle('get-shop-data', () => ({
  score: scoreData,
  quantityUpgrades: shopData.quantityUpgrades,
  valueUpgrades: shopData.valueUpgrades,
  autoChase: shopData.autoChase,
  speedUpgrades: shopData.speedUpgrades,
  dashLevel: shopData.dashLevel,
  quantityMultiplier: getFoodQuantityMultiplier(),
  foodValue: getFoodValue(),
  quantityPrice: getQuantityPrice(),
  valuePrice: getValuePrice(),
  autoChasePrice: AUTO_CHASE_PRICE,
  speedPrice: SPEED_PRICE,
  maxSpeedUpgrades: MAX_SPEED_UPGRADES,
  chaseDuration: getChaseDuration(),
  speedPercent: getSpeedPercent(),
  dashPrice: DASH_PRICE,
  maxDashLevel: MAX_DASH_LEVEL,
  dashCd: getDashCd()
}))

ipcMain.handle('buy-quantity', () => { const p = getQuantityPrice(); if (scoreData < p) return false; scoreData -= p; shopData.quantityUpgrades += 1; persistScore(); persistShop(); return true })
ipcMain.handle('buy-value', () => { const p = getValuePrice(); if (scoreData < p) return false; scoreData -= p; shopData.valueUpgrades += 1; persistScore(); persistShop(); return true })
ipcMain.handle('buy-auto-chase', () => { if (shopData.autoChase || scoreData < AUTO_CHASE_PRICE) return false; scoreData -= AUTO_CHASE_PRICE; shopData.autoChase = true; persistScore(); persistShop(); broadcastAutoChase(); return true })
ipcMain.handle('buy-speed', () => { if (!shopData.autoChase || shopData.speedUpgrades >= MAX_SPEED_UPGRADES || scoreData < SPEED_PRICE) return false; scoreData -= SPEED_PRICE; shopData.speedUpgrades += 1; persistScore(); persistShop(); broadcastChaseDuration(); return true })
ipcMain.handle('buy-dash', () => { if (shopData.dashLevel >= MAX_DASH_LEVEL || scoreData < DASH_PRICE) return false; scoreData -= DASH_PRICE; shopData.dashLevel += 1; persistScore(); persistShop(); broadcastDash(); return true })
ipcMain.handle('reset-all', () => {
  scoreData = 0
  shopData.quantityUpgrades = 0; shopData.valueUpgrades = 0
  shopData.autoChase = false; shopData.speedUpgrades = 0; shopData.dashLevel = 0
  persistScore(); persistShop()
  broadcastAutoChase(); broadcastChaseDuration(); broadcastDash()
  return true
})

ipcMain.handle('get-window-pos', (event) => {
  const entry = findEntry(event.sender)
  if (!entry || !entry.win) return [0, 0]
  const b = entry.win.getBounds()
  return [b.x, b.y]
})
ipcMain.handle('get-screen-size', () => screen.getPrimaryDisplay().workAreaSize)
ipcMain.handle('get-pet-size', () => [WIN_W, WIN_H])