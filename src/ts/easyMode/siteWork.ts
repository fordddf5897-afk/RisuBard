// 방주: 챗봇 사이트 기반 작품(K1·K2).
// 사이트(에덴챗 구성 + 루나톡의 규칙 칸·그림 번호·로어북 항목)와 같은 칸에 적은 내용을
// RisuAI가 읽는 봇의 칸으로 옮긴다. 적은 원문은 그대로 봇 안(`extentions.bangju`)에 같이 둔다:
// 같은 화면으로 다시 열어 고칠 수 있고, 옮기는 규칙이 바뀌면 다시 옮길 수 있다.
//
// 이 파일은 앱의 다른 부분을 불러오지 않는다(계산만 한다). 봇에 실제로 적는 일은 siteWorkApply.ts가 한다.
// 값이 없는 봇은 RisuAI 기반이고, 방주는 그런 봇에 아무것도 쓰지 않는다.

export const BANGJU_KEY = 'bangju'
export const SITE_WORK_VERSION = 1

/** 설명 칸 하나로 합칠 때 붙이는 구분용 제목. 모델에 들어가는 글이므로 여기 두 가지뿐이다. */
export const WORLD_HEADING = '[세계관]'
export const characterHeading = (name: string) => `[등장인물: ${name}]`

export interface SiteCharacter {
    id: string
    name: string
    detail: string
    /** Asset path of the character's picture, '' when none. */
    image: string
    imageExt: string
}

export interface SiteAsset {
    id: string
    /** How the text calls the picture (에덴챗: 이미지 코드). Starts as its number. */
    code: string
    path: string
    ext: string
    description: string
    fileName: string
}

export interface SiteStart {
    id: string
    title: string
    description: string
    /** The opening message. */
    body: string
    /** 보조 프롬프트: sent only in chats begun from this start. */
    extra: string
}

export interface SiteLore {
    id: string
    name: string
    content: string
    /** 항상 (에덴챗) · 글로벌 항목 (루나톡). */
    always: boolean
    /** 켜는 키워드 · 키워드. */
    onKeys: string[]
    /** 끄는 키워드 · 금지 키워드. */
    offKeys: string[]
    /** 최근 N턴 안에서 찾기 · 검색 깊이. null = the app's own setting. */
    turns: number | null
    /** 순서 (루나톡: 낮을수록 우선). null = no preference. */
    order: number | null
    /** 최소 턴 (루나톡). */
    minTurn: number | null
    /** 최대 턴 (루나톡). RisuAI has nothing for it; kept here and reported. */
    maxTurn: number | null
}

export interface SiteWork {
    version: number
    title: string
    subtitle: string
    intro: string
    comment: string
    genre: string
    tags: string[]
    /** Asset path of the cover, '' when none. */
    cover: string
    /** 상세 설정 (에덴챗) · 배경 세계관 (루나톡). */
    world: string
    characters: SiteCharacter[]
    assets: SiteAsset[]
    /** Index 0 is the 대표 시작상황. */
    starts: SiteStart[]
    lore: SiteLore[]
    /** 매 응답에 적용할 규칙 (루나톡). */
    rule: string
}

/** A lorebook entry as RisuAI stores it (the fields this file fills). */
export interface ConvertedLore {
    key: string
    secondkey: string
    insertorder: number
    comment: string
    content: string
    mode: 'normal'
    alwaysActive: boolean
    selective: boolean
    /** Marks entries this conversion made, so saving again replaces only those. */
    extentions: { bangju: true }
}

export interface ConvertedWork {
    name: string
    desc: string
    firstMessage: string
    alternateGreetings: string[]
    creatorNotes: string
    /**
     * 매 응답 규칙. Stored as the bot's depth prompt at depth 0: RisuAI then sends it at the very end of
     * every request in every chat, whatever preset is in use. (RisuAI's "post history instructions" field
     * is copied into one chat's note only, so a new chat would not get the rule.)
     */
    rule: string
    tags: string[]
    image: string
    /** [name, path, ext], as in character.additionalAssets. */
    assets: [string, string, string][]
    lore: ConvertedLore[]
    subtitle: string
    startTitles: string[]
    startDescriptions: string[]
    /** What could not be carried over, in plain words. */
    notes: string[]
}

