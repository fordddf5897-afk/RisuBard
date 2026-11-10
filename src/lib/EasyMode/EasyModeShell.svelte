<script lang="ts">
    // Easy mode: home → work page → chat, in the order of character-chat sites.
    // Everything underneath is the regular RisuAI/RisuBard data and chat engine.
    import { onMount } from 'svelte'
    import { get } from 'svelte/store'
    import { DBState, selectedCharID } from 'src/ts/stores.svelte'
    import { alertSelect, notifyError } from 'src/ts/alert'
    import { changeChar, createNewCharacter } from 'src/ts/characters'
    import { importCharacter } from 'src/ts/characterCards'
    import { easyView, type EasyPage } from 'src/ts/easyMode/state.svelte'
    import { findCharacterIndex, openEasyChat, startEasyChat } from 'src/ts/easyMode/chatStart'
    import EasyHome from './EasyHome.svelte'
    import EasyWorkDetail from './EasyWorkDetail.svelte'
    import EasyChat from './EasyChat.svelte'
    import EasySheet from './EasySheet.svelte'
    import EasyWorkEditor from './EasyWorkEditor.svelte'
    import EasySettings from './EasySettings.svelte'
    import SideChatList from '../SideBars/SideChatList.svelte'

    type Sheet = null | 'settings' | 'editor' | 'chats'
    let sheet = $state<Sheet>(null)
    let editorTab = $state(0)

    interface HistoryEntry { page: EasyPage; chaId: string }

    function apply(page: EasyPage, chaId: string) {
        sheet = null
        if (page !== 'home' && findCharacterIndex(chaId) < 0) {
            page = 'home'
            chaId = ''
        }
        if (page === 'chat') {
            try {
                openEasyChat(chaId)
            } catch (cause) {
                notifyError(cause)
                page = 'detail'
            }
        } else if (get(selectedCharID) !== -1) {
            // Leaving the chat closes it, like the classic mobile back button.
            selectedCharID.set(-1)
        }
        easyView.page = page
        easyView.chaId = chaId
    }

    // History entries this shell pushed, so Back never leaves the app.
    let pushed = 0

    function go(page: EasyPage, chaId = '') {
        apply(page, chaId)
        try {
            history.pushState({ risuEasy: { page: easyView.page, chaId: easyView.chaId } satisfies HistoryEntry }, '')
            pushed += 1
        } catch {
            // History can be unavailable in embedded webviews.
        }
    }

    function back() {
        if (pushed > 0) history.back()
        else go(easyView.page === 'chat' ? 'detail' : 'home', easyView.page === 'chat' ? easyView.chaId : '')
    }

    onMount(() => {
        // Settings replaces this shell while open; returning remounts it on the same page.
        if (easyView.page === 'chat' && get(selectedCharID) === -1) apply('detail', easyView.chaId)
        try {
            history.replaceState({ ...(history.state ?? {}), risuEasy: { page: easyView.page, chaId: easyView.chaId } satisfies HistoryEntry }, '')
        } catch {
            // Ignore.
        }
        const onPop = (event: PopStateEvent) => {
            pushed = Math.max(0, pushed - 1)
            const entry = event.state?.risuEasy as HistoryEntry | undefined
            apply(entry?.page ?? 'home', entry?.chaId ?? '')
        }
        window.addEventListener('popstate', onPop)
        return () => window.removeEventListener('popstate', onPop)
    })

    function openWork(chaId: string) {
        go('detail', chaId)
    }

    function continueWork(chaId: string) {
        go('chat', chaId)
    }

    function startChat(options: { fmIndex: number; personaId: string; title: string }) {
        try {
            startEasyChat(easyView.chaId, options)
            go('chat', easyView.chaId)
        } catch (cause) {
            notifyError(cause)
        }
    }

    function openExistingChat(chatId: string) {
        try {
            openEasyChat(easyView.chaId, chatId)
            go('chat', easyView.chaId)
        } catch (cause) {
            notifyError(cause)
        }
    }

    function openEditor(tab: number) {
        const index = findCharacterIndex(easyView.chaId)
        if (index < 0) return
        // The classic editor edits the selected character.
        if (get(selectedCharID) !== index) changeChar(index)
        editorTab = tab
        sheet = 'editor'
    }

    function closeSheet() {
        const closing = sheet
        sheet = null
        // The work page keeps no character selected, so its edits save like any other.
        if (closing === 'editor' && easyView.page !== 'chat') selectedCharID.set(-1)
    }

    async function addWork() {
        const choice = await alertSelect(['파일에서 가져오기 (.charx · .png · .json)', '빈 작품 새로 만들기', '취소'], '작품 추가')
        const before = new Set(DBState.db.characters.map((item) => item?.chaId))
        if (choice === '0') await importCharacter()
        else if (choice === '1') createNewCharacter()
        else return
        const added = DBState.db.characters.filter((item) => item && !before.has(item.chaId))
        const target = added.at(-1)
        if (!target) return
        go('detail', target.chaId)
        if (choice === '1') openEditor(0)
    }
</script>

<div class="flex h-full w-full flex-col overflow-hidden bg-bgcolor text-textcolor" data-easy-shell style:padding-top="env(safe-area-inset-top)">
    {#if easyView.page === 'home'}
        <EasyHome onOpenWork={openWork} onContinue={continueWork} onAddWork={addWork} onOpenSettings={() => { sheet = 'settings' }} />
    {:else if easyView.page === 'detail'}
        {#key easyView.chaId}
            <EasyWorkDetail
                chaId={easyView.chaId}
                onBack={back}
                onStart={startChat}
                onOpenChat={openExistingChat}
                onEdit={() => openEditor(0)}
            />
        {/key}
    {:else if easyView.page === 'chat'}
        <EasyChat
            onBack={back}
            onNewChat={() => go('detail', easyView.chaId)}
            onOpenChats={() => { sheet = 'chats' }}
            onOpenEditor={openEditor}
            onOpenSettings={() => { sheet = 'settings' }}
        />
    {/if}
</div>

{#if sheet === 'settings'}
    <EasySheet title="간편 모드 설정" onClose={closeSheet}>
        <EasySettings />
    </EasySheet>
{:else if sheet === 'editor' && $selectedCharID >= 0}
    <EasySheet title="작품 설정 · {DBState.db.characters[$selectedCharID]?.name ?? ''}" onClose={closeSheet} wide>
        <EasyWorkEditor bind:tab={editorTab} />
    </EasySheet>
{:else if sheet === 'chats' && $selectedCharID >= 0}
    <EasySheet title="대화 목록 · 채팅 설정" onClose={closeSheet}>
        <div class="p-3">
            <SideChatList bind:chara={DBState.db.characters[$selectedCharID]} />
        </div>
    </EasySheet>
{/if}
