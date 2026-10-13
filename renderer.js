if (!window.petAPI) console.error('[renderer] petAPI missing!')

const pet = document.getElementById('pet')
const wrapper = document.getElementById('pet-wrapper')
const anchor = document.getElementById('pet-anchor')
const bubble = document.getElementById('bubble')

let phrases = ['嘟嘟!!', 'Can i use my laptop?', '邹邦强? 邹邦弱!']

let isDragging = false
let isPressing = false
let downX = 0
let downY = 0
let walkTimer = null
let nextWalkTimer = null
let hideBubbleTimer = null
let flashTimer = null
let crazyTimer = null
let crazyMoveTimer = null
let crazyActive = false
let mode = 'move'
let menuOpen = false
let autoChase = false
let latestFoods = []
let chaseLoopActive = false
let chaseDuration = 220

let dashLevel = 0
let dashCd = 0
let dashTimer = null
let dashing = false
let dashAborted = false          // ← 新增：中断冲刺

// 挂起的 walkTo resolve
let walkResolve = null

const CLICK_MOVE_THRESHOLD = 5
const PET_OFFSET_X = 160
const PET_OFFSET_Y = 170
const PET_RECT_OFFX = 70
const PET_RECT_OFFY = 80
const PET_RECT_W = 180
const PET_RECT_H = 180
const IDLE_MIN = 3000
const IDLE_MAX = 6000
const DASH_DURATION = 220
const DASH_CHARGE = 200
const DASH_COOLDOWN = 200
const DASH_SECTORS = 16

const FLASH_SOUND_URL = 'assets/find_main_sound.mp4'
let audioCtx = null
let flashBuffer = null
let audioReady = false

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function initAudio() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    const res = await fetch(FLASH_SOUND_URL)
    const arr = await res.arrayBuffer()
    flashBuffer = await audioCtx.decodeAudioData(arr)
    audioReady = true
  } catch (e) { console.error('[audio] init failed:', e) }
}
function playFlashSound() {
  if (!audioReady || !audioCtx || !flashBuffer) return
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const src = audioCtx.createBufferSource()
    src.buffer = flashBuffer
    src.connect(audioCtx.destination)
    src.start(0)
  } catch (e) {}
}
initAudio()

