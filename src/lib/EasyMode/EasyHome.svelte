<script lang="ts">
    import { FolderIcon, FolderPlusIcon, HouseIcon, PencilIcon, PlusIcon, SearchIcon, SettingsIcon, XIcon } from '@lucide/svelte'
    import { untrack } from 'svelte'
    import { DBState } from 'src/ts/stores.svelte'
    import { alertInput, alertNormal } from 'src/ts/alert'
    import { filterWorks, listWorks, popularTags, recentlyPlayed, sortWorks, type EasyWork, type EasyWorkSort } from 'src/ts/easyMode/works'
    import { NO_FOLDER, countWithoutFolder, createFolder, filterByFolder, folderNameProblem, listFolders } from 'src/ts/easyMode/folders'
    import { LIST_PAGE, nextLimit, onVisible } from 'src/ts/easyMode/visible'
    import { easyPrefs, easyView, saveEasyPrefs, setEasyModeEnabled } from 'src/ts/easyMode/state.svelte'
    import { formatPreviewTime } from 'src/ts/risubard/chatPreviewText'
    import EasyWorkCard from './EasyWorkCard.svelte'
    import EasyImage from './EasyImage.svelte'
    import EasySheet from './EasySheet.svelte'
    import EasyFolderEditor from './EasyFolderEditor.svelte'

    interface Props {
        onOpenWork: (chaId: string) => void
        onContinue: (chaId: string) => void
        onAddWork: () => void
        onOpenSettings: () => void
    }

    let { onOpenWork, onContinue, onAddWork, onOpenSettings }: Props = $props()

    let query = $state('')
    let activeTag = $state<string | null>(null)

    const works = $derived(listWorks(DBState.db.characters))
    const tags = $derived(popularTags(works, 24))
    const recent = $derived(recentlyPlayed(works, 12))

    // Folders are RisuAI's own (db.characterOrder), so the classic sidebar shows the same ones.
    const folders = $derived(listFolders(DBState.db.characterOrder, works))
    const withoutFolder = $derived(countWithoutFolder(works, DBState.db.characterOrder))
    // A choice that no longer exists falls back to every work: a folder that was deleted (here
    // or on the classic screen), or "폴더 없음" once nothing is outside folders any more.
    const activeFolder = $derived(
        easyView.homeFolder === null ? null
            : easyView.homeFolder === NO_FOLDER ? (folders.length > 0 && withoutFolder > 0 ? NO_FOLDER : null)
                : folders.some((item) => item.id === easyView.homeFolder) ? easyView.homeFolder : null
    )
    const activeFolderInfo = $derived(folders.find((item) => item.id === activeFolder))
    let editingFolder = $state<string | null>(null)
    // On touch screens the chips stick right under the header, so they need its height.
    let headerHeight = $state(0)

    const shown = $derived(sortWorks(
        filterWorks(filterByFolder(works, DBState.db.characterOrder, activeFolder), { query, tag: activeTag }),
        easyPrefs.homeSort,
    ))
    const searching = $derived(query.trim().length > 0 || activeTag !== null)

    // Only the first cards are drawn; more are drawn as the end of the grid comes into view.
    let limit = $state(LIST_PAGE)
    const drawn = $derived(shown.slice(0, limit))
    $effect(() => {
        // A new search, tag, folder or order starts from the top again.
        void query; void activeTag; void activeFolder; void easyPrefs.homeSort
        untrack(() => { limit = LIST_PAGE })
    })

    function selectFolder(value: string | null) {
        easyView.homeFolder = value
    }

    async function addFolder() {
        const name = await alertInput('새 폴더 이름')
        if (typeof name !== 'string' || !name.trim()) return
        if (folderNameProblem(DBState.db, name) === 'taken') {
            alertNormal('같은 이름의 폴더가 이미 있어요.')
            return
        }
        const id = createFolder(DBState.db, name)
        if (!id) return
        easyView.homeFolder = id
        // Straight to choosing what goes in it.
        editingFolder = id
    }

    const sorts: { value: EasyWorkSort; label: string }[] = [
        { value: 'recent', label: '최근 대화' },
        { value: 'new', label: '새로 추가' },
        { value: 'name', label: '이름순' },
    ]

    function setSort(value: EasyWorkSort) {
        easyPrefs.homeSort = value
        saveEasyPrefs()
    }

    function openWork(work: EasyWork) {
        onOpenWork(work.chaId)
    }
</script>