let counter = 0
export function newId(): string {
    counter += 1
    return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function emptySiteWork(): SiteWork {
    return {
        version: SITE_WORK_VERSION,
        title: '', subtitle: '', intro: '', comment: '', genre: '', tags: [], cover: '',
        world: '',
        characters: [{ id: newId(), name: '', detail: '', image: '', imageExt: '' }],
        assets: [],
        starts: [{ id: newId(), title: '', description: '', body: '', extra: '' }],
        lore: [],
        rule: '',
    }
}

export const emptyLore = (): SiteLore => ({ id: newId(), name: '', content: '', always: false, onKeys: [], offKeys: [], turns: null, order: null, minTurn: null, maxTurn: null })

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null)
const words = (value: unknown): string[] => list(value).map(text).map((item) => item.trim()).filter(Boolean)

/** Splits what was typed in a keyword box (commas or line breaks). */
export function splitKeys(input: string): string[] {
    const seen = new Set<string>()
    for (const part of input.split(/[,\n]/)) {
        const key = part.trim()
        if (key) seen.add(key)
    }
    return [...seen]
}

/** Reads stored site data leniently: a missing or odd field becomes empty, never an error. */
export function sanitizeSiteWork(raw: unknown): SiteWork {
    const value = record(raw)
    const work = emptySiteWork()
    return {
        version: SITE_WORK_VERSION,
        title: text(value.title), subtitle: text(value.subtitle), intro: text(value.intro), comment: text(value.comment),
        genre: text(value.genre), tags: words(value.tags), cover: text(value.cover), world: text(value.world), rule: text(value.rule),
        characters: list(value.characters).map(record).map((item) => ({ id: text(item.id) || newId(), name: text(item.name), detail: text(item.detail), image: text(item.image), imageExt: text(item.imageExt) })),
        assets: list(value.assets).map(record).filter((item) => text(item.path)).map((item) => ({ id: text(item.id) || newId(), code: text(item.code), path: text(item.path), ext: text(item.ext), description: text(item.description), fileName: text(item.fileName) })),
        starts: (() => {
            const starts = list(value.starts).map(record).map((item) => ({ id: text(item.id) || newId(), title: text(item.title), description: text(item.description), body: text(item.body), extra: text(item.extra) }))
            return starts.length ? starts : work.starts
        })(),
        lore: list(value.lore).map(record).map((item) => ({
            id: text(item.id) || newId(), name: text(item.name), content: text(item.content), always: item.always === true,
            onKeys: words(item.onKeys), offKeys: words(item.offKeys), turns: count(item.turns), order: count(item.order), minTurn: count(item.minTurn), maxTurn: count(item.maxTurn),
        })),
    }
}

/** The site data kept in a bot, or null when the bot is RisuAI-based. */
export function readSiteWork(character: { extentions?: Record<string, unknown> } | null | undefined): SiteWork | null {
    const stored = record(character?.extentions?.[BANGJU_KEY])
    if (stored.base !== 'site') return null
    return sanitizeSiteWork(stored.site)
}

export const isSiteBased = (character: { extentions?: Record<string, unknown> } | null | undefined): boolean =>
    record(character?.extentions?.[BANGJU_KEY]).base === 'site'

/** What goes into `extentions[BANGJU_KEY]`. */
export const siteWorkEntry = (work: SiteWork) => ({ base: 'site' as const, site: work })

/** The pictures a site work brings, as bot assets: the numbered ones first, then one per character. */
export function siteAssets(work: SiteWork): [string, string, string][] {
    const assets: [string, string, string][] = []
    const names = new Set<string>()
    const add = (name: string, path: string, ext: string) => {
        if (!path || !name || names.has(name)) return
        names.add(name)
        assets.push([name, path, ext])
    }
    work.assets.forEach((asset, at) => add(asset.code.trim() || String(at + 1), asset.path, asset.ext))
    for (const character of work.characters) add(character.name.trim(), character.image, character.imageExt)
    return assets
}

/**
 * The bot's picture list after saving the form: pictures the form had put there before are replaced by the
 * form's present ones; pictures added anywhere else (the classic editor, an import) stay, and keep their names.
 */
export function mergeSiteAssets(existing: readonly [string, string, string][] | undefined, before: SiteWork | null, converted: readonly [string, string, string][]): [string, string, string][] {
    const managed = new Set((before ? siteAssets(before) : []).map(([, path]) => path))
    const kept = (existing ?? []).filter((asset) => !managed.has(asset[1]))
    const names = new Set(kept.map((asset) => asset[0]))
    return [...kept, ...converted.filter(([name]) => !names.has(name))]
}

/** The bot's lorebook after saving the form: entries the form made are replaced, every other entry stays. */
export function mergeSiteLore<T extends { extentions?: Record<string, unknown> }>(existing: readonly T[] | undefined, converted: readonly ConvertedLore[]): (T | ConvertedLore)[] {
    return [...(existing ?? []).filter((entry) => entry.extentions?.[BANGJU_KEY] !== true), ...converted]
}

