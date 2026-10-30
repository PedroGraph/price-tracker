import { useEffect, useState } from 'react'

/**
 * Picks the backdrop for a product photo from the photo itself.
 *
 * Amazon product shots sit on their own background: usually plain white, but
 * often a colored studio sweep or a scene with two or three tones. Sampling
 * the perimeter (not the product in the middle) tells us what the photo fades
 * into, so the card can continue that color instead of framing the image in a
 * white sticker. One dominant tone becomes a solid fill; two or three become a
 * gradient ordered the way they appear in the image.
 */

export type Stage = {
  /** Ready-to-use CSS `background` value. */
  background: string
  /** True when the backdrop behind the badges is dark enough to need light chips. */
  dark: boolean
}

export type Pixel = { r: number; g: number; b: number; x: number; y: number }

const FALLBACK: Stage = { background: '#ffffff', dark: false }

const cache = new Map<string, Stage>()
const inflight = new Map<string, Promise<Stage>>()

const CANVAS = 64
/** How much of each side we sample. Product photos bleed to the edges, so a thin frame reads best. */
const RING = 5
/** Below this, the bands are effectively one color. */
const FLAT = 20
/** Only the top band sits behind the badges, so it decides their contrast. */
const BADGE_BAND = 0.36

/** Linear-light luminance, 0 (black) to 1 (white). */
function luminance(p: { r: number; g: number; b: number }): number {
  const channel = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(p.r) + 0.7152 * channel(p.g) + 0.0722 * channel(p.b)
}

const hex = (v: number): string => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
const css = (c: { r: number; g: number; b: number }): string => `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`

const chroma = (c: { r: number; g: number; b: number }): number => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)
const isWhite = (c: { r: number; g: number; b: number }): boolean => luminance(c) >= 0.9 && chroma(c) <= 12

function distance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
}

function average(pixels: Pixel[]): { r: number; g: number; b: number } {
  if (pixels.length === 0) return { r: 255, g: 255, b: 255 }
  const sum = pixels.reduce((acc, p) => ({ r: acc.r + p.r, g: acc.g + p.g, b: acc.b + p.b }), { r: 0, g: 0, b: 0 })
  return { r: sum.r / pixels.length, g: sum.g / pixels.length, b: sum.b / pixels.length }
}

/** Average color of three slices along one axis: start, middle, end. */
function bands(pixels: Pixel[], axis: 'x' | 'y'): [{ r: number; g: number; b: number }, { r: number; g: number; b: number }, { r: number; g: number; b: number }] {
  const slice = (from: number, to: number): Pixel[] => pixels.filter((p) => p[axis] >= from && p[axis] < to)
  return [average(slice(0, 1 / 3)), average(slice(1 / 3, 2 / 3)), average(slice(2 / 3, 1))]
}

function spread(colors: { r: number; g: number; b: number }[]): number {
  let widest = 0
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) widest = Math.max(widest, distance(colors[i], colors[j]))
  }
  return widest
}

/** Whether chips sitting on the top-left of the photo need light text. */
function badgeDark(pixels: Pixel[]): boolean {
  const zone = pixels.filter((p) => p.y <= BADGE_BAND && p.x <= 0.6)
  return luminance(average(zone.length > 0 ? zone : pixels)) < 0.42
}

/** Turns perimeter samples into the CSS we paint. Pure, so it can be tested without a browser. */
export function stageFromPixels(pixels: Pixel[]): Stage {
  if (pixels.length === 0) return FALLBACK

  const overall = average(pixels)
  const dark = badgeDark(pixels)

  // A product shot can fill the frame and hide the sweep from the perimeter
  // (a laptop leaves only slivers of white). A white corner still proves the
  // photo sits on white, so the stage stays white instead of taking the
  // product's colors and framing it in a visible rectangle.
  const corner = (fx: (x: number) => boolean, fy: (y: number) => boolean): boolean => {
    const patch = pixels.filter((p) => fx(p.x) && fy(p.y))
    return patch.length > 0 && isWhite(average(patch))
  }
  const whiteCorner =
    corner((x) => x < 0.14, (y) => y < 0.14) ||
    corner((x) => x >= 0.86, (y) => y < 0.14) ||
    corner((x) => x < 0.14, (y) => y >= 0.86) ||
    corner((x) => x >= 0.86, (y) => y >= 0.86)
  if (whiteCorner) return { background: '#ffffff', dark }

  // Amazon's default is a white sweep, and the product often touches the
  // frame. If most of the perimeter is white, that is the background.
  const pale = pixels.filter((p) => luminance(p) >= 0.82)
  if (pale.length / pixels.length >= 0.55) {
    const sweep = average(pale)
    // Snap a true white sweep to pure white so the photo has no visible seam.
    const pure = sweep.r >= 248 && sweep.g >= 248 && sweep.b >= 248
    return { background: pure ? '#ffffff' : css(sweep), dark }
  }

  // The mirror case: a black studio sweep.
  const deep = pixels.filter((p) => luminance(p) <= 0.02)
  if (deep.length / pixels.length >= 0.6) {
    return { background: css(average(deep)), dark: true }
  }

  const horizontal = bands(pixels, 'x')
  const vertical = bands(pixels, 'y')
  const h = spread(horizontal)
  const v = spread(vertical)

  // A wall with uneven lighting, but no real second color.
  if (Math.max(h, v) < FLAT) return { background: css(overall), dark }

  const useX = h >= v
  const [start, middle, end] = useX ? horizontal : vertical
  const angle = useX ? '100deg' : '180deg'

  // A midpoint that matches either end adds nothing but mud.
  const stops =
    distance(start, middle) < 18 || distance(end, middle) < 18
      ? [start, end]
      : [start, middle, end]

  const colors = stops.map((c) => css(c))
  const rendered = colors.map((c, i) => `${c} ${Math.round((i / (colors.length - 1)) * 100)}%`)
  return { background: `linear-gradient(${angle}, ${rendered.join(', ')})`, dark }
}

