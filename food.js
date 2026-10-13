const stage = document.getElementById('stage')

const FOOD_IMAGES = ['assets/food1.png', 'assets/food2.png']
const FALLBACK_COLOR = 'rgb(255, 180, 60)'

const GRAVITY = 1400
const FOOD_SIZE = 88
const GROUND_BOUNCE = 0.85
const FOOD_BOUNCE = 0.35
const AIR_FRICTION = 0.999
const GROUND_FRICTION = 0.92
const HIT_DELAY = 500

let screenW = window.innerWidth
let screenH = window.innerHeight

let foods = []
let petPositions = []
let running = false
let lastTime = 0
let spawnTimer = null
let endTimer = null
let cleanupTimer = null
let rafId = null
let reportTimer = null

let currentQuantityMultiplier = 1
let currentFoodValue = 1

// ===== 每张食物图片的平均颜色 =====
const foodColors = {}

function sampleColor(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = 24
        c.height = 24
        const cx = c.getContext('2d', { willReadFrequently: true })
        cx.drawImage(img, 0, 0, 24, 24)
        const data = cx.getImageData(0, 0, 24, 24).data
        let r = 0, g = 0, b = 0, count = 0
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 100) continue
          r += data[i]; g += data[i + 1]; b += data[i + 2]
          count++
        }
        if (count === 0) return resolve(FALLBACK_COLOR)
        resolve('rgb(' + Math.round(r / count) + ',' + Math.round(g / count) + ',' + Math.round(b / count) + ')')
      } catch (e) {
        console.warn('[food] sample failed:', url, e)
        resolve(FALLBACK_COLOR)
      }
    }
    img.onerror = () => {
      console.warn('[food] image load failed:', url)
      resolve(FALLBACK_COLOR)
    }
    img.src = url
  })
}

// 启动时采样所有食物颜色
FOOD_IMAGES.forEach((url) => {
  foodColors[url] = FALLBACK_COLOR
  sampleColor(url).then((c) => {
    foodColors[url] = c
    console.log('[food] color for', url, '=', c)
  })
})

// ===== IPC =====
window.addEventListener('resize', () => {
  screenW = window.innerWidth
  screenH = window.innerHeight
})

window.petAPI.onFoodStart((config) => {
  if (typeof config === 'number') {
    currentQuantityMultiplier = 1
    currentFoodValue = 1
    startEvent(config)
  } else {
    currentQuantityMultiplier = config.quantityMultiplier || 1
    currentFoodValue = config.foodValue || 1
    startEvent(config.duration || 15000)
  }
})

window.petAPI.onPetPositions((positions) => {
  petPositions = Array.isArray(positions) ? positions : []
})

window.petAPI.onDashSweep((info) => {
  if (!info) return
  const { x1, y1, x2, y2, petOffX, petOffY, petW, petH } = info
  const ax = x1 + petOffX + petW / 2
  const ay = y1 + petOffY + petH / 2
  const bx = x2 + petOffX + petW / 2
  const by = y2 + petOffY + petH / 2
  const radius = Math.max(petW, petH) / 2

  for (const f of foods) {
    if (f.hitAt) continue
    const cx = f.x + FOOD_SIZE / 2
    const cy = f.y + FOOD_SIZE / 2
    if (distToSegment(cx, cy, ax, ay, bx, by) < radius + FOOD_SIZE / 2) {
      f.hitAt = performance.now()
      f.frozen = true
      f.vx = 0
      f.vy = 0
      f.el.classList.add('hit')
    }
  }
})

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

function startEvent(duration) {
  foods.forEach(f => f.el.remove())
  foods = []
  running = true

  if (reportTimer) clearInterval(reportTimer)
  reportTimer = setInterval(() => {
    const list = foods.map(f => ({ x: f.x + FOOD_SIZE / 2, y: f.y + FOOD_SIZE / 2 }))
    window.petAPI.sendFoodPositions(list)
  }, 100)

  const spawn = () => {
    if (!running) return
    spawnFood()
    const baseInterval = 220 + Math.random() * 320
    const adjusted = baseInterval / currentQuantityMultiplier
    spawnTimer = setTimeout(spawn, Math.max(30, adjusted))
  }
  spawn()

  endTimer = setTimeout(() => {
    running = false
    if (spawnTimer) { clearTimeout(spawnTimer); spawnTimer = null }
    cleanupTimer = setTimeout(() => {
      foods.forEach(f => f.el.remove())
      foods = []
      if (reportTimer) { clearInterval(reportTimer); reportTimer = null }
      window.petAPI.sendFoodPositions([])
      window.petAPI.foodDone()
    }, 2000)
  }, duration)

  lastTime = performance.now()
  if (rafId) cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(tick)
}