if (window.petAPI) {
  window.petAPI.getPhrases().then(list => {
    if (Array.isArray(list) && list.length > 0) phrases = list
  }).catch(() => {})
  window.petAPI.onPhrasesUpdated((list) => { if (Array.isArray(list)) phrases = list })

  window.petAPI.onSetAutoChase((enabled) => {
    const wasOn = autoChase
    autoChase = !!enabled
    if (autoChase && !wasOn && mode === 'move' && !menuOpen && !crazyActive) {
      if (nextWalkTimer) { clearTimeout(nextWalkTimer); nextWalkTimer = null }
      stopWalking(); startChaseLoop()
    }
  })
  window.petAPI.onSetChaseDuration((d) => { if (typeof d === 'number' && d > 0) chaseDuration = d })
  window.petAPI.onSetDash((cfg) => {
    if (!cfg) return
    dashLevel = Math.max(0, cfg.level || 0)
    dashCd = Math.max(0, cfg.cd || 0)
    restartDashLoop()
  })
  window.petAPI.onFoodPositions((list) => { latestFoods = Array.isArray(list) ? list : [] })

  window.petAPI.onFlash(() => {
    anchor.classList.remove('flashing')
    void anchor.offsetWidth
    anchor.classList.add('flashing')
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => { anchor.classList.remove('flashing'); flashTimer = null }, 1200)
    playFlashSound()
  })
  window.petAPI.onCrazyStart((duration) => { startCrazy(duration || 5000) })

  window.petAPI.onSetMode((newMode) => {
    mode = newMode
    if (mode === 'still') {
      // 中断一切
      dashAborted = true
      stopWalking(); stopChaseLoop()
      if (nextWalkTimer) { clearTimeout(nextWalkTimer); nextWalkTimer = null }
      if (dashTimer) { clearTimeout(dashTimer); dashTimer = null }
      pet.classList.remove('walking')
    } else if (!menuOpen && !crazyActive) {
      scheduleNextWalk(1500 + Math.random() * 2000)
      restartDashLoop()
    }
  })

  window.petAPI.onSetMenuOpen((open) => {
    menuOpen = open
    if (menuOpen) {
      dashAborted = true
      if (nextWalkTimer) { clearTimeout(nextWalkTimer); nextWalkTimer = null }
      stopWalking(); stopChaseLoop()
      if (hideBubbleTimer) { clearTimeout(hideBubbleTimer); hideBubbleTimer = null }
      bubble.classList.remove('show')
    } else {
      if (mode === 'move' && !crazyActive) {
        scheduleNextWalk(500)
        restartDashLoop()
      }
    }
  })
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  e.preventDefault()
  isPressing = true; isDragging = false
  downX = e.screenX; downY = e.screenY
  document.body.classList.add('dragging')
  // ↓ 中断一切正在跑的循环，防止它们把窗口拉回旧位置
  dashAborted = true
  if (nextWalkTimer) { clearTimeout(nextWalkTimer); nextWalkTimer = null }
  if (crazyTimer) { clearTimeout(crazyTimer); crazyTimer = null }
  if (crazyMoveTimer) { clearTimeout(crazyMoveTimer); crazyMoveTimer = null }
  if (dashTimer) { clearTimeout(dashTimer); dashTimer = null }
  stopWalking()
  stopChaseLoop()
  if (window.petAPI) window.petAPI.startDrag()
}, true)

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return
  if (!isPressing) return
  isPressing = false
  document.body.classList.remove('dragging')
  if (window.petAPI) window.petAPI.endDrag()
  const moved = Math.abs(e.screenX - downX) + Math.abs(e.screenY - downY)
  if (moved < CLICK_MOVE_THRESHOLD) {
    speakRandom()
    if (mode === 'move' && !menuOpen && !crazyActive) {
      if (autoChase) startChaseLoop()
      else scheduleNextWalk(2000 + Math.random() * 2000)
    }
    restartDashLoop()
  } else {
    if (mode === 'move' && !menuOpen && !crazyActive) {
      setTimeout(() => {
        if (mode === 'move' && !menuOpen && !crazyActive && !isPressing) {
          if (autoChase) startChaseLoop()
          else scheduleNextWalk(2000 + Math.random() * 2000)
        }
        restartDashLoop()
      }, 800)
    } else {
      restartDashLoop()
    }
  }
}, true)

window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  if (isPressing) {
    isPressing = false; isDragging = false
    document.body.classList.remove('dragging')
    if (window.petAPI) window.petAPI.endDrag()
  }
  if (window.petAPI) window.petAPI.showContextMenu({ x: e.screenX, y: e.screenY })
})

window.addEventListener('blur', () => {
  if (isPressing) {
    isPressing = false; isDragging = false
    document.body.classList.remove('dragging')
    if (window.petAPI) window.petAPI.endDrag()
  }
})

function speakRandom() {
  if (!phrases || phrases.length === 0) return
  const text = phrases[Math.floor(Math.random() * phrases.length)]
  bubble.textContent = text
  bubble.classList.add('show')
  if (hideBubbleTimer) clearTimeout(hideBubbleTimer)
  hideBubbleTimer = setTimeout(() => { bubble.classList.remove('show'); hideBubbleTimer = null }, 2500)
}

function faceDirection(dx) {
  if (dx > 5)      wrapper.classList.add('facing-right')
  else if (dx < -5) wrapper.classList.remove('facing-right')
}

async function startCrazy(duration) {
  stopWalking(); stopChaseLoop()
  if (nextWalkTimer) { clearTimeout(nextWalkTimer); nextWalkTimer = null }
  if (crazyTimer) { clearTimeout(crazyTimer); crazyTimer = null }
  if (crazyMoveTimer) { clearTimeout(crazyMoveTimer); crazyMoveTimer = null }
  crazyActive = true
  anchor.classList.add('crazy')

  const { width, height } = await window.petAPI.getScreenSize()
  const [winW, winH] = await window.petAPI.getPetSize()
  const maxX = Math.max(1, width - winW)
  const maxY = Math.max(1, height - winH)

  const loop = async () => {
    if (!crazyActive) return
    const tx = Math.floor(Math.random() * maxX)
    const ty = Math.floor(Math.random() * maxY)
    await crazyMove(tx, ty, 240)
    if (crazyActive) crazyMoveTimer = setTimeout(loop, 20)
  }
  loop()

  crazyTimer = setTimeout(() => {
    crazyActive = false
    anchor.classList.remove('crazy')
    if (crazyMoveTimer) { clearTimeout(crazyMoveTimer); crazyMoveTimer = null }
    if (mode === 'move' && !menuOpen) scheduleNextWalk(800)
  }, duration)
}

