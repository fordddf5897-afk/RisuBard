<script lang="ts">
    // One folder: its name, which works are in it, and deleting it. Every change is
    // written to RisuAI's own folder list at once, so there is nothing to save on close.
    import { CheckIcon, SearchIcon, Trash2Icon, XIcon } from '@lucide/svelte'
    import { DBState } from 'src/ts/stores.svelte'
    import { alertConfirm, alertNormal } from 'src/ts/alert'
    import { listWorks, matchesQuery, sortWorks } from 'src/ts/easyMode/works'
    import { NO_FOLDER, deleteFolder, folderNameProblem, folderOfWorks, listFolders, moveWorkToFolder, renameFolder } from 'src/ts/easyMode/folders'
    import { LIST_PAGE, nextLimit, onVisible } from 'src/ts/easyMode/visible'

    interface Props {
        folderId: string
        onDeleted: () => void
    }

    let { folderId, onDeleted }: Props = $props()

    const works = $derived(listWorks(DBState.db.characters))
    const folders = $derived(listFolders(DBState.db.characterOrder, works))
    const folder = $derived(folders.find((item) => item.id === folderId))
    const where = $derived(folderOfWorks(DBState.db.characterOrder))
    const folderNames = $derived(new Map(folders.map((item) => [item.id, item.name])))

    let query = $state('')
    let onlyInside = $state(false)
    let limit = $state(LIST_PAGE)
    let name = $state('')
    let nameLoadedFor = ''

    $effect(() => {
        // Fill the name box once per folder; typing must not be overwritten by the list refreshing.
        if (folder && nameLoadedFor !== folder.id) {
            nameLoadedFor = folder.id
            name = folder.name
        }
    })

    // Works of this folder first, then the rest by name.
    const rows = $derived.by(() => {
        const matching = sortWorks(works.filter((work) => matchesQuery(work, query)), 'name')
        const inside = matching.filter((work) => where.get(work.chaId) === folderId)
        return onlyInside ? inside : [...inside, ...matching.filter((work) => where.get(work.chaId) !== folderId)]
    })
    const drawn = $derived(rows.slice(0, limit))

    function resetList() {
        limit = LIST_PAGE
    }

    const nameProblem = $derived(folder && name.trim() !== folder.name ? folderNameProblem(DBState.db, name, folderId) : null)
    const nameChanged = $derived(!!folder && name.trim() !== folder.name)

    function saveName() {
        if (!folder || !nameChanged || nameProblem) return
        renameFolder(DBState.db, folderId, name)
    }

    function toggle(chaId: string, inside: boolean) {
        moveWorkToFolder(DBState.db, chaId, inside ? NO_FOLDER : folderId)
    }

    async function remove() {
        if (!folder) return
        const confirmed = await alertConfirm(`'${folder.name}' 폴더를 지울까요?\n작품 ${folder.count}개는 지워지지 않고 폴더 밖으로 나옵니다.`)
        if (!confirmed) return
        if (deleteFolder(DBState.db, folderId)) onDeleted()
        else alertNormal('폴더를 찾을 수 없어요.')
    }
</script>

