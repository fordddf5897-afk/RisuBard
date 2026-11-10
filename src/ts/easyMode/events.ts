// Window events easy mode sends to the classic chat screen. The chat screen owns
// save slots and the Memory Wiki dialog; these events open them without moving that
// logic. Each listener is a small marked block in the core component.

export const EASY_OPEN_SAVE_SLOTS = 'risu-easy:open-save-slots'
export const EASY_QUICK_SAVE = 'risu-easy:quick-save'
export const EASY_OPEN_MEMORY_WIKI = 'risu-easy:open-memory-wiki'

export type EasySaveSlotMode = 'save' | 'load'

export function requestSaveSlots(mode: EasySaveSlotMode): void {
    window.dispatchEvent(new CustomEvent(EASY_OPEN_SAVE_SLOTS, { detail: { mode } }))
}

export function requestQuickSave(): void {
    window.dispatchEvent(new CustomEvent(EASY_QUICK_SAVE))
}

export function requestMemoryWiki(): void {
    window.dispatchEvent(new CustomEvent(EASY_OPEN_MEMORY_WIKI))
}

export function saveSlotModeFrom(event: Event): EasySaveSlotMode {
    const mode = (event as CustomEvent<{ mode?: string }>).detail?.mode
    return mode === 'save' ? 'save' : 'load'
}