async function crazyMove(tx, ty, duration) {
  const [x0, y0] = await window.petAPI.getWindowPos()
  const start = performance.now()
  return new Promise((resolve) => {
    const id = setInterval(() => {
      if (!crazyActive) { clearInterval(id); resolve(); return }
      const t = Math.min((performance.now() - start) / duration, 1)
      window.petAPI.moveWindow(Math.round(x0 + (tx - x0) * t), Math.round(y0 + (ty - y0) * t))
      if (t >= 1) { clearInterval(id); resolve() }
    }, 16)
  })
}

// ===== 中断安全的 stopWalking =====
function stopWalking() {
  if (walkTimer) { clearInterval(walkTimer); walkTimer = null }
  pet.classList.remove('walking')
  if (walkResolve) {
    const r = walkResolve
    walkResolve = null
    try { r() } catch (e) {}
  }
}
function stopChaseLoop() { chaseLoopActive = false; pet.classList.remove('walking') }
function startChaseLoop() {
  if (chaseLoopActive) return
  chaseLoopActive = true
  setTimeout(chaseLoopTick, 0)
}

async function chaseLoopTick() {
  if (!chaseLoopActive) return
  if (mode !== 'move' || menuOpen || crazyActive || !autoChase) {
    chaseLoopActive = false; return
  }
  if (latestFoods && latestFoods.length > 0) {
    let target = null
    try { target = await pickChaseTarget() } catch (e) {}
    if (!chaseLoopActive) return
    if (target) {
      try { await chaseMove(target.x, target.y, chaseDuration) } catch (e) {}
      if (!chaseLoopActive) return
      setTimeout(() => { if (chaseLoopActive) chaseLoopTick() }, 0)
      return
    }
  }
  const { width, height } = await window.petAPI.getScreenSize()
  const [winW, winH] = await window.petAPI.getPetSize()
  const tx = Math.floor(Math.random() * Math.max(1, width - winW))
  const ty = Math.floor(Math.random() * Math.max(1, height - winH))
  try { await walkTo(tx, ty) } catch (e) {}
  if (!chaseLoopActive) return
  const idle = IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN)
  setTimeout(() => { if (chaseLoopActive) chaseLoopTick() }, idle)
}

async function pickChaseTarget() {
  if (!latestFoods || latestFoods.length === 0) return null
  const [x0, y0] = await window.petAPI.getWindowPos()
  const cx = x0 + PET_OFFSET_X
  const cy = y0 + PET_OFFSET_Y
  let best = null, bestDist = Infinity
  for (const f of latestFoods) {
    const dx = f.x - cx, dy = f.y - cy
    const d = dx * dx + dy * dy
    if (d < bestDist) { bestDist = d; best = f }
  }
  if (!best) return null
  return { x: best.x - PET_OFFSET_X, y: best.y - PET_OFFSET_Y }
}

async function chaseMove(tx, ty, duration) {
  if (mode !== 'move' || menuOpen || crazyActive) return
  const [x0, y0] = await window.petAPI.getWindowPos()
  faceDirection(tx - x0)
  pet.classList.add('walking')
  const start = performance.now()
  return new Promise((resolve) => {
    const step = () => {
      if (mode !== 'move' || menuOpen || crazyActive || !chaseLoopActive) {
        pet.classList.remove('walking'); resolve(); return
      }
      const t = Math.min((performance.now() - start) / duration, 1)
      window.petAPI.moveWindow(Math.round(x0 + (tx - x0) * t), Math.round(y0 + (ty - y0) * t))
      if (t >= 1) { pet.classList.remove('walking'); resolve(); return }
      requestAnimationFrame(step)
    }
    step()
  })
}

