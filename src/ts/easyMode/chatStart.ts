// Starting and resuming chats from the easy-mode work page. These follow the same
// steps as the classic chat list (SideChatList.createNewChat) so chats created here
// are ordinary RisuAI chats.
import { get } from 'svelte/store'
import { v4 } from 'uuid'
import { DBState, ReloadGUIPointer, selectedCharID } from '../stores.svelte'
import { newChatModelDefaults, type Chat, type RisuPersona, type character } from '../storage/database.svelte'
import { changeChar } from '../characters'
import { changeChatTo, requestImmediateSave, trackChatForSave, trackCharacterForSave } from '../globalApi.svelte'
import { createUniqueDisplayName } from '../displayName'
import { getEffectivePersona } from '../personaScopes'
import { doingChat } from '../process/generationState'

export interface PersonaChoice {
    id: string
    name: string
    icon: string
    scope: 'global' | 'character'
    note: string
}

function ensurePersonaId(persona: RisuPersona): string {
    persona.id ||= v4()
    return persona.id
}

/** Character-only personas first (they were made for this work), then global ones. */
export function listPersonaChoices(chara: character | undefined): PersonaChoice[] {
    const choices: PersonaChoice[] = []
    for (const persona of chara?.personas ?? []) {
        choices.push({ id: ensurePersonaId(persona), name: persona.name || '이름 없음', icon: persona.icon ?? '', scope: 'character', note: persona.note ?? '' })
    }
    for (const persona of DBState.db.personas ?? []) {
        choices.push({ id: ensurePersonaId(persona), name: persona.name || '이름 없음', icon: persona.icon ?? '', scope: 'global', note: persona.note ?? '' })
    }
    return choices
}

/** The persona a new chat of this work would use by default. */
export function defaultPersonaId(chara: character | undefined): string {
    const active = chara?.chats?.[chara.chatPage]
    return getEffectivePersona(DBState.db, chara, active)?.persona.id ?? ''
}

export function findCharacterIndex(chaId: string): number {
    return DBState.db.characters.findIndex((item) => item?.chaId === chaId)
}

export class EasyChatBusyError extends Error {
    constructor() { super('다른 응답을 만드는 중입니다. 끝난 뒤 다시 시도해 주세요.') }
}

/**
 * Creates a new chat that opens with the chosen start situation and selects it.
 * Returns the new chat id.
 */
export function startEasyChat(chaId: string, options: { fmIndex: number; personaId?: string; title?: string }): string {
    if (get(doingChat)) throw new EasyChatBusyError()
    const index = findCharacterIndex(chaId)
    if (index < 0) throw new Error('작품을 찾을 수 없습니다.')
    if (get(selectedCharID) !== index) changeChar(index)
    const chara = DBState.db.characters[index] as character
    const activeChat = chara.chats[chara.chatPage]
    const greetings = chara.alternateGreetings?.length ?? 0
    const fmIndex = Number.isInteger(options.fmIndex) && options.fmIndex >= -1 && options.fmIndex < greetings ? options.fmIndex : -1
    const baseName = options.title?.trim() || `New Chat ${chara.chats.length + 1}`
    const newChat: Chat = {
        message: [],
        note: '',
        name: createUniqueDisplayName(baseName, chara.chats),
        localLore: [],
        fmIndex,
        id: v4(),
        ...newChatModelDefaults(chara, activeChat),
    }
    if (options.personaId !== undefined) newChat.bindedPersona = options.personaId
    chara.chats.unshift(newChat)
    chara.chats = chara.chats
    changeChatTo(0)
    trackChatForSave(chara.chaId, newChat.id!)
    void requestImmediateSave()
    ReloadGUIPointer.update((value) => value + 1)
    return newChat.id!
}

/** Selects the work and opens one of its existing chats (latest when chatId is omitted). */
export function openEasyChat(chaId: string, chatId?: string): void {
    if (get(doingChat)) throw new EasyChatBusyError()
    const index = findCharacterIndex(chaId)
    if (index < 0) throw new Error('작품을 찾을 수 없습니다.')
    if (get(selectedCharID) !== index) changeChar(index)
    if (chatId) changeChatTo(chatId)
}

/** Saves an edit made to a work that is not the selected chat character. */
export function saveWorkEdit(chaId: string): void {
    trackCharacterForSave(chaId)
    void requestImmediateSave()
}
