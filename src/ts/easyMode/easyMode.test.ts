import { describe, expect, test } from 'vitest'
import { parseEasyPrefs, urlModeOverride, defaultEasyPrefs, registerArchiveEntry, ARCHIVE_PATH } from './state.svelte'
import { additionalHamburgerMenu, additionalSettingsMenu } from '../stores.svelte'
import { LIST_PAGE, nextLimit } from './visible'
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

describe('archive entry on the classic screen', () => {
    test('is added once to the sidebar menu and the settings navigation, only where the archive page exists', () => {
        const count = () => [additionalHamburgerMenu, additionalSettingsMenu].map((menu) => menu.filter((item) => item.name === '보관함 관리' || item.name === '업데이트 확인').length)
        const before = count()
        registerArchiveEntry(false)
        expect(count()).toEqual(before)
        registerArchiveEntry(true)
        registerArchiveEntry(true)
        expect(count()).toEqual([2, 2])
        expect(additionalSettingsMenu.map((item) => item.name).filter((name) => name !== '간편 모드로 전환')).toEqual(['보관함 관리', '업데이트 확인'])
        expect(ARCHIVE_PATH).toBe('/bangju/archive')
        const entry = additionalHamburgerMenu.find((item) => item.name === '보관함 관리')
        expect(entry?.pluginName).toBe('easy-mode')
        expect(entry?.layoutKey).toBe('sidebar')
    })
})

describe('drawing a long list a page at a time', () => {
    test('adds one page and never goes past the end', () => {
        expect(nextLimit(LIST_PAGE, 1000)).toBe(LIST_PAGE * 2)
        expect(nextLimit(LIST_PAGE, LIST_PAGE + 5)).toBe(LIST_PAGE + 5)
        expect(nextLimit(0, 10, 4)).toBe(4)
        expect(nextLimit(8, 10, 4)).toBe(10)
        expect(nextLimit(10, 0)).toBe(0)
    })
})