// ===== walkTo：中断时会 resolve，不挂起 =====
async function walkTo(tx, ty, customDuration) {
  if (mode !== 'move' || menuOpen || crazyActive) return
  const [x0, y0] = await window.petAPI.getWindowPos()
  faceDirection(tx - x0)
  const duration = customDuration || (1400 + Math.random() * 1600)
  const start = performance.now()
  pet.classList.add('walking')
  return new Promise((resolve) => {
    let resolved = false
    const done = () => {
      if (resolved) return
      resolved = true
      if (walkTimer) { clearInterval(walkTimer); walkTimer = null }
      if (walkResolve === done) walkResolve = null
      pet.classList.remove('walking')
      resolve()
    }
    walkResolve = done
    walkTimer = setInterval(() => {
      if (mode !== 'move' || menuOpen || crazyActive) { done(); return }
      const t = Math.min((performance.now() - start) / duration, 1)
      const ease = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2
      window.petAPI.moveWindow(Math.round(x0 + (tx - x0) * ease), Math.round(y0 + (ty - y0) * ease))
      if (t >= 1) { done() }
    }, 33)
  })
}

function scheduleNextWalk(delay) {
  if (mode !== 'move' || menuOpen || crazyActive) return
  if (autoChase) { startChaseLoop(); return }
  const wait = delay ?? (5000 + Math.random() * 6000)
  if (nextWalkTimer) clearTimeout(nextWalkTimer)
  nextWalkTimer = setTimeout(async () => {
    if (isDragging || isPressing || menuOpen || crazyActive) return
    if (mode !== 'move') return
    if (autoChase) { startChaseLoop(); return }
    const { width, height } = await window.petAPI.getScreenSize()
    const [winW, winH] = await window.petAPI.getPetSize()
    const tx = Math.floor(Math.random() * Math.max(1, width - winW))
    const ty = Math.floor(Math.random() * Math.max(1, height - winH))
    await walkTo(tx, ty)
    if (mode === 'move' && !menuOpen && !crazyActive && !autoChase) scheduleNextWalk()
  }, wait)
}

// ===== 冲刺 =====
function restartDashLoop() {
  if (dashTimer) { clearTimeout(dashTimer); dashTimer = null }
  if (dashLevel < 1 || dashCd <= 0) return
  dashTimer = setTimeout(async () => {
    if (mode === 'move' && !menuOpen && !crazyActive && !dashing && !isDragging && !isPressing) {
      try { await doDash() } catch (e) { dashing = false }
    }
    restartDashLoop()
  }, dashCd)
}

async function pickDashDirection() {
  const { width, height } = await window.petAPI.getScreenSize()
  const [x0, y0] = await window.petAPI.getWindowPos()
  if (!latestFoods || latestFoods.length === 0) return null
  const pcx = x0 + PET_RECT_OFFX + PET_RECT_W / 2
  const pcy = y0 + PET_RECT_OFFY + PET_RECT_H / 2
  const sectorCounts = new Array(DASH_SECTORS).fill(0)
  const sectorSumX = new Array(DASH_SECTORS).fill(0)
  const sectorSumY = new Array(DASH_SECTORS).fill(0)
  const sectorOf = 2 * Math.PI / DASH_SECTORS
  let totalInRange = 0
  for (const f of latestFoods) {
    const dx = f.x - pcx, dy = f.y - pcy
    if (dx * dx + dy * dy < 4) continue
    let ang = Math.atan2(dy, dx)
    if (ang < 0) ang += 2 * Math.PI
    let idx = Math.floor(ang / sectorOf)
    if (idx < 0) idx = 0
    if (idx >= DASH_SECTORS) idx = DASH_SECTORS - 1
    sectorCounts[idx]++; sectorSumX[idx] += f.x; sectorSumY[idx] += f.y; totalInRange++
  }
  if (totalInRange === 0) {
    let best = null, bestDist = Infinity
    for (const f of latestFoods) {
      const d = (f.x - pcx) ** 2 + (f.y - pcy) ** 2
      if (d < bestDist) { bestDist = d; best = f }
    }
    if (!best) return null
    const dx = best.x - pcx, dy = best.y - pcy
    const len = Math.hypot(dx, dy) || 1
    return { dirX: dx / len, dirY: dy / len }
  }
  let bestIdx = 0, bestCount = sectorCounts[0]
  for (let i = 1; i < DASH_SECTORS; i++) {
    if (sectorCounts[i] > bestCount) { bestCount = sectorCounts[i]; bestIdx = i }
  }
  const avgX = sectorSumX[bestIdx] / sectorCounts[bestIdx]
  const avgY = sectorSumY[bestIdx] / sectorCounts[bestIdx]
  let dirX = avgX - pcx, dirY = avgY - pcy
  const len = Math.hypot(dirX, dirY) || 1
  return { dirX: dirX / len, dirY: dirY / len }
}

