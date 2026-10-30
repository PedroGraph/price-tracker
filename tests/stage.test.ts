import { describe, expect, it } from 'vitest'
import { stageFromPixels, type Pixel } from '../src/renderer/src/stage'

/** A square image described by a color function, sampled on a 12×12 grid. */
function image(color: (x: number, y: number) => [number, number, number]): Pixel[] {
  const pixels: Pixel[] = []
  const size = 12
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = color(x, y)
      pixels.push({ r, g, b, x: x / size, y: y / size })
    }
  }
  return pixels
}

const WHITE: [number, number, number] = [255, 255, 255]
const RED: [number, number, number] = [192, 57, 43]
const BLUE: [number, number, number] = [47, 90, 143]
const SAND: [number, number, number] = [232, 211, 174]
const CORAL: [number, number, number] = [201, 106, 82]

describe('stageFromPixels', () => {
  it('keeps a white sweep flat', () => {
    const stage = stageFromPixels(image(() => WHITE))
    expect(stage.background).toBe('#ffffff')
    expect(stage.dark).toBe(false)
  })

  it('stays white when the product touches the frame but the sweep is white', () => {
    // 40% of the image is a dark product along the top edge; the background is still white.
    const stage = stageFromPixels(image((_x, y) => (y < 4 ? [20, 20, 22] : WHITE)))
    expect(stage.background).toBe('#ffffff')
    // The badges sit over the dark product, so they need the light treatment.
    expect(stage.dark).toBe(true)
  })

  it('stays white when the product fills the frame and only a corner shows the sweep', () => {
    // A laptop shot: the product eats the whole frame, but the top-left corner is still white.
    const stage = stageFromPixels(image((x, y) => (x < 2 && y < 2 ? WHITE : [60, 60, 64])))
    expect(stage.background).toBe('#ffffff')
  })

  it('keeps a black studio flat and reports a dark tone', () => {
    const stage = stageFromPixels(image(() => [5, 5, 5]))
    expect(stage.background).toBe('#050505')
    expect(stage.dark).toBe(true)
  })

  it('builds a horizontal gradient for two colors side by side', () => {
    const stage = stageFromPixels(image((x) => (x < 6 ? RED : BLUE)))
    expect(stage.background).toMatch(/^linear-gradient\(100deg,/)
    expect(stage.background).toContain('#c0392b')
    expect(stage.background).toContain('#2f5a8f')
  })

  it('builds a vertical gradient for two colors stacked', () => {
    const stage = stageFromPixels(image((_x, y) => (y < 6 ? SAND : CORAL)))
    expect(stage.background).toMatch(/^linear-gradient\(180deg,/)
    expect(stage.background).toContain('#e8d3ae')
    expect(stage.background).toContain('#c96a52')
  })

  it('uses three stops for three tones', () => {
    const stage = stageFromPixels(image((x) => (x < 4 ? RED : x < 8 ? WHITE : BLUE)))
    expect(stage.background).toMatch(/^linear-gradient\(100deg,/)
    expect(stage.background.match(/#[0-9a-f]{6}/g)).toHaveLength(3)
  })

  it('falls back to white without samples', () => {
    expect(stageFromPixels([])).toEqual({ background: '#ffffff', dark: false })
  })
})
