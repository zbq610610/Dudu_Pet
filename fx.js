const canvas = document.getElementById('fx')
const ctx = canvas.getContext('2d')

let particles = []
let lastTime = performance.now()

const DEFAULT_FOOD_COLOR = 'rgb(255, 180, 60)'

function resize() {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  ctx.imageSmoothingEnabled = false
}
window.addEventListener('resize', resize)
resize()

// 把 "rgb(r,g,b)" 按系数调亮/调暗
function varyColor(rgbStr, factor) {
  const m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(rgbStr || '')
  if (!m) return rgbStr || DEFAULT_FOOD_COLOR
  const r = Math.min(255, Math.round(parseInt(m[1], 10) * factor))
  const g = Math.min(255, Math.round(parseInt(m[2], 10) * factor))
  const b = Math.min(255, Math.round(parseInt(m[3], 10) * factor))
  return 'rgb(' + r + ',' + g + ',' + b + ')'
}

// ===== 冲刺轨迹粒子（保持霓虹色，不属于食物） =====
window.petAPI.onDrawDashTrail((info) => {
  if (!info) return
  const { x1, y1, x2, y2, petOffX, petOffY, petW, petH } = info
  const ax = x1 + petOffX + petW / 2
  const ay = y1 + petOffY + petH / 2
  const bx = x2 + petOffX + petW / 2
  const by = y2 + petOffY + petH / 2

  const dx = bx - ax
  const dy = by - ay
  const dist = Math.hypot(dx, dy)
  const count = Math.max(30, Math.floor(dist / 4))

  for (let i = 0; i < count; i++) {
    const t = i / count
    const px = ax + dx * t + (Math.random() - 0.5) * 90
    const py = ay + dy * t + (Math.random() - 0.5) * 90
    const hue = 180 + Math.random() * 140
    particles.push({
      x: px, y: py,
      vx: (Math.random() - 0.5) * 120,
      vy: (Math.random() - 0.5) * 120,
      life: 1.0,
      decay: 0.018 + Math.random() * 0.025,
      size: 3 + Math.random() * 5,
      color: 'hsl(' + hue + ', 100%, 65%)',
      gravity: 40
    })
  }
})

// ===== 食物爆裂粒子（用食物本身的颜色） =====
window.petAPI.onSpawnFoodParticles((info) => {
  if (!info) return
  const { x, y, foodSize, color } = info
  const baseColor = color || DEFAULT_FOOD_COLOR
  const count = 36
  const half = (foodSize || 60) / 2

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 80 + Math.random() * 260
    const factor = 0.7 + Math.random() * 0.6   // 亮度变化 0.7 ~ 1.3
    particles.push({
      x: x + (Math.random() - 0.5) * half,
      y: y + (Math.random() - 0.5) * half,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 120,
      life: 1.0,
      decay: 0.008 + Math.random() * 0.014,
      size: 3 + Math.random() * 5,
      color: varyColor(baseColor, factor),
      gravity: 380
    })
  }
})

function drawSquare(cx, cy, size, alpha, color) {
  const s = Math.max(2, Math.round(size))
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.fillRect(Math.round(cx - s / 2), Math.round(cy - s / 2), s, s)
}

function tick(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.033)
  lastTime = now

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.vx *= 0.96
    p.vy *= 0.96
    if (p.gravity) p.vy += p.gravity * dt
    p.life -= p.decay

    if (p.life <= 0) { particles.splice(i, 1); continue }

    drawSquare(p.x, p.y, p.size * p.life * 2.2 * 2, p.life * 0.35, p.color)
    drawSquare(p.x, p.y, p.size * p.life * 2, p.life, p.color)
  }

  ctx.globalAlpha = 1
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

console.log('[fx] ready (pixel mode)')