import { describe, expect, it } from 'vitest'
import { parseCommand, pauseHours } from '../src/shared/botCommands'

describe('parseCommand', () => {
  it('reads Spanish and English commands, with or without the bot name', () => {
    expect(parseCommand('/precios')).toEqual({ command: 'prices', arg: '' })
    expect(parseCommand('/prices@my_price_bot')).toEqual({ command: 'prices', arg: '' })
    expect(parseCommand('/agregar https://amzn.to/abc')).toEqual({ command: 'add', arg: 'https://amzn.to/abc' })
    expect(parseCommand('/PAUSAR 3')).toEqual({ command: 'pause', arg: '3' })
    expect(parseCommand('/start')).toEqual({ command: 'help', arg: '' })
  })

  it('flags unknown commands and ignores plain text', () => {
    expect(parseCommand('/borrar_todo')).toEqual({ command: 'unknown', arg: '' })
    expect(parseCommand('hola')).toBeNull()
    expect(parseCommand(undefined)).toBeNull()
  })
})

describe('pauseHours', () => {
  it('defaults to 8 and stays within a week', () => {
    expect(pauseHours('')).toBe(8)
    expect(pauseHours('abc')).toBe(8)
    expect(pauseHours('2')).toBe(2)
    expect(pauseHours('1,5')).toBe(2)
    expect(pauseHours('500')).toBe(168)
    expect(pauseHours('-3')).toBe(8)
  })
})