function rayToEdge(dirX, dirY, pcx, pcy, width, height) {
  const xMin = PET_RECT_W / 2, xMax = width - PET_RECT_W / 2
  const yMin = PET_RECT_H / 2, yMax = height - PET_RECT_H / 2
  let tMin = Infinity
  if (Math.abs(dirX) > 1e-6) {
    const t = dirX > 0 ? (xMax - pcx) / dirX : (xMin - pcx) / dirX
    if (t > 0 && t < tMin) tMin = t
  }
  if (Math.abs(dirY) > 1e-6) {
    const t = dirY > 0 ? (yMax - pcy) / dirY : (yMin - pcy) / dirY
    if (t > 0 && t < tMin) tMin = t
  }
  if (!isFinite(tMin)) return null
  const tcx = pcx + dirX * tMin
  const tcy = pcy + dirY * tMin
  return { wx: tcx - PET_RECT_OFFX - PET_RECT_W / 2, wy: tcy - PET_RECT_OFFY - PET_RECT_H / 2, distance: tMin }
}

async function doDash() {
  if (dashing) return
  if (!latestFoods || latestFoods.length === 0) return
  if (mode !== 'move' || menuOpen || crazyActive) return
  dashing = true
  dashAborted = false                  // ← 每次开始清空
  try {
    stopWalking(); stopChaseLoop()
    if (nextWalkTimer) { clearTimeout(nextWalkTimer); nextWalkTimer = null }

    const { width, height } = await window.petAPI.getScreenSize()
    const [x0, y0] = await window.petAPI.getWindowPos()
    const pcx = x0 + PET_RECT_OFFX + PET_RECT_W / 2
    const pcy = y0 + PET_RECT_OFFY + PET_RECT_H / 2

    let dirInfo = null
    try { dirInfo = await pickDashDirection() } catch (e) {}
    if (dashAborted) return           // ← 中断
    if (!dirInfo) return

    const edge = rayToEdge(dirInfo.dirX, dirInfo.dirY, pcx, pcy, width, height)
    if (!edge) return

    const tx = edge.wx, ty = edge.wy
    if (dirInfo.dirX > 0.05) wrapper.classList.add('facing-right')
    else if (dirInfo.dirX < -0.05) wrapper.classList.remove('facing-right')

    anchor.classList.remove('charging')
    void anchor.offsetWidth
    anchor.classList.add('charging')
    await sleep(DASH_CHARGE)
    if (dashAborted) { anchor.classList.remove('charging'); return }   // ← 中断
    anchor.classList.remove('charging')

    if (mode !== 'move' || menuOpen || crazyActive) return

    window.petAPI.dashStarted({
      x1: x0, y1: y0, x2: tx, y2: ty,
      petOffX: PET_RECT_OFFX, petOffY: PET_RECT_OFFY, petW: PET_RECT_W, petH: PET_RECT_H
    })

    const start = performance.now()
    await new Promise((resolve) => {
      const step = () => {
        if (dashAborted || mode !== 'move' || menuOpen || crazyActive) { resolve(); return }   // ← 中断
        const t = Math.min((performance.now() - start) / DASH_DURATION, 1)
        const ease = t * t * (3 - 2 * t)
        window.petAPI.moveWindow(Math.round(x0 + (tx - x0) * ease), Math.round(y0 + (ty - y0) * ease))
        if (t >= 1) { resolve(); return }
        requestAnimationFrame(step)
      }
      step()
    })

    await sleep(DASH_COOLDOWN)
  } finally {
    dashing = false
  }
  if (!dashAborted && mode === 'move' && !menuOpen && !crazyActive) scheduleNextWalk(500)
}

restartDashLoop()
scheduleNextWalk(2000 + Math.random() * 5000)

pet.addEventListener('error', () => {
  console.error('pet.png failed to load. Check the file name and path.')
})