function spawnFood() {
  const src = FOOD_IMAGES[Math.floor(Math.random() * FOOD_IMAGES.length)]
  const el = document.createElement('img')
  el.src = src
  el.className = 'food'
  el.style.width = FOOD_SIZE + 'px'
  el.style.height = FOOD_SIZE + 'px'
  el.draggable = false
  stage.appendChild(el)

  const x = Math.random() * Math.max(1, screenW - FOOD_SIZE)
  const y = -FOOD_SIZE - Math.random() * 80
  const vx = (Math.random() - 0.5) * 140
  const vy = Math.random() * 80

  const food = {
    el, x, y, vx, vy,
    hitAt: 0,
    frozen: false,
    src,
    color: foodColors[src] || FALLBACK_COLOR
  }
  foods.push(food)
  renderFood(food)
}

function renderFood(f) {
  f.el.style.transform = 'translate3d(' + f.x.toFixed(1) + 'px,' + f.y.toFixed(1) + 'px,0)'
}

function spawnPlusOne(x, y) {
  const el = document.createElement('div')
  el.className = 'plus-one'
  el.textContent = '+' + currentFoodValue
  el.style.left = x.toFixed(0) + 'px'
  el.style.top  = y.toFixed(0) + 'px'
  stage.appendChild(el)
  setTimeout(() => el.remove(), 950)
}

function tick(now) {
  rafId = requestAnimationFrame(tick)
  if (!running && foods.length === 0) return

  const dt = Math.min((now - lastTime) / 1000, 0.033)
  lastTime = now

  for (const f of foods) {
    if (f.frozen) continue
    f.vy += GRAVITY * dt
    f.vx *= AIR_FRICTION
    f.vy *= AIR_FRICTION
    f.x += f.vx * dt
    f.y += f.vy * dt

    if (f.x < 0) { f.x = 0; f.vx = -f.vx * GROUND_BOUNCE }
    else if (f.x + FOOD_SIZE > screenW) { f.x = screenW - FOOD_SIZE; f.vx = -f.vx * GROUND_BOUNCE }

    const groundY = screenH - FOOD_SIZE
    if (f.y > groundY) {
      f.y = groundY
      if (Math.abs(f.vy) < 40) { f.vy = 0; f.vx *= GROUND_FRICTION }
      else { f.vy = -f.vy * GROUND_BOUNCE }
    }
  }

  for (let i = 0; i < foods.length; i++) {
    if (foods[i].frozen) continue
    for (let j = i + 1; j < foods.length; j++) {
      if (foods[j].frozen) continue
      resolveCollision(foods[i], foods[j])
    }
  }

  for (let i = foods.length - 1; i >= 0; i--) {
    const f = foods[i]
    const cx = f.x + FOOD_SIZE / 2
    const cy = f.y + FOOD_SIZE / 2

    if (f.hitAt && now - f.hitAt >= HIT_DELAY) {
      window.petAPI.foodExploded({ x: cx, y: cy, foodSize: FOOD_SIZE, color: f.color })
      spawnPlusOne(cx, cy)
      f.el.remove()
      foods.splice(i, 1)
      window.petAPI.addScore(currentFoodValue)
      continue
    }

    if (f.hitAt) continue

    if (isEaten(f)) {
      spawnPlusOne(cx, cy)
      f.el.remove()
      foods.splice(i, 1)
      window.petAPI.addScore(currentFoodValue)
    }
  }

  for (const f of foods) renderFood(f)
}

function resolveCollision(a, b) {
  const ax = a.x + FOOD_SIZE / 2, ay = a.y + FOOD_SIZE / 2
  const bx = b.x + FOOD_SIZE / 2, by = b.y + FOOD_SIZE / 2
  const dx = ax - bx, dy = ay - by
  const dist = Math.hypot(dx, dy)
  const minDist = FOOD_SIZE * 0.85
  if (dist >= minDist || dist === 0) return
  const nx = dx / dist, ny = dy / dist
  const overlap = minDist - dist
  a.x += nx * overlap * 0.5; a.y += ny * overlap * 0.5
  b.x -= nx * overlap * 0.5; b.y -= ny * overlap * 0.5
  const rvx = a.vx - b.vx, rvy = a.vy - b.vy
  const velAlongNormal = rvx * nx + rvy * ny
  if (velAlongNormal > 0) return
  const impulse = -(1 + FOOD_BOUNCE) * velAlongNormal / 2
  a.vx += impulse * nx; a.vy += impulse * ny
  b.vx -= impulse * nx; b.vy -= impulse * ny
}

function isEaten(f) {
  const cx = f.x + FOOD_SIZE / 2
  const cy = f.y + FOOD_SIZE / 2
  for (const p of petPositions) {
    if (cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h) return true
  }
  return false
}