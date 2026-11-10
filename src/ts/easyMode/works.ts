// Read-only views of RisuAI characters for the easy-mode home and work pages.
// Nothing here changes the character data model: optional easy-mode metadata
// lives in `character.extentions[EASY_META_KEY]`, which card export/import
// already carries as `data.extensions`, so cards stay RisuAI-compatible.
import { toChatPreviewText } from '../risubard/chatPreviewText'

export const EASY_META_KEY = 'risuEasy'

/** Optional per-character metadata written by easy mode. Every field may be absent. */
export interface EasyWorkMeta {
    /** One-line subtitle shown under the work title. */
    subtitle?: string
    /** Start-situation titles. Index 0 is the first message, index n is alternateGreetings[n - 1]. */
    startTitles?: string[]
    /** Start-situation descriptions, indexed like startTitles. */
    startDescriptions?: string[]
}

/** The character fields easy mode reads. Kept structural so tests need no full character. */
export interface EasyCharacterLike {
    type?: string
    chaId: string
    name: string
    image?: string
    tags?: string[]
    creator?: string
    creatorNotes?: string
    firstMessage?: string
    alternateGreetings?: string[]
    firstMsgIndex?: number
    lastInteraction?: number
    creation_date?: number
    trashTime?: number
    nickname?: string
    chats?: Array<{ id?: string; name?: string; lastDate?: number; message?: unknown[]; fmIndex?: number; _placeholder?: boolean }>
    extentions?: Record<string, unknown>
}

export interface EasyWork {
    /** Index in DBState.db.characters at the time the list was built. */
    index: number
    chaId: string
    name: string
    subtitle: string
    tags: string[]
    image: string
    creator: string
    lastInteraction: number
    createdAt: number
    chatCount: number
}

export type EasyWorkSort = 'recent' | 'new' | 'name'

export interface StartSituation {
    /** Value for Chat.fmIndex: -1 is the first message, n is alternateGreetings[n]. */
    fmIndex: number
    title: string
    description: string
    isDefault: boolean
    hasCustomTitle: boolean
}

export function readEasyMeta(character: Pick<EasyCharacterLike, 'extentions'>): EasyWorkMeta {
    const raw = character.extentions?.[EASY_META_KEY]
    if (!raw || typeof raw !== 'object') return {}
    const value = raw as Record<string, unknown>
    const strings = (input: unknown) => Array.isArray(input) ? input.map((item) => typeof item === 'string' ? item : '') : undefined
    return {
        subtitle: typeof value.subtitle === 'string' ? value.subtitle : undefined,
        startTitles: strings(value.startTitles),
        startDescriptions: strings(value.startDescriptions),
    }
}

/** Returns a new extentions object with the patch merged into the easy-mode entry. */
export function withEasyMeta(
    extentions: Record<string, unknown> | undefined,
    patch: Partial<EasyWorkMeta>,
): Record<string, unknown> {
    const current = readEasyMeta({ extentions })
    const next: EasyWorkMeta = { ...current, ...patch }
    for (const key of Object.keys(next) as (keyof EasyWorkMeta)[]) {
        if (next[key] === undefined) delete next[key]
    }
    return { ...(extentions ?? {}), [EASY_META_KEY]: next }
}

/** First meaningful line of the creator notes, used when no subtitle was set. */
export function firstLine(text: string | undefined, maxLength = 48): string {
    if (!text) return ''
    const plain = toChatPreviewText(text, { user: '', char: '' })
    const line = plain.split('\n').map((item) => item.trim()).find((item) => item.length > 0) ?? ''
    return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line
}

export function isListedCharacter(character: EasyCharacterLike | null | undefined): character is EasyCharacterLike {
    return !!character && character.type !== 'group' && !character.trashTime
}

