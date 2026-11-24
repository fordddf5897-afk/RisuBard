import { describe, expect, test } from 'vitest'
import { listWorks } from './works'
import {
    NO_FOLDER, countWithoutFolder, createFolder, deleteFolder, filterByFolder, folderNameProblem,
    folderOfWorks, listFolders, moveWorkToFolder, renameFolder, setFolderWorks,
} from './folders'

const character = (chaId: string, extra: Record<string, unknown> = {}) => ({ type: 'character', chaId, name: chaId.toUpperCase(), chats: [], ...extra })

function database() {
    const characters = ['a', 'b', 'c', 'd', 'e'].map((id) => character(id))
    return {
        characters: [...characters, character('gone', { trashTime: 1 })],
        characterOrder: [
            { id: 'f1', name: '판타지', color: 'default', data: ['a', 'b', 'gone'] },
            'c',
            { id: 'f2', name: '일상', color: 'default', data: ['d'] },
            'e',
        ],
        characterVault: undefined,
    } as any
}

const names = (works: { chaId: string }[]) => works.map((work) => work.chaId).join('')

describe('easy-mode folders read RisuAI\'s own folder list', () => {
    test('lists folders in sidebar order and counts only works shown on the home', () => {
        const db = database()
        const works = listWorks(db.characters)
        expect(listFolders(db.characterOrder, works)).toEqual([
            { id: 'f1', name: '판타지', count: 2 },
            { id: 'f2', name: '일상', count: 1 },
        ])
        expect(countWithoutFolder(works, db.characterOrder)).toBe(2)
        expect([...folderOfWorks(db.characterOrder)]).toEqual([['a', 'f1'], ['b', 'f1'], ['gone', 'f1'], ['d', 'f2']])
    })

    test('filters by one folder, by no folder, or not at all', () => {
        const db = database()
        const works = listWorks(db.characters)
        expect(names(filterByFolder(works, db.characterOrder, 'f1'))).toBe('ab')
        expect(names(filterByFolder(works, db.characterOrder, NO_FOLDER))).toBe('ce')
        expect(names(filterByFolder(works, db.characterOrder, null))).toBe('abcde')
        expect(names(filterByFolder(works, db.characterOrder, 'missing'))).toBe('')
    })

    test('a list without folders, or a broken entry, is handled', () => {
        const works = listWorks(database().characters)
        expect(listFolders(undefined, works)).toEqual([])
        expect(listFolders(['a', null, { id: '', name: 'x', data: [] } as any], works)).toEqual([])
        expect(names(filterByFolder(works, undefined, NO_FOLDER))).toBe('abcde')
    })
})

describe('easy-mode folder changes write the same folder list', () => {
    test('creates a folder at the end; empty and duplicate names are refused', () => {
        const db = database()
        expect(folderNameProblem(db, '  ')).toBe('empty')
        expect(folderNameProblem(db, ' 판타지 ')).toBe('taken')
        expect(createFolder(db, '판타지', 'x')).toBeNull()
        expect(createFolder(db, ' 새 폴더 ', 'f3')).toBe('f3')
        expect(db.characterOrder.at(-1)).toEqual({ id: 'f3', name: '새 폴더', color: 'default', data: [] })
        expect(db.characterOrder).toHaveLength(5)
    })

    test('creates the first folder when the list was never made', () => {
        const db = { characters: [character('a')], characterOrder: undefined, characterVault: undefined } as any
        expect(createFolder(db, '처음', 'f1')).toBe('f1')
        expect(db.characterOrder).toEqual([{ id: 'f1', name: '처음', color: 'default', data: [] }])
    })

    test('renames in place and keeps id, colour and works', () => {
        const db = database()
        expect(renameFolder(db, 'f1', '일상')).toBe(false)
        expect(renameFolder(db, 'f1', '판타지')).toBe(true)
        expect(renameFolder(db, 'nope', '이름')).toBe(false)
        expect(renameFolder(db, 'f1', ' 모험 ')).toBe(true)
        expect(db.characterOrder[0]).toEqual({ id: 'f1', name: '모험', color: 'default', data: ['a', 'b', 'gone'] })
    })

    test('deleting a folder keeps its works, in the folder\'s place', () => {
        const db = database()
        expect(deleteFolder(db, 'f1')).toBe(true)
        expect(db.characterOrder).toEqual(['a', 'b', 'gone', 'c', { id: 'f2', name: '일상', color: 'default', data: ['d'] }, 'e'])
        expect(deleteFolder(db, 'f1')).toBe(false)
    })

    test('moves one work into a folder, to another folder, and out', () => {
        const db = database()
        expect(moveWorkToFolder(db, 'c', 'f1')).toBe(true)
        expect(db.characterOrder[0].data).toEqual(['a', 'b', 'gone', 'c'])
        expect(db.characterOrder).not.toContain('c')
        expect(moveWorkToFolder(db, 'c', 'f1')).toBe(false)
        expect(moveWorkToFolder(db, 'c', 'f2')).toBe(true)
        expect(folderOfWorks(db.characterOrder).get('c')).toBe('f2')
        expect(moveWorkToFolder(db, 'c', NO_FOLDER)).toBe(true)
        expect(folderOfWorks(db.characterOrder).has('c')).toBe(false)
        expect(db.characterOrder.filter((entry: unknown) => entry === 'c')).toHaveLength(1)
        expect(moveWorkToFolder(db, 'c', 'missing')).toBe(false)
    })

    test('the editor\'s checklist puts works in and takes works out, and leaves hidden ones alone', () => {
        const db = database()
        const shown = listWorks(db.characters).map((work) => work.chaId)
        // was a, b (+ a trashed one the editor does not show); the user unticks a and ticks d, e
        expect(setFolderWorks(db, 'f1', ['b', 'd', 'e'], shown)).toEqual({ added: 2, removed: 1 })
        const where = folderOfWorks(db.characterOrder)
        expect(where.get('b')).toBe('f1')
        expect(where.get('d')).toBe('f1')
        expect(where.get('e')).toBe('f1')
        expect(where.has('a')).toBe(false)
        expect(where.get('gone')).toBe('f1')
        // every bot is still in the list exactly once
        const flat = db.characterOrder.flatMap((entry: any) => (typeof entry === 'string' ? [entry] : entry.data))
        expect([...flat].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'gone'])
        expect(setFolderWorks(db, 'missing', ['a'], shown)).toEqual({ added: 0, removed: 0 })
    })
})