{#if !folder}
    <p class="p-6 text-center text-sm text-textcolor2">폴더를 찾을 수 없어요.</p>
{:else}
    <div class="mx-auto flex max-w-2xl flex-col gap-6 p-4 pb-12" data-easy-folder-editor={folderId}>
        <section aria-labelledby="easy-folder-name-title">
            <h3 id="easy-folder-name-title" class="text-base font-bold">폴더 이름</h3>
            <div class="mt-2 flex gap-2">
                <input
                    class="h-11 min-w-0 flex-1 rounded-xl border border-darkborderc bg-darkbg px-3 text-sm text-textcolor outline-hidden focus:border-borderc"
                    bind:value={name}
                    maxlength="60"
                    aria-label="폴더 이름"
                    data-easy-folder-name
                    onkeydown={(event) => { if (event.key === 'Enter') saveName() }}
                />
                <button type="button" class="h-11 shrink-0 rounded-xl border border-darkborderc bg-darkbg px-4 text-sm font-semibold disabled:opacity-40" disabled={!nameChanged || !!nameProblem} data-easy-folder-rename onclick={saveName}>
                    이름 바꾸기
                </button>
            </div>
            {#if nameProblem === 'taken'}
                <p class="mt-1 text-xs text-draculared">같은 이름의 폴더가 이미 있어요.</p>
            {:else if nameProblem === 'empty'}
                <p class="mt-1 text-xs text-draculared">이름을 적어 주세요.</p>
            {/if}
        </section>

        <section aria-labelledby="easy-folder-works-title">
            <h3 id="easy-folder-works-title" class="text-base font-bold">
                이 폴더의 작품 <span class="text-sm font-normal text-textcolor2">{folder.count}</span>
            </h3>
            <p class="mt-1 text-sm text-textcolor2">작품을 누르면 폴더에 넣거나 뺍니다. 누르는 즉시 적용돼요. 다른 폴더에 있던 작품은 이 폴더로 옮겨집니다.</p>
            <label class="mt-3 flex h-11 items-center gap-2 rounded-full border border-darkborderc bg-darkbg px-4 focus-within:border-borderc">
                <SearchIcon size={18} class="shrink-0 text-textcolor2" />
                <input
                    class="min-w-0 flex-1 bg-transparent text-sm text-textcolor outline-hidden placeholder:text-textcolor2"
                    placeholder="작품 이름, 태그, 제작자 검색"
                    bind:value={query}
                    oninput={resetList}
                    type="search"
                    autocomplete="off"
                    data-easy-folder-search
                />
                {#if query}
                    <button type="button" class="text-textcolor2 hover:text-textcolor" aria-label="검색어 지우기" onclick={() => { query = ''; resetList() }}>
                        <XIcon size={16} />
                    </button>
                {/if}
            </label>
            <label class="mt-2 flex items-center gap-2 text-sm text-textcolor2">
                <input type="checkbox" bind:checked={onlyInside} onchange={resetList} />
                이 폴더에 있는 작품만 보기
            </label>

            <div class="mt-3 flex flex-col overflow-hidden rounded-xl border border-darkborderc bg-darkbg">
                {#each drawn as work (work.chaId)}
                    {@const inside = where.get(work.chaId) === folderId}
                    {@const other = !inside && where.has(work.chaId) ? folderNames.get(where.get(work.chaId) ?? '') : ''}
                    <button type="button" role="checkbox" aria-checked={inside} class="easy-folder-row" data-easy-folder-work={work.chaId} onclick={() => toggle(work.chaId, inside)}>
                        <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border" class:border-primary={inside} class:bg-primary={inside} class:text-accenttext={inside} class:border-darkborderc={!inside}>
                            {#if inside}<CheckIcon size={13} />{/if}
                        </span>
                        <span class="min-w-0 flex-1">
                            <span class="block truncate text-sm">{work.name}</span>
                            {#if other}
                                <span class="block truncate text-xs text-textcolor2">지금은 '{other}' 폴더</span>
                            {/if}
                        </span>
                    </button>
                {:else}
                    <p class="p-6 text-center text-sm text-textcolor2">{works.length ? '조건에 맞는 작품이 없어요.' : '아직 작품이 없어요.'}</p>
                {/each}
                {#if drawn.length < rows.length}
                    {#key limit}
                        <div class="p-3 text-center text-xs text-textcolor2" use:onVisible={() => { limit = nextLimit(limit, rows.length) }}>
                            {rows.length}개 중 {drawn.length}개 표시
                        </div>
                    {/key}
                {/if}
            </div>
        </section>

        <section aria-labelledby="easy-folder-delete-title">
            <h3 id="easy-folder-delete-title" class="text-base font-bold">폴더 지우기</h3>
            <p class="mt-1 text-sm text-textcolor2">폴더만 지워져요. 안에 있던 작품은 지워지지 않고 폴더 밖으로 나옵니다.</p>
            <button type="button" class="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-darkborderc bg-darkbg px-3.5 text-sm text-draculared hover:border-borderc" data-easy-folder-delete onclick={remove}>
                <Trash2Icon size={16} />
                이 폴더 지우기
            </button>
        </section>
    </div>
{/if}

<style>
    /* The box has its own clear button; the browser's second one is hidden. */
    input[type='search']::-webkit-search-cancel-button {
        display: none;
    }
    .easy-folder-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-height: 3rem;
        padding: 0.5rem 0.9rem;
        text-align: start;
    }
    .easy-folder-row + .easy-folder-row {
        border-top: 1px solid var(--color-darkborderc);
    }
    .easy-folder-row:hover {
        background: var(--color-selected);
    }
</style>
