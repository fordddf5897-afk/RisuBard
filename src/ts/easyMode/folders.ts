// Folders on the easy-mode home. These are RisuAI's own folders: entries of
// `db.characterOrder` shaped `{ id, name, color, data: chaId[] }`. Easy mode adds
// no folder data of its own, so the classic sidebar, backups and the archive
// (which remembers a bot's folder by this id) all see the same folders.
import { v4 } from 'uuid'
import type { Database, folder } from '../storage/database.svelte'
import { createCharacterVaultFolder, deleteCharacterVaultFolder, moveCharactersToVaultFolder } from '../characterVault'
import type { EasyWork } from './works'

type FolderDatabase = Pick<Database, 'characters' | 'characterOrder' | 'characterVault'>
type OrderEntry = string | folder | null | undefined

/** `null` shows every work, `NO_FOLDER` the works outside folders, otherwise a folder id. */
export type EasyFolderFilter = string | null
export const NO_FOLDER = ''

export interface EasyFolder {
    id: string
    name: string
    /** Works on the home that are in this folder (trashed and group entries are not works). */
    count: number
}

function isFolder(entry: OrderEntry): entry is folder {
    return !!entry && typeof entry !== 'string' && Array.isArray(entry.data)
}

/** chaId → id of the folder it is in. Works outside folders are not in the map. */
export function folderOfWorks(order: readonly OrderEntry[] | undefined): Map<string, string> {
    const map = new Map<string, string>()
    for (const entry of order ?? []) {
        if (!isFolder(entry)) continue
        for (const chaId of entry.data) {
            if (typeof chaId === 'string' && !map.has(chaId)) map.set(chaId, entry.id)
        }
    }
    return map
}

/** Folders in the order the classic sidebar lists them, with how many works each holds. */
export function listFolders(order: readonly OrderEntry[] | undefined, works: readonly EasyWork[]): EasyFolder[] {
    const listed = new Set(works.map((work) => work.chaId))
    const folders: EasyFolder[] = []
    const seen = new Set<string>()
    for (const entry of order ?? []) {
        if (!isFolder(entry) || !entry.id || seen.has(entry.id)) continue
        seen.add(entry.id)
        folders.push({
            id: entry.id,
            name: entry.name?.trim() || '이름 없는 폴더',
            count: new Set(entry.data.filter((chaId) => listed.has(chaId))).size,
        })
    }
    return folders
}

export function filterByFolder(works: readonly EasyWork[], order: readonly OrderEntry[] | undefined, filter: EasyFolderFilter): EasyWork[] {
    if (filter === null) return [...works]
    const where = folderOfWorks(order)
    return works.filter((work) => (where.get(work.chaId) ?? NO_FOLDER) === filter)
}

/** How many works sit outside every folder. */
export function countWithoutFolder(works: readonly EasyWork[], order: readonly OrderEntry[] | undefined): number {
    const where = folderOfWorks(order)
    return works.filter((work) => !where.has(work.chaId)).length
}

function findFolder(db: FolderDatabase, folderId: string): folder | undefined {
    return (db.characterOrder ?? []).find((entry): entry is folder => isFolder(entry) && entry.id === folderId)
}

function nameTaken(db: FolderDatabase, name: string, exceptId = ''): boolean {
    return (db.characterOrder ?? []).some((entry) => isFolder(entry) && entry.id !== exceptId && entry.name?.trim() === name)
}

export type FolderNameProblem = 'empty' | 'taken'

/** Why a folder cannot get this name, or null when it can. */
export function folderNameProblem(db: FolderDatabase, name: string, exceptId = ''): FolderNameProblem | null {
    const trimmed = name.trim()
    if (!trimmed) return 'empty'
    return nameTaken(db, trimmed, exceptId) ? 'taken' : null
}

/** Adds an empty folder at the end of the list. Returns its id, or null when the name cannot be used. */
export function createFolder(db: FolderDatabase, name: string, id: string = v4()): string | null {
    if (folderNameProblem(db, name)) return null
    db.characterOrder = db.characterOrder ?? []
    return createCharacterVaultFolder(db, name, id)?.id ?? null
}

export function renameFolder(db: FolderDatabase, folderId: string, name: string): boolean {
    if (!findFolder(db, folderId) || folderNameProblem(db, name, folderId)) return false
    const trimmed = name.trim()
    // A new array and a new folder object, the way the classic helpers change the list.
    db.characterOrder = db.characterOrder.map((entry) => (isFolder(entry) && entry.id === folderId ? { ...entry, name: trimmed } : entry))
    return true
}

/** Removes the folder only. Its works stay and take the folder's place in the list. */
export function deleteFolder(db: FolderDatabase, folderId: string): boolean {
    if (!findFolder(db, folderId)) return false
    deleteCharacterVaultFolder(db, folderId)
    return true
}

/** Puts one work into a folder, or outside folders with `NO_FOLDER`. */
export function moveWorkToFolder(db: FolderDatabase, chaId: string, folderId: string): boolean {
    if (folderId !== NO_FOLDER && !findFolder(db, folderId)) return false
    if ((folderOfWorks(db.characterOrder).get(chaId) ?? NO_FOLDER) === folderId) return false
    moveCharactersToVaultFolder(db, [chaId], folderId === NO_FOLDER ? null : folderId)
    return true
}

/**
 * Makes the folder hold exactly the given works among `scope` (the works the
 * editor showed). Works of the folder that were not shown, such as trashed
 * ones, are left where they are. Returns how many went in and came out.
 */
export function setFolderWorks(
    db: FolderDatabase,
    folderId: string,
    chaIds: readonly string[],
    scope: readonly string[],
): { added: number; removed: number } {
    const target = findFolder(db, folderId)
    if (!target) return { added: 0, removed: 0 }
    const wanted = new Set(chaIds)
    const shown = new Set(scope)
    const inside = new Set(target.data)
    const add = [...wanted].filter((chaId) => shown.has(chaId) && !inside.has(chaId))
    const remove = [...inside].filter((chaId) => shown.has(chaId) && !wanted.has(chaId))
    if (add.length) moveCharactersToVaultFolder(db, add, folderId)
    if (remove.length) moveCharactersToVaultFolder(db, remove, null)
    return { added: add.length, removed: remove.length }
}