<div class="h-full w-full overflow-y-auto overscroll-contain" data-easy-home>
    <header class="easy-top sticky top-0 z-10 bg-bgcolor/95 backdrop-blur-sm" bind:clientHeight={headerHeight}>
        <div class="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
            <h1 class="text-lg font-bold tracking-tight">작품</h1>
            <button type="button" class="flex h-10 w-10 items-center justify-center rounded-full text-textcolor2 hover:bg-selected hover:text-textcolor" aria-label="기존 화면으로" title="기존 화면으로" data-easy-open-classic onclick={() => setEasyModeEnabled(false)}>
                <HouseIcon size={20} />
            </button>
            <span class="flex-1"></span>
            <button type="button" class="flex h-10 items-center gap-1 rounded-full bg-primary px-3 text-sm font-semibold text-accenttext hover:opacity-90" onclick={onAddWork}>
                <PlusIcon size={18} />
                <span>작품 추가</span>
            </button>
            <button type="button" class="flex h-10 w-10 items-center justify-center rounded-full hover:bg-selected" aria-label="간편 모드 설정" onclick={onOpenSettings}>
                <SettingsIcon size={20} />
            </button>
        </div>
        <div class="mx-auto max-w-6xl px-4 pb-3">
            <label class="flex h-11 items-center gap-2 rounded-full border border-darkborderc bg-darkbg px-4 focus-within:border-borderc">
                <SearchIcon size={18} class="shrink-0 text-textcolor2" />
                <input
                    class="min-w-0 flex-1 bg-transparent text-sm text-textcolor outline-hidden placeholder:text-textcolor2"
                    placeholder="작품 이름, 태그, 제작자 검색"
                    bind:value={query}
                    type="search"
                    autocomplete="off"
                />
                {#if query}
                    <button type="button" class="text-textcolor2 hover:text-textcolor" aria-label="검색어 지우기" onclick={() => { query = '' }}>
                        <XIcon size={16} />
                    </button>
                {/if}
            </label>
        </div>
    </header>

    <!-- Folder and tag chips. The rows wrap onto as many lines as they need and scroll away
         with the page. On touch screens each row is one line to swipe and stays under the header. -->
    <div class="easy-filters bg-bgcolor/95 backdrop-blur-sm" style:top="{headerHeight}px" data-easy-filters>
        <div class="mx-auto max-w-6xl px-4 pb-3">
            <div class="easy-chip-row no-scrollbar -mx-4 flex gap-2 px-4" role="group" aria-label="폴더" data-easy-folders>
                <!-- First, so it is always in reach however many folders follow. -->
                <button type="button" class="easy-chip easy-chip--add" data-easy-folder-add onclick={addFolder}>
                    <FolderPlusIcon size={14} class="-mt-0.5 mr-1 inline" />새 폴더
                </button>
                {#if folders.length}
                    <button type="button" class="easy-chip" class:is-active={activeFolder === null} data-easy-folder="*" onclick={() => selectFolder(null)}>모든 폴더</button>
                    {#each folders as item (item.id)}
                        <button type="button" class="easy-chip" class:is-active={activeFolder === item.id} data-easy-folder={item.id} onclick={() => selectFolder(activeFolder === item.id ? null : item.id)}>
                            <FolderIcon size={14} class="-mt-0.5 mr-1 inline" />{item.name} <span class="opacity-70">{item.count}</span>
                        </button>
                    {/each}
                    {#if withoutFolder > 0}
                        <button type="button" class="easy-chip" class:is-active={activeFolder === NO_FOLDER} data-easy-folder="" onclick={() => selectFolder(activeFolder === NO_FOLDER ? null : NO_FOLDER)}>
                            폴더 없음 <span class="opacity-70">{withoutFolder}</span>
                        </button>
                    {/if}
                {/if}
            </div>
            {#if tags.length}
                <div class="easy-chip-row no-scrollbar -mx-4 mt-3 flex gap-2 px-4" role="group" aria-label="태그" data-easy-tags>
                    <button type="button" class="easy-chip" class:is-active={activeTag === null} onclick={() => { activeTag = null }}>전체</button>
                    {#each tags as item (item.tag)}
                        <button type="button" class="easy-chip" class:is-active={activeTag === item.tag} onclick={() => { activeTag = activeTag === item.tag ? null : item.tag }}>
                            #{item.tag}
                        </button>
                    {/each}
                </div>
            {/if}
        </div>
    </div>

    <main class="mx-auto max-w-6xl px-4 pb-16">
        {#if !searching && activeFolder === null && recent.length}
            <section class="mt-5" aria-labelledby="easy-recent-title">
                <h2 id="easy-recent-title" class="mb-3 text-base font-bold">이어서 대화하기</h2>
                <div class="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
                    {#each recent as work (work.chaId)}
                        <button type="button" class="flex w-64 shrink-0 items-center gap-3 rounded-xl border border-darkborderc bg-darkbg p-2.5 text-start hover:border-borderc" onclick={() => onContinue(work.chaId)}>
                            <EasyImage src={work.image} alt="" fallback={work.name} className="h-14 w-14 shrink-0 rounded-lg object-cover text-xl" />
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-sm font-semibold">{work.name}</span>
                                <span class="block truncate text-xs text-textcolor2">{formatPreviewTime(work.lastInteraction)}{work.subtitle ? ` · ${work.subtitle}` : ''}</span>
                            </span>
                        </button>
                    {/each}
                </div>
            </section>
        {/if}

        <section class="mt-6" aria-labelledby="easy-all-title">
            <div class="mb-3 flex items-center gap-2">
                <h2 id="easy-all-title" class="min-w-0 flex-1 truncate text-base font-bold">
                    {searching ? '검색 결과' : activeFolderInfo ? activeFolderInfo.name : activeFolder === NO_FOLDER ? '폴더 없음' : '전체 작품'}
                    <span class="ml-1 text-sm font-normal text-textcolor2">{shown.length}</span>
                </h2>
                {#if activeFolderInfo}
                    <button type="button" class="flex h-8 shrink-0 items-center gap-1 rounded-full border border-darkborderc bg-darkbg px-2.5 text-xs hover:border-borderc sm:px-3" aria-label="폴더 편집" title="폴더 편집" data-easy-folder-edit onclick={() => { editingFolder = activeFolderInfo.id }}>
                        <PencilIcon size={13} /><span class="hidden sm:inline">폴더 편집</span>
                    </button>
                {/if}
                <div class="flex rounded-full bg-darkbg p-0.5 text-xs" role="radiogroup" aria-label="정렬">
                    {#each sorts as item (item.value)}
                        <button type="button" role="radio" aria-checked={easyPrefs.homeSort === item.value} class="rounded-full px-2.5 py-1" class:bg-selected={easyPrefs.homeSort === item.value} class:text-textcolor={easyPrefs.homeSort === item.value} class:text-textcolor2={easyPrefs.homeSort !== item.value} onclick={() => setSort(item.value)}>
                            {item.label}
                        </button>
                    {/each}
                </div>
            </div>

            {#if shown.length}
                <div class="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {#each drawn as work (work.chaId)}
                        <EasyWorkCard {work} onOpen={openWork} />
                    {/each}
                </div>
                {#if drawn.length < shown.length}
                    {#key limit}
                        <div class="py-6 text-center text-xs text-textcolor2" data-easy-more use:onVisible={() => { limit = nextLimit(limit, shown.length) }}>
                            {shown.length}개 중 {drawn.length}개 표시
                        </div>
                    {/key}
                {/if}
            {:else if works.length && activeFolderInfo && !searching}
                <div class="flex flex-col items-center gap-3 py-16 text-center">
                    <p class="text-sm text-textcolor2">이 폴더에는 아직 작품이 없어요.</p>
                    <button type="button" class="flex h-10 items-center gap-1 rounded-full border border-darkborderc bg-darkbg px-4 text-sm hover:border-borderc" onclick={() => { editingFolder = activeFolderInfo.id }}>
                        <PlusIcon size={16} />작품 넣기
                    </button>
                </div>
            {:else if works.length}
                <p class="py-16 text-center text-sm text-textcolor2">조건에 맞는 작품이 없어요.</p>
            {:else}
                <div class="flex flex-col items-center gap-3 py-20 text-center">
                    <p class="text-base font-semibold">아직 작품이 없어요</p>
                    <p class="text-sm text-textcolor2">RisuAI 캐릭터 카드(.charx, .png, .json)를 가져오거나 새로 만들어 보세요.</p>
                    <button type="button" class="mt-2 flex h-11 items-center gap-1 rounded-full bg-primary px-5 text-sm font-semibold text-accenttext" onclick={onAddWork}>
                        <PlusIcon size={18} />
                        작품 추가
                    </button>
                </div>
            {/if}
        </section>
    </main>
</div>

{#if editingFolder}
    <EasySheet title="폴더 편집" onClose={() => { editingFolder = null }}>
        <EasyFolderEditor folderId={editingFolder} onDeleted={() => { editingFolder = null; easyView.homeFolder = null }} />
    </EasySheet>
{/if}

<style>
    .easy-chip {
        flex-shrink: 0;
        border: 1px solid var(--color-darkborderc);
        border-radius: 999px;
        padding: 0.35rem 0.85rem;
        font-size: 0.8125rem;
        color: var(--color-textcolor2);
        background: var(--color-darkbg);
        white-space: nowrap;
    }
    .easy-chip:hover {
        border-color: var(--color-borderc);
    }
    .easy-chip.is-active {
        background: var(--color-primary);
        border-color: var(--color-primary);
        color: var(--color-accenttext);
    }
    .easy-chip--add {
        border-style: dashed;
        background: transparent;
    }
    /* Chips wrap by default, so every folder and tag can be reached with any kind of pointer,
       and they scroll away with the page: only the title and the search box stay on top. */
    .easy-top {
        border-bottom: 1px solid var(--color-darkborderc);
    }
    .easy-filters {
        padding-top: 0.75rem;
    }
    .easy-chip-row {
        flex-wrap: wrap;
    }
    /* A finger can swipe a row sideways. There each row is a single line, and the rows stay
       under the header while the page scrolls. */
    @media (hover: none) and (pointer: coarse) {
        .easy-top {
            border-bottom: 0;
        }
        .easy-filters {
            position: sticky;
            z-index: 9;
            padding-top: 0;
            border-bottom: 1px solid var(--color-darkborderc);
        }
        .easy-chip-row {
            flex-wrap: nowrap;
            overflow-x: auto;
        }
    }
    .no-scrollbar {
        scrollbar-width: none;
    }
    .no-scrollbar::-webkit-scrollbar {
        display: none;
    }
</style>