/**
 * RisuAI keeps the entries with a higher number when the lorebook budget runs out.
 * 루나톡 counts the other way (낮을수록 우선), so its order is turned around.
 */
export const DEFAULT_LORE_ORDER = 100
export const loreOrder = (order: number | null): number => (order === null ? DEFAULT_LORE_ORDER : Math.max(0, 1000 - order))

/** Moves the site fields into the fields RisuAI reads. Adds no sentence of its own except the two headings. */
export function convertSiteWork(work: SiteWork): ConvertedWork {
    const notes: string[] = []
    const sections: string[] = []
    if (work.world.trim()) sections.push(`${WORLD_HEADING}\n${work.world.trim()}`)
    for (const character of work.characters) {
        const name = character.name.trim()
        const detail = character.detail.trim()
        if (!name && !detail) continue
        sections.push(`${characterHeading(name || '이름 없음')}${detail ? `\n${detail}` : ''}`)
    }

    const starts = work.starts.filter((start) => start.body.trim() || start.title.trim() || start.extra.trim())
    const lore: ConvertedLore[] = []
    for (const entry of work.lore) {
        const name = entry.name.trim()
        if (!name && !entry.content.trim()) continue
        const decorators: string[] = []
        if (!entry.always) {
            if (!entry.onKeys.length) notes.push(`로어북 "${name || '이름 없음'}": 켜는 키워드가 없어서 켜지지 않습니다. 키워드를 넣거나 "항상"으로 바꿔 주세요.`)
            if (entry.offKeys.length) decorators.push(`@@exclude_keys ${entry.offKeys.join(',')}`)
            if (entry.turns !== null && entry.turns > 0) decorators.push(`@@scan_depth ${entry.turns}`)
        }
        if (entry.minTurn !== null && entry.minTurn > 0) decorators.push(`@@activate_only_after ${entry.minTurn}`)
        if (entry.maxTurn !== null && entry.maxTurn > 0) notes.push(`로어북 "${name || '이름 없음'}": 최대 턴(${entry.maxTurn})은 RisuAI에 맞는 기능이 없어 옮기지 못했습니다. 적어 둔 값은 남아 있습니다.`)
        lore.push({
            key: entry.always ? '' : entry.onKeys.join(','),
            secondkey: '',
            insertorder: loreOrder(entry.order),
            comment: name,
            content: [...decorators, entry.content.trim()].join('\n'),
            mode: 'normal',
            alwaysActive: entry.always,
            selective: false,
            extentions: { bangju: true },
        })
    }
    // 보조 프롬프트: only in chats begun from that start. RisuAI has a lorebook mark for exactly that.
    starts.forEach((start, at) => {
        if (!start.extra.trim()) return
        lore.push({
            key: '', secondkey: '', insertorder: DEFAULT_LORE_ORDER,
            comment: `보조 프롬프트 · ${start.title.trim() || `시작 상황 ${at + 1}`}`,
            content: `@@is_greeting ${at}\n${start.extra.trim()}`,
            mode: 'normal', alwaysActive: true, selective: false, extentions: { bangju: true },
        })
    })

    const tags: string[] = []
    for (const tag of [work.genre, ...work.tags]) {
        const clean = tag.trim().replace(/^#/, '')
        if (clean && !tags.includes(clean)) tags.push(clean)
    }
    const assets = siteAssets(work)
    const codes = work.assets.map((asset, at) => asset.code.trim() || String(at + 1))
    const repeated = codes.filter((code, at) => codes.indexOf(code) !== at)
    if (repeated.length) notes.push(`그림 코드가 겹칩니다: ${[...new Set(repeated)].join(', ')}. 겹친 그림은 먼저 올린 것만 불립니다.`)

    return {
        name: work.title.trim() || '이름 없는 작품',
        desc: sections.join('\n\n'),
        firstMessage: starts[0]?.body ?? '',
        alternateGreetings: starts.slice(1).map((start) => start.body),
        creatorNotes: [work.intro.trim(), work.comment.trim()].filter(Boolean).join('\n\n'),
        rule: work.rule.trim(),
        tags,
        image: work.cover || work.characters.find((character) => character.image)?.image || '',
        assets,
        lore,
        subtitle: work.subtitle.trim(),
        startTitles: starts.map((start) => start.title.trim()),
        startDescriptions: starts.map((start) => start.description.trim()),
        notes,
    }
}