function readPixels(image: HTMLImageElement): ImageData | null {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS
  canvas.height = CANVAS
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  // Photos with transparency should read as the white Amazon uses, not as black.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CANVAS, CANVAS)
  ctx.drawImage(image, 0, 0, CANVAS, CANVAS)
  try {
    return ctx.getImageData(0, 0, CANVAS, CANVAS)
  } catch {
    // A cross-origin image without CORS headers taints the canvas.
    return null
  }
}

function settle(image: HTMLImageElement): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      resolve()
    }
    // A broken URL or a stalled CDN must not keep the card waiting forever.
    const timer = setTimeout(finish, 8000)
    const end = (): void => {
      clearTimeout(timer)
      finish()
    }
    if (image.complete) end()
    else {
      image.addEventListener('load', end, { once: true })
      image.addEventListener('error', end, { once: true })
    }
  })
}

function cornerSweep(image: HTMLImageElement): boolean {
  const w = image.naturalWidth
  const h = image.naturalHeight
  const size = Math.max(8, Math.round(Math.min(w, h) * 0.05))
  const canvas = document.createElement('canvas')
  canvas.width = 12
  canvas.height = 12
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  const spots: Array<[number, number]> = [
    [0, 0],
    [w - size, 0],
    [0, h - size],
    [w - size, h - size]
  ]
  for (const [sx, sy] of spots) {
    ctx.clearRect(0, 0, 12, 12)
    try {
      ctx.drawImage(image, sx, sy, size, size, 0, 0, 12, 12)
      const data = ctx.getImageData(0, 0, 12, 12).data
      let r = 0
      let g = 0
      let b = 0
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]
        g += data[i + 1]
        b += data[i + 2]
      }
      const n = data.length / 4
      if (isWhite({ r: r / n, g: g / n, b: b / n })) return true
    } catch {
      return false
    }
  }
  return false
}

async function sample(url: string): Promise<Stage> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.decoding = 'async'
  image.src = url
  await settle(image)
  if (!image.naturalWidth || !image.naturalHeight) return FALLBACK

  const pixels = readPixels(image)
  if (!pixels) return FALLBACK

  const { data, width, height } = pixels
  const ring: Pixel[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = x < RING || x >= width - RING || y < RING || y >= height - RING
      if (!edge) continue
      const i = (y * width + x) * 4
      if (data[i + 3] < 128) continue
      ring.push({ r: data[i], g: data[i + 1], b: data[i + 2], x: x / width, y: y / height })
    }
  }

  if (cornerSweep(image)) return { background: '#ffffff', dark: badgeDark(ring) }
  return stageFromPixels(ring)
}

/** The stage we already know for this photo, if any. */
export function cachedStage(url: string | null | undefined): Stage | undefined {
  return url ? cache.get(url) : undefined
}

/** Resolves the backdrop for a photo. Repeated calls share one sample per URL. */
export function loadStage(url: string | null | undefined): Promise<Stage> {
  if (!url) return Promise.resolve(FALLBACK)
  const hit = cache.get(url)
  if (hit) return Promise.resolve(hit)
  const running = inflight.get(url)
  if (running) return running
  const task = sample(url)
    .then((stage) => {
      cache.set(url, stage)
      return stage
    })
    .finally(() => {
      inflight.delete(url)
    })
  inflight.set(url, task)
  return task
}

/** The backdrop for a photo, starting from the cached value when we have one. */
export function useStage(url: string | null | undefined): Stage {
  const [stage, setStage] = useState<Stage>(() => cachedStage(url) ?? FALLBACK)

  useEffect(() => {
    let alive = true
    setStage(cachedStage(url) ?? FALLBACK)
    void loadStage(url).then((next) => {
      if (alive) setStage(next)
    })
    return () => {
      alive = false
    }
  }, [url])

  return stage
}
