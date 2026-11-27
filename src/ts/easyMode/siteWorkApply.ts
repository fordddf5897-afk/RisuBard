// 방주: 사이트 기반 작품을 봇에 실제로 적는다. 계산은 siteWork.ts가 하고, 여기서는 앱의 봇 데이터에 옮겨 적기만 한다.
// 그림은 앱에 원래 있는 그림 저장 기능으로 올린다(다른 봇의 그림과 같은 곳에 같은 방식으로 저장된다).
import { DBState } from 'src/ts/stores.svelte'
import { createNewCharacter } from 'src/ts/characters'
import { saveAsset } from 'src/ts/globalApi.svelte'
import type { character, loreBook } from 'src/ts/storage/database.svelte'
import { BANGJU_KEY, convertSiteWork, mergeSiteAssets, mergeSiteLore, readSiteWork, siteWorkEntry, type ConvertedWork, type SiteWork } from './siteWork'
import { withEasyMeta } from './works'
import { saveWorkEdit } from './chatStart'

export const SITE_IMAGE_TYPES = ['png', 'jpg', 'jpeg', 'gif', 'webp']

function findCharacter(chaId: string): character | null {
    const found = DBState.db.characters.find((item) => item?.chaId === chaId)
    // A group chat is not a work the site form can write into.
    return found && (found as { type?: string }).type !== 'group' ? found as character : null
}

/**
 * Writes the site work into the bot. The site form is the source: description, opening messages,
 * rule, tags and cover are replaced. Pictures and lorebook entries the form did not make are kept.
 */
export function applySiteWork(chaId: string, input: SiteWork): ConvertedWork {
    const target = findCharacter(chaId)
    if (!target) throw new Error('작품을 찾지 못했습니다.')
    const work = JSON.parse(JSON.stringify(input)) as SiteWork
    const converted = convertSiteWork(work)
    const before = readSiteWork(target)

    target.name = converted.name
    target.desc = converted.desc
    target.firstMessage = converted.firstMessage
    target.alternateGreetings = converted.alternateGreetings
    target.creatorNotes = converted.creatorNotes
    // Sent at the very end of every request, in every chat (see ConvertedWork.rule).
    target.depth_prompt = { depth: 0, prompt: converted.rule }
    target.tags = converted.tags
    if (converted.image) target.image = converted.image
    // A picture the form no longer lists goes; pictures and lorebook entries made elsewhere stay.
    target.additionalAssets = mergeSiteAssets(target.additionalAssets as [string, string, string][] | undefined, before, converted.assets)
    target.globalLore = mergeSiteLore(target.globalLore, converted.lore) as loreBook[]
    target.extentions = withEasyMeta(
        { ...(target.extentions ?? {}), [BANGJU_KEY]: siteWorkEntry(work) },
        { subtitle: converted.subtitle || undefined, startTitles: converted.startTitles, startDescriptions: converted.startDescriptions },
    )
    // The work is not the chat's selected character, so the app is told to save it.
    saveWorkEdit(chaId)
    return converted
}

/** Makes a new bot from a site work and returns its id. */
export function createSiteWork(work: SiteWork): { chaId: string; converted: ConvertedWork } {
    const index = createNewCharacter()
    const chaId = DBState.db.characters[index].chaId
    return { chaId, converted: applySiteWork(chaId, work) }
}

/** Stores one picture with the app's own asset store. */
export async function saveSiteImage(file: File): Promise<{ path: string; ext: string; fileName: string }> {
    const ext = (file.name.split('.').pop() ?? '').toLowerCase()
    if (!SITE_IMAGE_TYPES.includes(ext)) throw new Error(`올릴 수 없는 파일입니다: ${file.name} (PNG · JPG · GIF · WEBP만 됩니다)`)
    const path = await saveAsset(new Uint8Array(await file.arrayBuffer()), '', ext)
    return { path, ext, fileName: file.name }
}
