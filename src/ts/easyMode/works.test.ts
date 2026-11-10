import { describe, expect, test } from 'vitest'
import {
    EASY_META_KEY, filterWorks, firstLine, listStartSituations, listWorks, popularTags, readEasyMeta,
    recentlyPlayed, sortWorks, withEasyMeta, withStartTitle, type EasyCharacterLike,
} from './works'

const char = (patch: Partial<EasyCharacterLike>): EasyCharacterLike => ({
    type: 'character', chaId: patch.chaId ?? patch.name ?? 'id', name: 'Name', chats: [], ...patch,
})

describe('listWorks', () => {
    test('skips groups, trashed and empty slots but keeps database indices', () => {
        const works = listWorks([
            char({ chaId: 'a', name: 'A' }),
            null,
            char({ chaId: 'g', name: 'Group', type: 'group' }),
            char({ chaId: 't', name: 'Trashed', trashTime: 1 }),
            char({ chaId: 'b', name: 'B' }),
        ])
        expect(works.map((work) => [work.chaId, work.index])).toEqual([['a', 0], ['b', 4]])
    })

    test('subtitle prefers easy metadata, then the first creator-notes line without markup', () => {
        const [withMeta, fromNotes] = listWorks([
            char({ chaId: 'a', creatorNotes: 'ignored', extentions: { [EASY_META_KEY]: { subtitle: '한 줄 소개' } } }),
            char({ chaId: 'b', creatorNotes: '<p><b>폐허가 된</b> 도시</p>\n\n둘째 줄' }),
        ])
        expect(withMeta.subtitle).toBe('한 줄 소개')
        expect(fromNotes.subtitle).toBe('폐허가 된 도시')
    })
})

describe('search, tags and sorting', () => {
    const works = listWorks([
        char({ chaId: 'a', name: '하얀 늑대', tags: ['판타지', '로맨스'], lastInteraction: 10, creation_date: 1, chats: [{ id: 'c' }] }),
        char({ chaId: 'b', name: 'Space Cafe', tags: ['SF'], creator: 'neo', lastInteraction: 30, creation_date: 3 }),
        char({ chaId: 'c', name: '검은 성', tags: ['판타지'], lastInteraction: 20, creation_date: 2, chats: [{ id: 'd' }] }),
    ])

    test('matches name, tag and creator ignoring spaces and case', () => {
        expect(filterWorks(works, { query: '하얀늑대' }).map((w) => w.chaId)).toEqual(['a'])
        expect(filterWorks(works, { query: 'space cafe' }).map((w) => w.chaId)).toEqual(['b'])
        expect(filterWorks(works, { query: 'NEO' }).map((w) => w.chaId)).toEqual(['b'])
        expect(filterWorks(works, { tag: '판타지' }).map((w) => w.chaId)).toEqual(['a', 'c'])
        expect(filterWorks(works, { tag: '판타지', query: '성' }).map((w) => w.chaId)).toEqual(['c'])
    })

    test('sorts by recent play, newest card or name', () => {
        expect(sortWorks(works, 'recent').map((w) => w.chaId)).toEqual(['b', 'c', 'a'])
        expect(sortWorks(works, 'new').map((w) => w.chaId)).toEqual(['b', 'c', 'a'])
        // Korean collation puts Hangul before Latin letters.
        expect(sortWorks(works, 'name').map((w) => w.name)).toEqual(['검은 성', '하얀 늑대', 'Space Cafe'])
    })

    test('counts tags and lists only works that were opened', () => {
        expect(popularTags(works)).toEqual([{ tag: '판타지', count: 2 }, { tag: '로맨스', count: 1 }, { tag: 'SF', count: 1 }])
        expect(recentlyPlayed(works).map((w) => w.chaId)).toEqual(['b', 'c', 'a'])
        expect(recentlyPlayed(listWorks([char({ chaId: 'fresh', chats: [{ id: 'x' }] })]))).toEqual([])
    })
})

describe('start situations', () => {
    test('maps the first message to fmIndex -1 and alternates to their index', () => {
        const situations = listStartSituations(char({
            name: '루카',
            firstMessage: '{{char}}가 {{user}}를 본다.',
            alternateGreetings: ['<p>비 오는 밤</p>', '두 번째'],
            firstMsgIndex: 0,
            extentions: { [EASY_META_KEY]: { startTitles: ['', '비 오는 밤의 재회'] } },
        }), { user: '하루' })
        expect(situations.map((s) => [s.fmIndex, s.title, s.isDefault, s.hasCustomTitle])).toEqual([
            [-1, '시작 상황 1', false, false],
            [0, '비 오는 밤의 재회', true, true],
            [1, '시작 상황 3', false, false],
        ])
        expect(situations[0].description).toBe('루카가 하루를 본다.')
    })

    test('hides an empty first message when alternates exist, keeps it when alone', () => {
        expect(listStartSituations(char({ firstMessage: '', alternateGreetings: ['a'] }), { user: 'u' }).map((s) => s.fmIndex)).toEqual([0])
        expect(listStartSituations(char({ firstMessage: '' }), { user: 'u' }).map((s) => s.fmIndex)).toEqual([-1])
    })

    test('writes titles into extensions without touching other keys', () => {
        const source = char({ alternateGreetings: ['x', 'y'], extentions: { other: 1 } })
        const next = withStartTitle(source, 1, '  밤의 골목 ')
        expect(next.other).toBe(1)
        expect(readEasyMeta({ extentions: next }).startTitles).toEqual(['', '', '밤의 골목'])
        const patched = withEasyMeta(next, { subtitle: '소개' })
        expect(readEasyMeta({ extentions: patched })).toEqual({ subtitle: '소개', startTitles: ['', '', '밤의 골목'], startDescriptions: undefined })
    })

    test('ignores malformed metadata', () => {
        expect(readEasyMeta({ extentions: { [EASY_META_KEY]: 'bad' } })).toEqual({})
        expect(readEasyMeta({ extentions: { [EASY_META_KEY]: { startTitles: [1, 'b'] } } }).startTitles).toEqual(['', 'b'])
    })
})

test('firstLine truncates long text', () => {
    expect(firstLine('a'.repeat(60), 10)).toBe(`${'a'.repeat(9)}…`)
    expect(firstLine(undefined)).toBe('')
})
