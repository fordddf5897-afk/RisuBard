import { describe, expect, it } from 'vitest'
import {
    BANGJU_KEY, WORLD_HEADING, characterHeading, convertSiteWork, emptyLore, emptySiteWork, isSiteBased, loreOrder,
    mergeSiteAssets, mergeSiteLore, readSiteWork, sanitizeSiteWork, siteAssets, siteWorkEntry, splitKeys, type SiteWork,
} from './siteWork'

function sample(): SiteWork {
    const work = emptySiteWork()
    work.title = '  에덴하임의 사서  '
    work.subtitle = '봉인된 서고'
    work.intro = '도서관 이야기'
    work.comment = '즐겁게 해 주세요'
    work.genre = '판타지/SF'
    work.tags = ['#도서관', '판타지/SF', ' 사서 ']
    work.world = '왕도 지하에 서고가 있다.'
    work.characters = [
        { id: 'c1', name: '하와', detail: '대사서. 조용하다.', image: 'assets/hawa.png', imageExt: 'png' },
        { id: 'c2', name: '', detail: '', image: '', imageExt: '' },
        { id: 'c3', name: '리노', detail: '', image: '', imageExt: '' },
    ]
    work.assets = [
        { id: 'a1', code: '1', path: 'assets/one.png', ext: 'png', description: '웃는 얼굴', fileName: 'smile.png' },
        { id: 'a2', code: 'smi02', path: 'assets/two.webp', ext: 'webp', description: '', fileName: 'x.webp' },
    ]
    work.starts = [
        { id: 's1', title: '첫 만남', description: '서고 앞', body: '<<나레이션>> 문이 열렸다.', extra: '' },
        { id: 's2', title: '', description: '', body: '두 번째 시작', extra: '이 시작에서는 밤이다.' },
    ]
    work.lore = [
        { ...emptyLore(), id: 'l1', name: '서고', content: '봉인된 서고다.', onKeys: ['서고', '봉인'], offKeys: ['꿈'], turns: 5, order: 2, minTurn: 3, maxTurn: 20 },
        { ...emptyLore(), id: 'l2', name: '세계 규칙', content: '마법이 있다.', always: true, onKeys: ['무시됨'], offKeys: ['무시됨'], turns: 5 },
        { ...emptyLore(), id: 'l3', name: '', content: '' },
    ]
    work.rule = '상태창을 매번 출력한다.'
    return work
}

describe('site work conversion', () => {
    it('moves the fields without adding sentences, except the two headings', () => {
        const converted = convertSiteWork(sample())
        expect(converted.name).toBe('에덴하임의 사서')
        expect(converted.desc).toBe(`${WORLD_HEADING}\n왕도 지하에 서고가 있다.\n\n${characterHeading('하와')}\n대사서. 조용하다.\n\n${characterHeading('리노')}`)
        expect(converted.firstMessage).toBe('<<나레이션>> 문이 열렸다.')
        expect(converted.alternateGreetings).toEqual(['두 번째 시작'])
        expect(converted.creatorNotes).toBe('도서관 이야기\n\n즐겁게 해 주세요')
        expect(converted.rule).toBe('상태창을 매번 출력한다.')
        expect(converted.tags).toEqual(['판타지/SF', '도서관', '사서'])
        expect(converted.subtitle).toBe('봉인된 서고')
        expect(converted.startTitles).toEqual(['첫 만남', ''])
        expect(converted.startDescriptions).toEqual(['서고 앞', ''])
    })

    it('leaves the description empty when nothing was written', () => {
        const converted = convertSiteWork(emptySiteWork())
        expect(converted.desc).toBe('')
        expect(converted.firstMessage).toBe('')
        expect(converted.alternateGreetings).toEqual([])
        expect(converted.lore).toEqual([])
        expect(converted.name).toBe('이름 없는 작품')
    })

    it('turns lorebook settings into RisuAI marks and reports what has no counterpart', () => {
        const converted = convertSiteWork(sample())
        const [vault, rules, extra] = converted.lore
        expect(converted.lore).toHaveLength(3)
        expect(vault).toMatchObject({ key: '서고,봉인', comment: '서고', alwaysActive: false, mode: 'normal', insertorder: loreOrder(2), extentions: { bangju: true } })
        expect(vault.content).toBe('@@exclude_keys 꿈\n@@scan_depth 5\n@@activate_only_after 3\n봉인된 서고다.')
        // always on: keywords and the search window do not apply
        expect(rules).toMatchObject({ key: '', alwaysActive: true, content: '마법이 있다.' })
        // 보조 프롬프트 of the second start: only in chats begun from it
        expect(extra).toMatchObject({ key: '', alwaysActive: true, comment: '보조 프롬프트 · 시작 상황 2', content: '@@is_greeting 1\n이 시작에서는 밤이다.' })
        expect(converted.notes).toEqual(['로어북 "서고": 최대 턴(20)은 RisuAI에 맞는 기능이 없어 옮기지 못했습니다. 적어 둔 값은 남아 있습니다.'])
    })

    it('warns about an entry that can never turn on and about repeated picture codes', () => {
        const work = sample()
        work.lore = [{ ...emptyLore(), name: '잠든 항목', content: '내용' }]
        work.assets[1].code = '1'
        const notes = convertSiteWork(work).notes
        expect(notes.some((note) => note.includes('잠든 항목') && note.includes('켜지지 않습니다'))).toBe(true)
        expect(notes.some((note) => note.includes('그림 코드가 겹칩니다: 1'))).toBe(true)
    })

    it('a lower 루나톡 order is kept longer than a higher one, and an entry without one sits below both', () => {
        expect(loreOrder(1)).toBeGreaterThan(loreOrder(2))
        expect(loreOrder(2)).toBeGreaterThan(loreOrder(null))
        expect(loreOrder(5000)).toBe(0)
    })

    it('lists the pictures as bot assets: numbered ones by code, then one per character', () => {
        const work = sample()
        expect(siteAssets(work)).toEqual([['1', 'assets/one.png', 'png'], ['smi02', 'assets/two.webp', 'webp'], ['하와', 'assets/hawa.png', 'png']])
        work.assets[0].code = ''
        work.assets[1].code = '  '
        expect(siteAssets(work).slice(0, 2)).toEqual([['1', 'assets/one.png', 'png'], ['2', 'assets/two.webp', 'webp']])
        expect(convertSiteWork(work).image).toBe('assets/hawa.png')
        work.cover = 'assets/cover.png'
        expect(convertSiteWork(work).image).toBe('assets/cover.png')
    })
})

