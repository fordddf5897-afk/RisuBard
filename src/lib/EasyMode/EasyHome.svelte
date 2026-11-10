<script lang="ts">
    import { PlusIcon, SearchIcon, SettingsIcon, XIcon } from '@lucide/svelte'
    import { DBState } from 'src/ts/stores.svelte'
    import { filterWorks, listWorks, popularTags, recentlyPlayed, sortWorks, type EasyWork, type EasyWorkSort } from 'src/ts/easyMode/works'
    import { easyPrefs, saveEasyPrefs } from 'src/ts/easyMode/state.svelte'
    import { formatPreviewTime } from 'src/ts/risubard/chatPreviewText'
    import EasyWorkCard from './EasyWorkCard.svelte'
    import EasyImage from './EasyImage.svelte'

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
    const shown = $derived(sortWorks(filterWorks(works, { query, tag: activeTag }), easyPrefs.homeSort))
    const searching = $derived(query.trim().length > 0 || activeTag !== null)

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
    <header class="sticky top-0 z-10 border-b border-darkborderc bg-bgcolor/95 backdrop-blur-sm">
        <div class="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
            <h1 class="flex-1 text-lg font-bold tracking-tight">작품</h1>
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
            {#if tags.length}
                <div class="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4" role="group" aria-label="태그">
                    <button type="button" class="easy-chip" class:is-active={activeTag === null} onclick={() => { activeTag = null }}>전체</button>
                    {#each tags as item (item.tag)}
                        <button type="button" class="easy-chip" class:is-active={activeTag === item.tag} onclick={() => { activeTag = activeTag === item.tag ? null : item.tag }}>
                            #{item.tag}
                        </button>
                    {/each}
                </div>
            {/if}
        </div>
    </header>

    <main class="mx-auto max-w-6xl px-4 pb-16">
        {#if !searching && recent.length}
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
                <h2 id="easy-all-title" class="flex-1 text-base font-bold">
                    {searching ? '검색 결과' : '전체 작품'}
                    <span class="ml-1 text-sm font-normal text-textcolor2">{shown.length}</span>
                </h2>
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
                    {#each shown as work (work.chaId)}
                        <EasyWorkCard {work} onOpen={openWork} />
                    {/each}
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
    .no-scrollbar {
        scrollbar-width: none;
    }
    .no-scrollbar::-webkit-scrollbar {
        display: none;
    }
</style>
