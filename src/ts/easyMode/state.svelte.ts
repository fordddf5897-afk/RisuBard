// Easy-mode switches and screen state. Preferences are per device (local storage),
// so nothing is added to the RisuAI database and backups stay upstream-compatible.
import { writable } from 'svelte/store'
import { additionalHamburgerMenu, additionalSettingsMenu, settingsOpen, type MenuDef } from '../stores.svelte'

const PREFS_KEY = 'risu-easy-mode:prefs:v1'

export interface EasyPrefs {
    /** Show the easy shell instead of the classic RisuAI layout. */
    enabled: boolean
    /** Illustrate new AI replies with BardPainter + NovelAI. */
    autoIllustrate: boolean
    /** Illustrate every Nth AI reply (1 = every reply). */
    illustrateEvery: number
    /** Home grid sort. */
    homeSort: 'recent' | 'new' | 'name'
}

export const defaultEasyPrefs: EasyPrefs = {
    enabled: true,
    autoIllustrate: false,
    illustrateEvery: 3,
    homeSort: 'recent',
}

export function parseEasyPrefs(raw: string | null | undefined): EasyPrefs {
    if (!raw) return { ...defaultEasyPrefs }
    try {
        const value = JSON.parse(raw) as Partial<EasyPrefs>
        const every = Number(value.illustrateEvery)
        return {
            enabled: typeof value.enabled === 'boolean' ? value.enabled : defaultEasyPrefs.enabled,
            autoIllustrate: value.autoIllustrate === true,
            illustrateEvery: Number.isInteger(every) && every >= 1 && every <= 50 ? every : defaultEasyPrefs.illustrateEvery,
            homeSort: value.homeSort === 'new' || value.homeSort === 'name' ? value.homeSort : 'recent',
        }
    } catch {
        return { ...defaultEasyPrefs }
    }
}

function readPrefs(): EasyPrefs {
    try {
        return parseEasyPrefs(localStorage.getItem(PREFS_KEY))
    } catch {
        return { ...defaultEasyPrefs }
    }
}

/** `?classic` opens the classic layout once; `?easy` forces easy mode. */
export function urlModeOverride(search: string): boolean | null {
    try {
        const params = new URLSearchParams(search)
        if (params.has('classic')) return false
        if (params.has('easy')) return true
    } catch {
        // Ignore malformed URLs.
    }
    return null
}

export const easyPrefs = $state<EasyPrefs>(readPrefs())

export function saveEasyPrefs(): void {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(easyPrefs))
    } catch {
        // Storage may be unavailable (private mode); the setting then lasts for this visit.
    }
}

const override = typeof location !== 'undefined' ? urlModeOverride(location.search) : null

/** Whether App.svelte renders the easy shell. */
export const easyModeEnabled = writable<boolean>(override ?? easyPrefs.enabled)

export function setEasyModeEnabled(enabled: boolean): void {
    easyPrefs.enabled = enabled
    saveEasyPrefs()
    easyModeEnabled.set(enabled)
}

export type EasyPage = 'home' | 'detail' | 'chat'

export const easyView = $state({
    page: 'home' as EasyPage,
    /** chaId of the work shown on the detail or chat page. */
    chaId: '' as string,
})

// The classic layout gets a way back through the same extension points plugins
// use (sidebar hamburger and settings navigation), so no classic component changes.
const ENTRY_ID = 'risu-easy-mode-entry'
const ENTRY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20v-8"/><path d="M12 12c0-4 3-7 8-7 0 5-3 8-8 7Z"/><path d="M12 14c0-3-2.5-5.5-7-5.5 0 4 2.5 6 7 5.5Z"/></svg>'

export function registerClassicEntry(): void {
    const entry = (layoutKey: string): MenuDef => ({
        name: '간편 모드로 전환',
        icon: ENTRY_ICON,
        iconType: 'html',
        id: `${ENTRY_ID}-${layoutKey}`,
        pluginName: 'easy-mode',
        layoutKey,
        callback: () => {
            settingsOpen.set(false)
            setEasyModeEnabled(true)
        },
    })
    if (!additionalHamburgerMenu.some((item) => item.id === `${ENTRY_ID}-sidebar`)) additionalHamburgerMenu.push(entry('sidebar'))
    if (!additionalSettingsMenu.some((item) => item.id === `${ENTRY_ID}-settings`)) additionalSettingsMenu.push(entry('settings'))
}

if (typeof window !== 'undefined') registerClassicEntry()
