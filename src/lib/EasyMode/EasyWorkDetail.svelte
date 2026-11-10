<script lang="ts">
    import { ArrowLeftIcon, CheckIcon, MessageCircleIcon, PencilIcon, PlayIcon, SettingsIcon, UserRoundCogIcon } from '@lucide/svelte'
    import { DBState, openPersonaManager } from 'src/ts/stores.svelte'
    import type { character } from 'src/ts/storage/database.svelte'
    import { listStartSituations, readEasyMeta, toEasyWork, withEasyMeta, withStartTitle, type StartSituation } from 'src/ts/easyMode/works'
    import { defaultPersonaId, listPersonaChoices, saveWorkEdit } from 'src/ts/easyMode/chatStart'
    import { formatPreviewTime, toChatPreviewText } from 'src/ts/risubard/chatPreviewText'
    import { loadChatPreview } from 'src/ts/risubard/chatPreview'
    import { alertInput } from 'src/ts/alert'
    import EasyImage from './EasyImage.svelte'
    import EasyNotes from './EasyNotes.svelte'

    interface Props {
        chaId: string
        onBack: () => void
        onStart: (options: { fmIndex: number; personaId: string; title: string }) => void
        onOpenChat: (chatId: string) => void
        onEdit: () => void
    }

    let { chaId, onBack, onStart, onOpenChat, onEdit }: Props = $props()

    const chara = $derived(DBState.db.characters.find((item) => item?.chaId === chaId) as character | undefined)
    const work = $derived(chara ? toEasyWork(chara, DBState.db.characters.indexOf(chara)) : undefined)
    const userName = $derived(DBState.db.username || '나')
    const situations = $derived(chara ? listStartSituations(chara, { user: userName }) : [])
    const personas = $derived(listPersonaChoices(chara))

    let selectedStart = $state<number | null>(null)
    let selectedPersona = $state<string | null>(null)
    let notesExpanded = $state(false)
    let showAllChats = $state(false)

    const activeStart = $derived(
        selectedStart ?? situations.find((item) => item.isDefault)?.fmIndex ?? situations[0]?.fmIndex ?? -1
    )
    const activePersona = $derived(selectedPersona ?? defaultPersonaId(chara))
    const activeSituation = $derived(situations.find((item) => item.fmIndex === activeStart))

    // Chat history with the last message of each chat. Empty chats (for example the
    // one RisuAI makes when a card is imported) are left out, like on chat sites.
    interface HistoryRow { id: string; name: string; preview: string; time: number; order: number }
    let history = $state<HistoryRow[]>([])
    let historyLoaded = $state(false)

    $effect(() => {
        const target = chara
        if (!target) return
        const names = { user: userName, char: target.nickname || target.name }
        const entries = (target.chats ?? [])
            .map((chat, index) => ({ chat, index }))
            .filter(({ chat }) => !!chat?.id)
            .slice(0, 60)
        let alive = true
        const loads = entries.map(async ({ chat, index }): Promise<HistoryRow | null> => {
            const row = { id: chat.id!, name: chat.name || '이름 없는 대화', preview: '', time: 0, order: index }
            try {
                const preview = await loadChatPreview(target, chat, index)
                const last = preview?.lastMessage
                if (preview && !last) return null
                if (!last) return row
                const text = toChatPreviewText(last.data ?? '', names).replace(/\s+/g, ' ')
                return { ...row, preview: last.role === 'user' ? `나: ${text}` : text, time: last.time ?? 0 }
            } catch {
                return row
            }
        })
        void Promise.all(loads).then((rows) => {
            if (!alive) return
            history = rows.filter((row): row is HistoryRow => !!row)
                .sort((a, b) => (b.time - a.time) || (a.order - b.order))
            historyLoaded = true
        })
        return () => { alive = false }
    })

    async function renameSituation(situation: StartSituation) {
        if (!chara) return
        const next = await alertInput('시작 상황 제목 (비우면 그대로 둡니다)', [], situation.hasCustomTitle ? situation.title : '')
        // The input dialog returns '' for both cancel and an empty answer.
        if (!next?.trim()) return
        chara.extentions = withStartTitle(chara, situation.fmIndex, next)
        saveWorkEdit(chara.chaId)
    }

    async function editSubtitle() {
        if (!chara) return
        const current = readEasyMeta(chara).subtitle ?? ''
        const next = await alertInput('한 줄 소개 (비우면 그대로 둡니다)', [], current)
        if (!next?.trim()) return
        chara.extentions = withEasyMeta(chara.extentions, { subtitle: next.trim() })
        saveWorkEdit(chara.chaId)
    }

    function start() {
        onStart({ fmIndex: activeStart, personaId: activePersona, title: activeSituation?.hasCustomTitle ? activeSituation.title : '' })
    }
