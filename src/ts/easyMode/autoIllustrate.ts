// Automatic illustrations: after an AI reply finishes, ask BardPainter to plan the
// scene (sub model), generate it with NovelAI and insert the picture under the reply.
// It reuses BardPainter's own session, so style, outfits and gallery work as usual.
import { v4 } from 'uuid'
import { DBState } from '../stores.svelte'
import { getPainterSession, isPainterChatBusy } from '../bardPainter/runtime.svelte'
import type { PainterAnchor } from '../bardPainter/types'
import { toChatPreviewText } from '../risubard/chatPreviewText'
import { resolvePersonaById } from '../personaScopes'

export interface IllustrateOutcome {
    ok: boolean
    /** Set when ok is false. */
    reason?: 'skipped' | 'no-key' | 'busy' | 'failed'
    message?: string
    /** Inlay asset of the inserted picture, when ok. */
    assetId?: string
}

/**
 * Decides whether a finished reply should be illustrated: counts AI replies in the
 * chat and fires on every Nth one, never twice for the same message.
 */
export function shouldIllustrate(input: {
    enabled: boolean
    every: number
    messages: readonly { role: string; chatId?: string; data?: string }[]
    alreadyDone: ReadonlySet<string>
}): boolean {
    if (!input.enabled) return false
    const last = input.messages.at(-1)
    if (!last || last.role !== 'char' || !last.data?.trim()) return false
    if (last.chatId && input.alreadyDone.has(last.chatId)) return false
    // Already contains an inlay (made by hand or by an earlier run).
    if (/\{\{inlay(?:ed|eddata)?::/i.test(last.data)) return false
    const every = Math.max(1, Math.floor(input.every) || 1)
    const replies = input.messages.filter((message) => message.role === 'char').length
    return replies % every === 0
}

/** Anchor covering a whole message, so the picture goes after the reply. */
export function wholeMessageAnchor(
    ids: { characterId: string; chatId: string; messageId: string },
    source: string,
    names: { user: string; char: string },
): PainterAnchor {
    return { ...ids, start: 0, end: source.length, text: toChatPreviewText(source, names) }
}

export async function illustrateLatestReply(characterId: string, chatId: string): Promise<IllustrateOutcome> {
    if (!DBState.db.NAIApiKey?.trim()) {
        return { ok: false, reason: 'no-key', message: '자동 삽화를 쓰려면 설정 > 이미지 생성에서 NovelAI API 키를 넣어 주세요.' }
    }
    if (isPainterChatBusy(characterId, chatId)) {
        return { ok: false, reason: 'busy', message: '바드 페인터가 이미 작업 중입니다.' }
    }
    const character = DBState.db.characters.find((item) => item?.chaId === characterId)
    const chat = character?.chats.find((item) => item.id === chatId)
    const message = chat?.message?.at(-1)
    if (!character || !chat || chat._placeholder || !message || message.role !== 'char' || chat.isStreaming) {
        return { ok: false, reason: 'skipped', message: '삽화를 넣을 답변이 없습니다.' }
    }
    message.chatId ||= v4()
    const user = resolvePersonaById(DBState.db, character, chat.bindedPersona)?.persona.name ?? DBState.db.username ?? 'User'
    const anchor = wholeMessageAnchor(
        { characterId, chatId, messageId: message.chatId },
        message.data,
        { user, char: character.nickname || character.name },
    )
    const session = getPainterSession(characterId, chatId)
    const prepared = await session.prepare(anchor, { fresh: true })
    if (!prepared) return { ok: false, reason: 'failed', message: session.state.error || '장면 프롬프트를 만들지 못했습니다.' }
    await session.generate()
    if (session.state.error) return { ok: false, reason: 'failed', message: session.state.error }
    const result = session.data.results.find((item) => item.anchor.messageId === anchor.messageId && !item.inserted && !item.compressionPending)
    if (!result) return { ok: false, reason: 'failed', message: '생성한 그림을 찾지 못했습니다.' }
    const inserted = await session.insert(result.id, 'after')
    if (!inserted) return { ok: false, reason: 'failed', message: session.state.error || '그림을 답변에 넣지 못했습니다.' }
    return { ok: true, assetId: result.assetId }
}
