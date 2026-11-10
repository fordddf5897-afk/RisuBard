<script lang="ts">
    // Eden-style chat page: a simple top bar over the classic RisuAI chat screen, plus
    // a side menu that gathers the RisuBard tools (save slots, Memory Wiki, lorebook,
    // auto illustrations). The chat itself is the unchanged ChatScreen.
    import { untrack } from 'svelte'
    import {
        ArrowLeftIcon, BookMarkedIcon, BookOpenIcon, BrushIcon, FolderOpenIcon, ListIcon, LoaderCircleIcon,
        MenuIcon, PaletteIcon, PlusIcon, SaveIcon, SettingsIcon, UserRoundIcon, WandSparklesIcon, XIcon, ZapIcon,
    } from '@lucide/svelte'
    import { DBState, openPersonaManager, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'
    import { doingChat } from 'src/ts/process/generationState'
    import type { character } from 'src/ts/storage/database.svelte'
    import { notifyError, notifySuccess } from 'src/ts/alert'
    import { easyPrefs, saveEasyPrefs } from 'src/ts/easyMode/state.svelte'
    import { requestMemoryWiki, requestQuickSave, requestSaveSlots } from 'src/ts/easyMode/events'
    import { illustrateLatestReply, shouldIllustrate } from 'src/ts/easyMode/autoIllustrate'
    import ChatScreen from '../ChatScreens/ChatScreen.svelte'
    import ShSwitch from '../UI/GUI/ShSwitch.svelte'
    import EasyImage from './EasyImage.svelte'

    interface Props {
        onBack: () => void
        onNewChat: () => void
        onOpenChats: () => void
        onOpenEditor: (tab: number) => void
        onOpenSettings: () => void
    }

    let { onBack, onNewChat, onOpenChats, onOpenEditor, onOpenSettings }: Props = $props()

    const chara = $derived($selectedCharID >= 0 ? DBState.db.characters[$selectedCharID] as character | undefined : undefined)
    const chat = $derived(chara?.chats?.[chara.chatPage])

    let menuOpen = $state(false)
    let illustrating = $state(false)
    // Replies already handled in this visit, so a re-render never draws twice.
    const illustrated = new Set<string>()

    function close(after?: () => void) {
        menuOpen = false
        after?.()
    }

    async function illustrate(manual: boolean) {
        const current = chara
        const currentChat = chat
        if (!current || !currentChat?.id || illustrating) return
        illustrating = true
        try {
            const outcome = await illustrateLatestReply(current.chaId, currentChat.id)
            const last = currentChat.message?.at(-1)
            if (last?.chatId) illustrated.add(last.chatId)
            if (outcome.ok) notifySuccess('답변 아래에 삽화를 넣었어요.')
            else if (manual || outcome.reason !== 'skipped') notifyError(outcome.message)
        } finally {
            illustrating = false
        }
    }

    function maybeIllustrate() {
        const currentChat = chat
        if (!currentChat || currentChat._placeholder || !Array.isArray(currentChat.message)) return
        const run = shouldIllustrate({
            enabled: easyPrefs.autoIllustrate,
            every: easyPrefs.illustrateEvery,
            messages: currentChat.message,
            alreadyDone: illustrated,
        })
        if (run) void illustrate(false)
    }

    // A reply is finished when the chat stops generating.
    let wasGenerating = false
    $effect(() => {
        const generating = $doingChat
        if (wasGenerating && !generating) untrack(maybeIllustrate)
        wasGenerating = generating
    })

    function setAutoIllustrate(value: boolean) {
        easyPrefs.autoIllustrate = value
        saveEasyPrefs()
        if (value && !DBState.db.NAIApiKey?.trim()) {
            notifyError('NovelAI API 키가 아직 없어요. 간편 모드 설정에서 이미지 생성 설정을 열어 넣어 주세요.')
        }
    }
</script>

<div class="flex h-full w-full flex-col" data-easy-chat>
    <header class="flex h-14 shrink-0 items-center gap-2 border-b border-darkborderc bg-bgcolor px-2">
        <button type="button" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-selected" aria-label="뒤로" onclick={onBack}>
            <ArrowLeftIcon size={20} />
        </button>
        {#if chara}
            <EasyImage src={chara.image} alt="" fallback={chara.name} className="h-9 w-9 shrink-0 rounded-full object-cover text-sm" />
            <div class="min-w-0 flex-1 leading-tight">
                <p class="truncate text-sm font-semibold">{chara.name}</p>
                <p class="truncate text-xs text-textcolor2">{chat?.name ?? ''}</p>
            </div>
        {:else}
            <div class="flex-1"></div>
        {/if}
        {#if illustrating}
            <span class="flex shrink-0 items-center gap-1 rounded-full bg-selected px-2 py-1 text-xs text-textcolor2" role="status">
                <LoaderCircleIcon size={14} class="animate-spin" />
                삽화 그리는 중
            </span>
        {/if}
        <button type="button" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-selected" aria-label="세이브" title="세이브" onclick={() => requestSaveSlots('save')}>
            <SaveIcon size={19} />
        </button>
        <button type="button" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-selected" aria-label="메뉴" aria-expanded={menuOpen} onclick={() => { menuOpen = true }}>
            <MenuIcon size={20} />
        </button>
    </header>

    <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden" data-lorebook-dock-host>
        {#if chara}
            <ChatScreen />
        {/if}
    </div>
</div>

{#if menuOpen}
    <div class="fixed inset-0 z-40 flex justify-end bg-overlay/60" role="presentation">
        <button type="button" class="absolute inset-0 cursor-default" aria-label="메뉴 닫기" onclick={() => close()}></button>
        <nav class="relative flex h-full w-[min(20rem,88vw)] flex-col overflow-y-auto border-l border-darkborderc bg-bgcolor text-textcolor shadow-xl" aria-label="채팅 메뉴">
            <div class="flex h-14 shrink-0 items-center gap-2 border-b border-darkborderc px-4">
                <span class="flex-1 text-base font-semibold">메뉴</span>
                <button type="button" class="flex h-9 w-9 items-center justify-center rounded-full hover:bg-selected" aria-label="닫기" onclick={() => close()}>
                    <XIcon size={18} />
                </button>
            </div>

            <div class="easy-menu-group">
                <p class="easy-menu-label">대화</p>
                <button type="button" class="easy-menu-item" onclick={() => close(onNewChat)}><PlusIcon size={18} />새 대화 (시작 상황 고르기)</button>
                <button type="button" class="easy-menu-item" onclick={() => close(onOpenChats)}><ListIcon size={18} />대화 목록 · 채팅 설정</button>
                <button type="button" class="easy-menu-item" onclick={() => close(() => requestSaveSlots('save'))}><SaveIcon size={18} />세이브</button>
                <button type="button" class="easy-menu-item" onclick={() => close(() => requestSaveSlots('load'))}><FolderOpenIcon size={18} />불러오기</button>
                <button type="button" class="easy-menu-item" onclick={() => close(requestQuickSave)}><ZapIcon size={18} />빠른 세이브</button>
            </div>

            <div class="easy-menu-group">
                <p class="easy-menu-label">기억 · 설정집</p>
                <button type="button" class="easy-menu-item" onclick={() => close(requestMemoryWiki)}><BookOpenIcon size={18} />메모리 위키 (BardWiki)</button>
                <button type="button" class="easy-menu-item" onclick={() => close(() => onOpenEditor(3))}><BookMarkedIcon size={18} />로어북 · Grimoire</button>
            </div>

            <div class="easy-menu-group">
                <p class="easy-menu-label">작품</p>
                <button type="button" class="easy-menu-item" onclick={() => close(() => onOpenEditor(0))}><SettingsIcon size={18} />작품 설정</button>
                <button type="button" class="easy-menu-item" onclick={() => close(() => openPersonaManager.set(true))}><UserRoundIcon size={18} />페르소나</button>
            </div>

            <div class="easy-menu-group">
                <p class="easy-menu-label">삽화 (NovelAI)</p>
                <div class="easy-menu-item">
                    <WandSparklesIcon size={18} />
                    <span class="min-w-0 flex-1">
                        자동 삽화
                        <span class="block text-xs text-textcolor2">답변 {easyPrefs.illustrateEvery}개마다 한 장</span>
                    </span>
                    <ShSwitch checked={easyPrefs.autoIllustrate} ariaLabel="자동 삽화" onCheckedChange={setAutoIllustrate} />
                </div>
                <button type="button" class="easy-menu-item" disabled={illustrating || !chat?.message?.length} onclick={() => close(() => void illustrate(true))}><BrushIcon size={18} />마지막 답변 지금 그리기</button>
            </div>

            <div class="easy-menu-group">
                <p class="easy-menu-label">화면</p>
                <button type="button" class="easy-menu-item" onclick={() => close(onOpenSettings)}><PaletteIcon size={18} />간편 모드 설정 · 스킨</button>
                <button type="button" class="easy-menu-item" onclick={() => close(() => settingsOpen.set(true))}><SettingsIcon size={18} />전체 설정</button>
            </div>
        </nav>
    </div>
{/if}

<style>
    /* The classic sidebar toggle has nothing to open in easy mode. */
    :global([data-easy-chat] [data-sidebar-arrow]) {
        display: none;
    }
    .easy-menu-group {
        display: flex;
        flex-direction: column;
        padding: 0.5rem 0.5rem;
        border-bottom: 1px solid var(--color-darkborderc);
    }
    .easy-menu-label {
        padding: 0.25rem 0.75rem;
        font-size: 0.75rem;
        color: var(--color-textcolor2);
    }
    .easy-menu-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-height: 2.75rem;
        padding: 0.5rem 0.75rem;
        border-radius: var(--risu-radius-lg);
        font-size: 0.9rem;
        text-align: start;
        color: var(--color-textcolor);
    }
    button.easy-menu-item:hover {
        background: var(--color-selected);
    }
    button.easy-menu-item:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
</style>