</script>

{#if !chara || !work}
    <div class="flex h-full flex-col items-center justify-center gap-3 text-textcolor2">
        <p>작품을 찾을 수 없어요.</p>
        <button type="button" class="rounded-full border border-darkborderc px-4 py-2" onclick={onBack}>홈으로</button>
    </div>
{:else}
<div class="relative flex h-full w-full flex-col" data-easy-detail={chaId}>
    <header class="absolute inset-x-0 top-0 z-10 flex h-14 items-center gap-2 px-2 md:static md:border-b md:border-darkborderc">
        <button type="button" class="flex h-10 w-10 items-center justify-center rounded-full bg-darkbg/80 backdrop-blur-sm hover:bg-selected md:bg-transparent" aria-label="뒤로" onclick={onBack}>
            <ArrowLeftIcon size={20} />
        </button>
        <span class="hidden min-w-0 flex-1 truncate text-base font-semibold md:block">{work.name}</span>
        <span class="flex-1 md:hidden"></span>
        <button type="button" class="flex h-10 items-center gap-1.5 rounded-full bg-darkbg/80 px-3 text-sm backdrop-blur-sm hover:bg-selected" onclick={onEdit}>
            <SettingsIcon size={16} />
            작품 설정
        </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-28" data-easy-detail-scroll>
        <div class="mx-auto w-full max-w-5xl md:grid md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:gap-8 md:px-6 md:pt-6">
            <div class="md:sticky md:top-6 md:self-start">
                <div class="relative w-full overflow-hidden bg-darkbg md:rounded-2xl md:border md:border-darkborderc">
                    <EasyImage src={work.image} alt={work.name} fallback={work.name} className="aspect-[4/3] max-h-[44vh] w-full object-cover text-6xl md:aspect-[3/4] md:max-h-none" />
                    <div class="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-bgcolor to-transparent md:hidden"></div>
                </div>
            </div>

            <div class="min-w-0 px-4 md:px-0">
                <h1 class="relative -mt-6 text-2xl font-bold leading-tight md:mt-0 md:text-3xl">{work.name}</h1>
                <button type="button" class="mt-1 flex max-w-full items-center gap-1 text-start text-sm text-textcolor2 hover:text-textcolor" onclick={editSubtitle}>
                    <span class="min-w-0 truncate">{work.subtitle || '한 줄 소개 추가'}</span>
                    <PencilIcon size={12} class="shrink-0 opacity-60" />
                </button>
                {#if work.creator}
                    <p class="mt-1 text-xs text-textcolor2">@{work.creator}</p>
                {/if}
                {#if work.tags.length}
                    <div class="mt-3 flex flex-wrap gap-1.5">
                        {#each work.tags as tag (tag)}
                            <span class="rounded-full bg-darkbutton px-2.5 py-0.5 text-xs text-textcolor2">#{tag}</span>
                        {/each}
                    </div>
                {/if}

                {#if chara.creatorNotes?.trim()}
                    <section class="mt-6">
                        <h2 class="mb-2 text-base font-bold">작품 소개</h2>
                        <div class="relative overflow-hidden text-sm leading-relaxed" class:max-h-36={!notesExpanded}>
                            <EasyNotes value={chara.creatorNotes} />
                            {#if !notesExpanded}
                                <div class="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-bgcolor to-transparent"></div>
                            {/if}
                        </div>
                        <button type="button" class="mt-1 text-sm font-medium text-primary" onclick={() => { notesExpanded = !notesExpanded }}>
                            {notesExpanded ? '접기' : '더 보기'}
                        </button>
                    </section>
                {/if}

                <section class="mt-6" aria-labelledby="easy-start-title">
                    <h2 id="easy-start-title" class="mb-2 text-base font-bold">시작 상황 <span class="text-sm font-normal text-textcolor2">{situations.length}</span></h2>
                    <div class="flex flex-col gap-2" role="radiogroup" aria-labelledby="easy-start-title">
                        {#each situations as situation (situation.fmIndex)}
                            {@const checked = situation.fmIndex === activeStart}
                            <div class="flex items-stretch gap-1 rounded-xl border bg-darkbg" class:border-primary={checked} class:border-darkborderc={!checked}>
                                <button type="button" role="radio" aria-checked={checked} class="flex min-w-0 flex-1 items-start gap-3 p-3 text-start" onclick={() => { selectedStart = situation.fmIndex }}>
                                    <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border" class:border-primary={checked} class:bg-primary={checked} class:text-accenttext={checked} class:border-darkborderc={!checked}>
                                        {#if checked}<CheckIcon size={13} />{/if}
                                    </span>
                                    <span class="min-w-0 flex-1">
                                        <span class="flex items-center gap-1.5">
                                            <span class="truncate text-sm font-semibold">{situation.title}</span>
                                            {#if situation.isDefault}
                                                <span class="shrink-0 rounded-full bg-selected px-1.5 text-[10px] leading-4 text-textcolor2">기본</span>
                                            {/if}
                                        </span>
                                        <span class="mt-0.5 line-clamp-2 block text-xs leading-snug text-textcolor2">{situation.description}</span>
                                    </span>
                                </button>
                                <button type="button" class="flex w-10 shrink-0 items-center justify-center text-textcolor2 hover:text-textcolor" aria-label="{situation.title} 제목 바꾸기" onclick={() => renameSituation(situation)}>
                                    <PencilIcon size={14} />
                                </button>
                            </div>
                        {/each}
                    </div>
                </section>

                <section class="mt-6" aria-labelledby="easy-persona-title">
                    <div class="mb-2 flex items-center">
                        <h2 id="easy-persona-title" class="flex-1 text-base font-bold">페르소나</h2>
                        <button type="button" class="flex items-center gap-1 text-xs text-textcolor2 hover:text-textcolor" onclick={() => openPersonaManager.set(true)}>
                            <UserRoundCogIcon size={14} />
                            관리
                        </button>
                    </div>
                    {#if personas.length}
                        <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0" role="radiogroup" aria-labelledby="easy-persona-title">
                            {#each personas as persona (persona.id)}
                                {@const checked = persona.id === activePersona}
                                <button type="button" role="radio" aria-checked={checked} class="flex w-20 shrink-0 flex-col items-center gap-1.5 rounded-xl border p-2" class:border-primary={checked} class:bg-selected={checked} class:border-transparent={!checked} onclick={() => { selectedPersona = persona.id }}>
                                    <EasyImage src={persona.icon} alt="" fallback={persona.name} className="h-12 w-12 rounded-full object-cover text-lg" />
                                    <span class="w-full truncate text-center text-xs">{persona.name}</span>
                                    {#if persona.scope === 'character'}
                                        <span class="-mt-1 text-[10px] text-textcolor2">이 작품 전용</span>
                                    {/if}
                                </button>
                            {/each}
                        </div>
                    {:else}
                        <p class="text-sm text-textcolor2">페르소나가 없어요. '관리'에서 만들 수 있어요.</p>
                    {/if}
                </section>

                {#if history.length}
                    <section class="mt-6" aria-labelledby="easy-chats-title">
                        <h2 id="easy-chats-title" class="mb-2 text-base font-bold">대화 기록 <span class="text-sm font-normal text-textcolor2">{history.length}</span></h2>
                        <ul class="divide-y divide-darkborderc overflow-hidden rounded-xl border border-darkborderc bg-darkbg">
                            {#each (showAllChats ? history : history.slice(0, 4)) as row (row.id)}
                                <li>
                                    <button type="button" class="flex w-full items-start gap-3 px-3 py-2.5 text-start hover:bg-selected" onclick={() => onOpenChat(row.id)}>
                                        <MessageCircleIcon size={18} class="mt-0.5 shrink-0 text-textcolor2" />
                                        <span class="min-w-0 flex-1">
                                            <span class="flex items-baseline gap-2">
                                                <span class="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</span>
                                                {#if row.time}
                                                    <span class="shrink-0 text-[11px] text-textcolor2">{formatPreviewTime(row.time)}</span>
                                                {/if}
                                            </span>
                                            {#if row.preview}
                                                <span class="mt-0.5 block truncate text-xs text-textcolor2">{row.preview}</span>
                                            {/if}
                                        </span>
                                    </button>
                                </li>
                            {/each}
                        </ul>
                        {#if history.length > 4}
                            <button type="button" class="mt-2 text-sm font-medium text-primary" onclick={() => { showAllChats = !showAllChats }}>
                                {showAllChats ? '접기' : `전체 ${history.length}개 보기`}
                            </button>
                        {/if}
                    </section>
                {/if}
            </div>
        </div>
    </div>

    <footer class="absolute inset-x-0 bottom-0 border-t border-darkborderc bg-bgcolor/95 backdrop-blur-sm" style:padding-bottom="env(safe-area-inset-bottom)">
        <div class="mx-auto flex max-w-5xl gap-2 p-3 md:justify-end md:px-6">
            {#if historyLoaded && history.length}
                <button type="button" class="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-darkborderc bg-darkbg px-4 text-sm font-semibold hover:border-borderc" onclick={() => onOpenChat(history[0].id)}>
                    <MessageCircleIcon size={18} />
                    이어하기
                </button>
            {/if}
            <button type="button" class="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-6 text-sm font-bold text-accenttext hover:opacity-90 md:max-w-sm" onclick={start}>
                <PlayIcon size={18} />
                새로운 대화 시작
            </button>
        </div>
    </footer>
</div>
{/if}