describe('site work storage', () => {
    it('reads back exactly what was stored', () => {
        const work = sample()
        work.tags = ['도서관', '사서']   // stored tags come back trimmed; everything else is kept letter for letter
        const character = { extentions: { [BANGJU_KEY]: JSON.parse(JSON.stringify(siteWorkEntry(work))), risuEasy: { subtitle: 'x' } } }
        expect(isSiteBased(character)).toBe(true)
        expect(readSiteWork(character)).toEqual(work)
    })

    it('a bot without the value is RisuAI-based', () => {
        expect(isSiteBased({})).toBe(false)
        expect(isSiteBased({ extentions: { risuEasy: {} } })).toBe(false)
        expect(isSiteBased({ extentions: { [BANGJU_KEY]: { base: 'other' } } })).toBe(false)
        expect(readSiteWork({ extentions: { [BANGJU_KEY]: 'broken' } })).toBeNull()
        expect(readSiteWork(null)).toBeNull()
    })

    it('odd stored data becomes empty fields, never an error', () => {
        const work = sanitizeSiteWork({ title: 3, tags: ['a', 5, ''], characters: 'x', starts: [], lore: [{ name: 'n', turns: -2, order: 'x', always: 'yes', onKeys: 'k' }], assets: [{ code: '1' }, { path: 'assets/p.png' }] })
        expect(work.title).toBe('')
        expect(work.tags).toEqual(['a'])
        expect(work.characters).toEqual([])
        expect(work.starts).toHaveLength(1)
        expect(work.lore[0]).toMatchObject({ name: 'n', turns: null, order: null, always: false, onKeys: [] })
        expect(work.assets).toHaveLength(1)
        expect(work.assets[0].path).toBe('assets/p.png')
    })

    it('splits typed keywords on commas and line breaks, without blanks or repeats', () => {
        expect(splitKeys(' 서고, 봉인 ,,서고\n대사서 ')).toEqual(['서고', '봉인', '대사서'])
        expect(splitKeys('')).toEqual([])
    })
})

describe('saving the form again', () => {
    it('replaces the pictures the form made and keeps pictures added elsewhere', () => {
        const before = sample()
        const after = sample()
        after.assets = [after.assets[0]]                       // the second picture was removed in the form
        const elsewhere: [string, string, string] = ['bgm', 'assets/song.mp3', 'mp3']
        const clash: [string, string, string] = ['1', 'assets/other.png', 'png']   // added elsewhere under a name the form also uses
        const existing = [...siteAssets(before), elsewhere, clash]
        expect(mergeSiteAssets(existing, before, siteAssets(after))).toEqual([elsewhere, clash, ['하와', 'assets/hawa.png', 'png']])
        // the first save of a bot that already had pictures keeps all of them
        expect(mergeSiteAssets([elsewhere], null, siteAssets(after))).toEqual([elsewhere, ['1', 'assets/one.png', 'png'], ['하와', 'assets/hawa.png', 'png']])
        expect(mergeSiteAssets(undefined, null, [])).toEqual([])
    })

    it('replaces the lorebook entries the form made and keeps every other entry', () => {
        const mine = { key: '직접', content: '직접 넣은 항목', extentions: { risu_case_sensitive: true } }
        const plain = { key: '또 하나', content: '표시 없는 항목' }
        const old = { key: '옛', content: '폼이 전에 만든 항목', extentions: { [BANGJU_KEY]: true } }
        const made = convertSiteWork(sample()).lore
        const entries: { key: string; content: string; extentions?: Record<string, unknown> }[] = [mine, old, plain]
        expect(mergeSiteLore(entries, made)).toEqual([mine, plain, ...made])
        expect(mergeSiteLore(undefined, made)).toEqual(made)
    })
})