export function toEasyWork(character: EasyCharacterLike, index: number): EasyWork {
    const meta = readEasyMeta(character)
    return {
        index,
        chaId: character.chaId,
        name: character.name?.trim() || '이름 없는 작품',
        subtitle: meta.subtitle?.trim() || firstLine(character.creatorNotes),
        tags: (character.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
        image: character.image ?? '',
        creator: character.creator ?? '',
        lastInteraction: character.lastInteraction ?? 0,
        createdAt: character.creation_date ?? 0,
        chatCount: character.chats?.length ?? 0,
    }
}

export function listWorks(characters: readonly (EasyCharacterLike | null | undefined)[]): EasyWork[] {
    const works: EasyWork[] = []
    characters.forEach((character, index) => {
        if (isListedCharacter(character)) works.push(toEasyWork(character, index))
    })
    return works
}

function normalize(text: string): string {
    return text.toLocaleLowerCase().replace(/\s+/g, '')
}

export function matchesQuery(work: EasyWork, query: string): boolean {
    const needle = normalize(query)
    if (!needle) return true
    return [work.name, work.subtitle, work.creator, ...work.tags].some((field) => normalize(field).includes(needle))
}

export function filterWorks(works: readonly EasyWork[], options: { query?: string; tag?: string | null }): EasyWork[] {
    return works.filter((work) => (!options.tag || work.tags.includes(options.tag)) && matchesQuery(work, options.query ?? ''))
}

export function sortWorks(works: readonly EasyWork[], sort: EasyWorkSort): EasyWork[] {
    const byName = (a: EasyWork, b: EasyWork) => a.name.localeCompare(b.name, 'ko')
    const copy = [...works]
    switch (sort) {
        case 'name':
            return copy.sort(byName)
        case 'new':
            return copy.sort((a, b) => (b.createdAt - a.createdAt) || byName(a, b))
        case 'recent':
        default:
            return copy.sort((a, b) => (b.lastInteraction - a.lastInteraction) || byName(a, b))
    }
}

/** Tags by how many works use them, most used first. */
export function popularTags(works: readonly EasyWork[], limit = 20): { tag: string; count: number }[] {
    const counts = new Map<string, number>()
    for (const work of works) {
        for (const tag of new Set(work.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag, 'ko'))
        .slice(0, limit)
}

/**
 * Works opened in a chat before, most recent first. RisuAI stamps lastInteraction
 * when a character's chat is opened; importing a card does not.
 */
export function recentlyPlayed(works: readonly EasyWork[], limit = 10): EasyWork[] {
    return sortWorks(works.filter((work) => work.lastInteraction > 0), 'recent').slice(0, limit)
}

function greetingPreview(text: string, names: { user: string; char: string }, maxLength: number): string {
    const plain = toChatPreviewText(text, names).replace(/\s+/g, ' ').trim()
    return plain.length > maxLength ? `${plain.slice(0, maxLength - 1)}…` : plain
}

/**
 * The first message and alternate greetings as Eden-style start situations.
 * Titles come from easy-mode metadata when set; otherwise they are numbered.
 */
export function listStartSituations(
    character: EasyCharacterLike,
    names: { user: string; char?: string },
    maxDescription = 90,
): StartSituation[] {
    const meta = readEasyMeta(character)
    const charName = names.char ?? (character.nickname || character.name)
    const greetings = [character.firstMessage ?? '', ...(character.alternateGreetings ?? [])]
    const defaultIndex = character.firstMsgIndex ?? -1
    const situations: StartSituation[] = []
    greetings.forEach((text, slot) => {
        const fmIndex = slot - 1
        // An empty first message is still a valid start when there is nothing else.
        if (slot === 0 && !text.trim() && greetings.length > 1) return
        const customTitle = meta.startTitles?.[slot]?.trim()
        const customDescription = meta.startDescriptions?.[slot]?.trim()
        situations.push({
            fmIndex,
            title: customTitle || `시작 상황 ${situations.length + 1}`,
            description: customDescription || greetingPreview(text, { user: names.user, char: charName }, maxDescription) || '빈 첫 메시지로 시작합니다.',
            isDefault: fmIndex === defaultIndex,
            hasCustomTitle: !!customTitle,
        })
    })
    return situations
}

/** Metadata slot (see EasyWorkMeta.startTitles) for a Chat.fmIndex value. */
export function startSlot(fmIndex: number): number {
    return fmIndex + 1
}

/** Sets one start-situation title, returning the new extentions object. */
export function withStartTitle(
    character: Pick<EasyCharacterLike, 'extentions' | 'alternateGreetings'>,
    fmIndex: number,
    title: string,
): Record<string, unknown> {
    const meta = readEasyMeta(character)
    const size = (character.alternateGreetings?.length ?? 0) + 1
    const titles = Array.from({ length: size }, (_, slot) => meta.startTitles?.[slot] ?? '')
    titles[startSlot(fmIndex)] = title.trim()
    return withEasyMeta(character.extentions, { startTitles: titles })
}
