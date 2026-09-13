import { useEffect, useRef } from 'react'

const BAR_COUNT = 36

function barHeights(t: number, reduce: boolean) {
  const heights: number[] = []
  for (let i = 0; i < BAR_COUNT; i += 1) {
    const wave = Math.sin(i * 0.37 + t * 2.1) * 0.28
    const pulse = Math.sin(i * 0.9 - t * 3.4) * 0.18
    const base = 0.22 + ((i * 17) % 11) / 40
    const peak = i === 22 ? 0.42 : 0
    const value = reduce ? 0.18 + ((i * 13) % 9) / 28 + (i === 22 ? 0.45 : 0) : base + wave + pulse + peak
    heights.push(Math.max(0.08, Math.min(1, value)))
  }
  return heights
}

export default function AudioWaveform({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    let running = true
    let width = 0
    let height = 0
    let dpr = 1

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      dpr = Math.max(1, window.devicePixelRatio || 1)
      width = Math.max(1, Math.round(rect.width))
      height = Math.max(1, Math.round(rect.height))
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height)
      const heights = barHeights(t, reduce)
      const gap = Math.max(3, width / (BAR_COUNT * 1.7))
      const barWidth = Math.max(2, Math.min(4, (width - gap * (BAR_COUNT - 1)) / BAR_COUNT))
      const mid = height / 2
      const isDark = document.documentElement.classList.contains('dark')
      const peakColor = isDark ? '#ffffff' : '#0d0d12'
      const waveColor = isDark ? 'rgba(244,244,247,0.78)' : 'rgba(13,13,18,0.72)'

      heights.forEach((value, i) => {
        const h = Math.max(6, value * height * 0.88)
        const total = BAR_COUNT * barWidth + (BAR_COUNT - 1) * gap
        const origin = (width - total) / 2
        const x = origin + i * (barWidth + gap)
        const y = mid - h / 2
        const isPeak = i === 22
        ctx.fillStyle = isPeak ? peakColor : waveColor
        const radius = 1
        ctx.beginPath()
        ctx.roundRect(x, y, barWidth, h, radius)
        ctx.fill()
      })
    }

    resize()
    draw(0)

    const onResize = () => {
      resize()
      if (reduce) draw(0)
    }
    const observer = new ResizeObserver(onResize)
    observer.observe(canvas)

    const themeObserver = new MutationObserver(() => {
      if (reduce) draw(0)
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    if (!reduce) {
      const start = performance.now()
      const tick = (now: number) => {
        if (!running) return
        frame = requestAnimationFrame(tick)
        draw((now - start) / 1000)
      }
      frame = requestAnimationFrame(tick)
    }

    return () => {
      running = false
      cancelAnimationFrame(frame)
      observer.disconnect()
      themeObserver.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label="audio waveform"
    />
  )
}
