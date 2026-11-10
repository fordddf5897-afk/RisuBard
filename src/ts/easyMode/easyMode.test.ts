import { describe, expect, test } from 'vitest'
import { parseEasyPrefs, urlModeOverride, defaultEasyPrefs } from './state.svelte'
import { shouldIllustrate, wholeMessageAnchor } from './autoIllustrate'
import { saveSlotModeFrom } from './events'
import { validateAppSkin } from '../gui/appSkin'
import gardenSkin from './gardenSkin.json'

describe('easy-mode preferences', () => {
    test('falls back to defaults for missing or broken values', () => {
        expect(parseEasyPrefs(null)).toEqual(defaultEasyPrefs)
        expect(parseEasyPrefs('{not json')).toEqual(defaultEasyPrefs)
        expect(parseEasyPrefs(JSON.stringify({ enabled: false, autoIllustrate: true, illustrateEvery: 0, homeSort: 'odd' })))
            .toEqual({ ...defaultEasyPrefs, enabled: false, autoIllustrate: true })
        expect(parseEasyPrefs(JSON.stringify({ illustrateEvery: 5, homeSort: 'name' })))
            .toEqual({ ...defaultEasyPrefs, illustrateEvery: 5, homeSort: 'name' })
    })

    test('URL switches override the saved mode', () => {
        expect(urlModeOverride('?classic')).toBe(false)
        expect(urlModeOverride('?easy=1')).toBe(true)
        expect(urlModeOverride('?other=1')).toBeNull()
    })
})

describe('auto illustration', () => {
    const reply = (id: string, data = '본문') => ({ role: 'char', chatId: id, data })
    const user = { role: 'user', chatId: 'u', data: '...' }

    test('fires on every Nth AI reply only', () => {
        const base = { enabled: true, alreadyDone: new Set<string>() }
        expect(shouldIllustrate({ ...base, every: 2, messages: [reply('a'), user, reply('b')] })).toBe(true)
        expect(shouldIllustrate({ ...base, every: 2, messages: [reply('a'), user, reply('b'), user, reply('c')] })).toBe(false)
        expect(shouldIllustrate({ ...base, every: 1, messages: [reply('a')] })).toBe(true)
    })

    test('skips when off, after a user turn, twice for one reply, or when an image is already there', () => {
        expect(shouldIllustrate({ enabled: false, every: 1, messages: [reply('a')], alreadyDone: new Set() })).toBe(false)
        expect(shouldIllustrate({ enabled: true, every: 1, messages: [reply('a'), user], alreadyDone: new Set() })).toBe(false)
        expect(shouldIllustrate({ enabled: true, every: 1, messages: [reply('a')], alreadyDone: new Set(['a']) })).toBe(false)
        expect(shouldIllustrate({ enabled: true, every: 1, messages: [reply('a', '글\n\n{{inlay::x}}')], alreadyDone: new Set() })).toBe(false)
        expect(shouldIllustrate({ enabled: true, every: 1, messages: [reply('a', '   ')], alreadyDone: new Set() })).toBe(false)
    })

    test('anchors the whole message so the picture goes after the reply', () => {
        const source = '<p>{{char}}가 웃었다.</p>'
        const anchor = wholeMessageAnchor({ characterId: 'c', chatId: 'h', messageId: 'm' }, source, { user: '나', char: '루카' })
        expect(anchor).toEqual({ characterId: 'c', chatId: 'h', messageId: 'm', start: 0, end: source.length, text: '루카가 웃었다.' })
    })
})

test('save-slot events default to load', () => {
    expect(saveSlotModeFrom(new CustomEvent('x', { detail: { mode: 'save' } }))).toBe('save')
    expect(saveSlotModeFrom(new CustomEvent('x'))).toBe('load')
})

test('the bundled garden skin passes the app skin validator', () => {
    const result = validateAppSkin(gardenSkin)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
})
