<script lang="ts">
    // 방주: 챗봇 사이트 프롬으로 작품을 만들고 고치는 화면(K2).
    // 칸의 구성은 에덴챗을 따르고, 루나톡의 '매 응답 규칙', 그림 번호, 로어북 항목(순서·최소/최대 턴)을 더했다.
    // 적은 내용은 siteWork.ts의 규칙으로 RisuAI 봇의 칸에 옮겨지고, 원문은 봇 안에 같이 남는다.
    import { ArrowDownIcon, ArrowUpIcon, ImagePlusIcon, PlusIcon, StarIcon, Trash2Icon } from '@lucide/svelte'
    import { DBState } from 'src/ts/stores.svelte'
    import { alertConfirm, alertNormal, notifyError } from 'src/ts/alert'
    import {
        convertSiteWork, emptyLore, emptySiteWork, newId, readSiteWork, splitKeys,
        WORLD_HEADING, characterHeading, type SiteAsset, type SiteLore, type SiteWork,
    } from 'src/ts/easyMode/siteWork'
    import { applySiteWork, createSiteWork, saveSiteImage, SITE_IMAGE_TYPES } from 'src/ts/easyMode/siteWorkApply'
    import EasyImage from './EasyImage.svelte'

    interface Props {
        /** '' makes a new work; otherwise the site-based work to edit. */
        chaId: string
        onSaved: (chaId: string) => void
    }

    let { chaId, onSaved }: Props = $props()

    // The shell re-creates this screen for each work (it is keyed by the work), so the first value is the one meant.
    // svelte-ignore state_referenced_locally
    const existing = chaId ? DBState.db.characters.find((item) => item?.chaId === chaId) : null
    let work = $state<SiteWork>((existing && readSiteWork(existing)) || emptySiteWork())
    let uploading = $state(0)
    let dragging = $state(false)
    let saving = $state(false)

    type Tab = 'intro' | 'world' | 'characters' | 'assets' | 'starts' | 'lore' | 'rule' | 'result'
    const tabs: { value: Tab; label: string }[] = [
        { value: 'intro', label: '작품 소개' },
        { value: 'world', label: '상세 설정' },
        { value: 'characters', label: '캐릭터 설정' },
        { value: 'assets', label: '미디어 에셋' },
        { value: 'starts', label: '시작 상황' },
        { value: 'lore', label: '로어북' },
        { value: 'rule', label: '매 응답 규칙' },
        { value: 'result', label: '변환 결과' },
    ]
    let tab = $state<Tab>('intro')

    const converted = $derived(convertSiteWork(work))
    const accept = SITE_IMAGE_TYPES.map((type) => `.${type}`).join(',')

    function images(files: FileList | File[] | null | undefined): File[] {
        return [...(files ?? [])].filter((file) => SITE_IMAGE_TYPES.includes((file.name.split('.').pop() ?? '').toLowerCase()))
    }

    // Pictures are stored one at a time with the app's own asset store, in the order they were given.
    async function store(files: File[], each: (saved: { path: string; ext: string; fileName: string }) => void) {
        for (const file of files) {
            uploading += 1
            try {
                each(await saveSiteImage(file))
            } catch (cause) {
                notifyError(cause)
            } finally {
                uploading -= 1
            }
        }
    }

    function nextCode(): string {
        const used = new Set(work.assets.map((asset) => asset.code.trim()))
        let number = work.assets.length + 1
        while (used.has(String(number))) number += 1
        return String(number)
    }

    async function addAssets(files: FileList | File[] | null | undefined) {
        const picked = images(files)
        if (!picked.length) {
            if (files && [...files].length) alertNormal('올릴 수 있는 그림은 PNG · JPG · GIF · WEBP입니다.')
            return
        }
        await store(picked, (saved) => {
            work.assets.push({ id: newId(), code: nextCode(), path: saved.path, ext: saved.ext, description: '', fileName: saved.fileName })
        })
    }

    // The app itself imports any file dropped on its window as a bot card. Inside this screen a dropped
    // picture is a picture for this work, so the drop is kept from reaching the app.
    function onDrop(event: DragEvent) {
        event.preventDefault()
        event.stopPropagation()
        dragging = false
        void addAssets(event.dataTransfer?.files)
    }

    // A drop that misses the picture box does nothing (it must not import a card behind this screen).
    function swallowDrop(event: DragEvent) {
        event.preventDefault()
        event.stopPropagation()
        dragging = false
    }

    function moveAsset(at: number, by: number) {
        const to = at + by
        if (to < 0 || to >= work.assets.length) return
        const [moved] = work.assets.splice(at, 1)
        work.assets.splice(to, 0, moved)
    }

    function fillDescriptions() {
        for (const asset of work.assets) {
            if (!asset.description.trim()) asset.description = asset.fileName.replace(/\.[^.]+$/, '')
        }
    }

    async function setCover(files: FileList | null) {
        await store(images(files).slice(0, 1), (saved) => { work.cover = saved.path })
    }

    async function setCharacterImage(id: string, files: FileList | null) {
        await store(images(files).slice(0, 1), (saved) => {
            const target = work.characters.find((item) => item.id === id)
            if (target) { target.image = saved.path; target.imageExt = saved.ext }
        })
    }

    function makeMain(at: number) {
        const [start] = work.starts.splice(at, 1)
        work.starts.unshift(start)
    }

    const keys = (entry: SiteLore, field: 'onKeys' | 'offKeys', input: string) => { entry[field] = splitKeys(input) }
    const number = (input: string): number | null => {
        const value = Number.parseInt(input, 10)
        return Number.isFinite(value) && value >= 0 ? value : null
    }
    const assetNumber = (asset: SiteAsset) => work.assets.indexOf(asset) + 1

    async function save() {
        if (saving) return
        if (uploading > 0) { alertNormal('그림을 올리는 중입니다. 끝난 뒤에 눌러 주세요.'); return }
        if (!work.title.trim()) { tab = 'intro'; alertNormal('작품 제목을 적어 주세요.'); return }
        if (chaId && !await alertConfirm('이 화면의 내용으로 작품을 다시 만듭니다. 설명, 시작 상황, 응답 규칙, 태그와 이 화면에서 만든 로어북·그림 목록이 이 화면의 내용으로 바뀝니다. 다른 화면에서 따로 넣은 로어북과 그림은 그대로 둡니다. 계속할까요?')) return
        saving = true
        try {
            const snapshot = $state.snapshot(work) as SiteWork
            const savedId = chaId ? (applySiteWork(chaId, snapshot), chaId) : createSiteWork(snapshot).chaId
            onSaved(savedId)
        } catch (cause) {
            notifyError(cause)
        } finally {
            saving = false
        }
    }
</script>

<div class="flex h-full flex-col" data-site-editor role="presentation" ondragover={(event) => event.preventDefault()} ondrop={swallowDrop}>
    <div class="flex shrink-0 gap-1 overflow-x-auto border-b border-darkborderc px-2 py-2" role="tablist" aria-label="사이트 프롬으로 만들기">
        {#each tabs as item (item.value)}
            <button
                type="button"
                role="tab"
                aria-selected={tab === item.value}
                data-site-tab={item.value}
                class="shrink-0 rounded-full px-3 py-1.5 text-sm"
                class:bg-primary={tab === item.value}
                class:text-accenttext={tab === item.value}
                class:text-textcolor2={tab !== item.value}
                onclick={() => { tab = item.value }}
            >
                {item.label}{#if item.value === 'result' && converted.notes.length} ({converted.notes.length}){/if}
            </button>
        {/each}
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div class="mx-auto flex w-full max-w-3xl flex-col gap-5">
            {#if tab === 'intro'}
                <p class="site-help">사이트의 "작품 소개"와 같은 칸입니다. 여기 적은 것은 목록과 작품 화면에 보이고, 모델에는 들어가지 않습니다.</p>
                <div class="flex items-center gap-4">
                    <EasyImage src={work.cover} alt="작품 표지" fallback={work.title || '표'} className="h-24 w-24 shrink-0 rounded-xl object-cover" />
                    <div class="flex flex-col gap-2">
                        <label class="site-button">
                            <ImagePlusIcon size={16} /> 표지 고르기
                            <input type="file" class="hidden" {accept} data-site-cover onchange={(event) => { void setCover(event.currentTarget.files); event.currentTarget.value = '' }} />
                        </label>
                        {#if work.cover}
                            <button type="button" class="site-button" onclick={() => { work.cover = '' }}><Trash2Icon size={16} /> 표지 빼기</button>
                        {/if}
                        <span class="site-help">비워 두면 첫 캐릭터의 그림을 씁니다.</span>
                    </div>
                </div>
                <label class="site-field"><span>작품 제목 *</span><input class="site-input" data-site-field="title" bind:value={work.title} placeholder="작품 제목을 입력해 주세요" /></label>
                <label class="site-field"><span>작품 부제목</span><input class="site-input" data-site-field="subtitle" bind:value={work.subtitle} maxlength="60" placeholder="한 줄 소개" /></label>
                <label class="site-field"><span>작품 소개</span><textarea class="site-input min-h-28" data-site-field="intro" bind:value={work.intro} placeholder="작품의 배경, 스토리, 세계관 등을 소개해 주세요"></textarea></label>
                <label class="site-field"><span>크리에이터 코멘트</span><textarea class="site-input min-h-20" data-site-field="comment" bind:value={work.comment}></textarea></label>
                <label class="site-field"><span>장르</span><input class="site-input" data-site-field="genre" bind:value={work.genre} placeholder="예: 판타지/SF" /></label>
                <label class="site-field"><span>해시태그 (쉼표로 구분)</span><input class="site-input" data-site-field="tags" value={work.tags.join(', ')} onchange={(event) => { work.tags = splitKeys(event.currentTarget.value) }} placeholder="예: 도서관, 사서" /></label>
            {:else if tab === 'world'}
                <p class="site-help">에덴챗의 "상세 설정", 루나톡의 "배경 세계관"에 해당합니다. 배경, 스토리, 세계관을 적습니다. 적은 글자 그대로 모델에 들어갑니다.</p>
                <label class="site-field"><span>상세 설정</span><textarea class="site-input min-h-[24rem]" data-site-field="world" bind:value={work.world} placeholder="작품의 배경, 스토리, 세계관 등을 적어 주세요"></textarea></label>
                <span class="site-help text-right">{work.world.length.toLocaleString()}자</span>
            {:else if tab === 'characters'}
                <p class="site-help">캐릭터를 여러 명 넣을 수 있습니다. 캐릭터마다 그림 한 장, 이름, 상세 설정을 적습니다.</p>
                {#each work.characters as character, at (character.id)}
                    <section class="site-card" data-site-character>
                        <div class="flex items-start gap-3">
                            <EasyImage src={character.image} alt={character.name} fallback={character.name || String(at + 1)} className="h-20 w-20 shrink-0 rounded-xl object-cover" />
                            <div class="flex min-w-0 flex-1 flex-col gap-2">
                                <label class="site-field"><span>이름 *</span><input class="site-input" data-site-field="character-name" bind:value={character.name} placeholder="특수문자, 이모지 가능" /></label>
                                <div class="flex flex-wrap gap-2">
                                    <label class="site-button">
                                        <ImagePlusIcon size={16} /> 그림 고르기
                                        <input type="file" class="hidden" {accept} data-site-character-image onchange={(event) => { void setCharacterImage(character.id, event.currentTarget.files); event.currentTarget.value = '' }} />
                                    </label>
                                    {#if work.characters.length > 1}
                                        <button type="button" class="site-button" onclick={() => { work.characters.splice(at, 1) }}><Trash2Icon size={16} /> 이 캐릭터 빼기</button>
                                    {/if}
                                </div>
                            </div>
                        </div>
                        <label class="site-field"><span>상세 설정 *</span><textarea class="site-input min-h-40" data-site-field="character-detail" bind:value={character.detail} placeholder="캐릭터의 외모, 성격, 배경 스토리, 직업 등을 자유롭게 작성해 주세요"></textarea></label>
                    </section>
                {/each}
                <button type="button" class="site-button self-start" data-site-add-character onclick={() => { work.characters.push({ id: newId(), name: '', detail: '', image: '', imageExt: '' }) }}><PlusIcon size={16} /> 캐릭터 추가</button>
            {:else if tab === 'assets'}
                <p class="site-help">그림을 여러 장 끌어다 놓으면 올라가고, 올린 순서대로 번호가 붙습니다. 본문에서는 코드로 부릅니다(에덴챗의 이미지 코드, 루나톡의 그림 번호). 코드는 바꿀 수 있습니다.</p>
                <div
                    class="site-drop"
                    class:is-over={dragging}
                    role="group"
                    aria-label="그림 올리기"
                    data-site-drop
                    ondragover={(event) => { event.preventDefault(); dragging = true }}
                    ondragleave={() => { dragging = false }}
                    ondrop={onDrop}
                >
                    <ImagePlusIcon size={28} />
                    <span>그림 파일을 여기에 끌어다 놓으세요 (PNG · JPG · GIF · WEBP)</span>
                    <label class="site-button">
                        사진 고르기
                        <input type="file" class="hidden" multiple {accept} data-site-assets onchange={(event) => { void addAssets(event.currentTarget.files); event.currentTarget.value = '' }} />
                    </label>
                    {#if uploading > 0}<span class="site-help" data-site-uploading>올리는 중…</span>{/if}
                </div>
                {#if work.assets.length}
                    <div class="flex items-center justify-between gap-2">
                        <span class="site-help">그림 {work.assets.length}장</span>
                        <button type="button" class="site-button" onclick={fillDescriptions}>빈 설명을 파일 이름으로 채우기</button>
                    </div>
                {/if}
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {#each work.assets as asset, at (asset.id)}
                        <section class="site-card" data-site-asset>
                            <div class="flex items-start gap-3">
                                <EasyImage src={asset.path} alt={asset.description || asset.fileName} fallback={String(at + 1)} className="h-24 w-24 shrink-0 rounded-lg object-cover" />
                                <div class="flex min-w-0 flex-1 flex-col gap-2">
                                    <span class="site-help" data-site-asset-number>{assetNumber(asset)}번 · {asset.fileName}</span>
                                    <label class="site-field"><span>코드</span><input class="site-input" data-site-field="asset-code" bind:value={asset.code} /></label>
                                </div>
                            </div>
                            <label class="site-field"><span>설명 (인물 · 표정 · 상황)</span><input class="site-input" data-site-field="asset-description" bind:value={asset.description} /></label>
                            <div class="flex flex-wrap gap-2">
                                <button type="button" class="site-button" aria-label="앞으로" disabled={at === 0} onclick={() => moveAsset(at, -1)}><ArrowUpIcon size={16} /> 앞으로</button>
                                <button type="button" class="site-button" aria-label="뒤로" disabled={at === work.assets.length - 1} onclick={() => moveAsset(at, 1)}><ArrowDownIcon size={16} /> 뒤로</button>
                                <button type="button" class="site-button" data-site-remove-asset onclick={() => { work.assets.splice(at, 1) }}><Trash2Icon size={16} /> 빼기</button>
                            </div>
                        </section>
                    {/each}
                </div>
            {:else if tab === 'starts'}
                <p class="site-help">시작 상황을 여러 개 둘 수 있습니다. 맨 위가 대표이고, 채팅을 새로 시작할 때 기본으로 나옵니다. 보조 프롬프트는 그 시작 상황으로 시작한 채팅에만 들어갑니다.</p>
                {#each work.starts as start, at (start.id)}
                    <section class="site-card" data-site-start>
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-sm font-semibold">{at === 0 ? '대표 시작 상황' : `시작 상황 ${at + 1}`}</span>
                            {#if at > 0}
                                <button type="button" class="site-button" onclick={() => makeMain(at)}><StarIcon size={16} /> 대표로 지정</button>
                            {/if}
                            {#if work.starts.length > 1}
                                <button type="button" class="site-button" onclick={() => { work.starts.splice(at, 1) }}><Trash2Icon size={16} /> 빼기</button>
                            {/if}
                        </div>
                        <label class="site-field"><span>제목</span><input class="site-input" data-site-field="start-title" bind:value={start.title} placeholder="시작상황 제목을 입력해 주세요" /></label>
                        <label class="site-field"><span>설명</span><input class="site-input" data-site-field="start-description" bind:value={start.description} placeholder="시작상황에 대한 간단한 설명을 적어 주세요" /></label>
                        <label class="site-field"><span>상세 설정 (첫 메시지) *</span><textarea class="site-input min-h-48" data-site-field="start-body" bind:value={start.body} placeholder="채팅을 시작하면 처음 보이는 메시지"></textarea></label>
                        <label class="site-field"><span>보조 프롬프트</span><textarea class="site-input min-h-20" data-site-field="start-extra" bind:value={start.extra} placeholder="이 시작 상황으로 대화를 시작했을 때에만 항상 들어가는 프롬프트"></textarea></label>
                    </section>
                {/each}
                <button type="button" class="site-button self-start" data-site-add-start onclick={() => { work.starts.push({ id: newId(), title: '', description: '', body: '', extra: '' }) }}><PlusIcon size={16} /> 시작 상황 추가</button>
            {:else if tab === 'lore'}
                <p class="site-help">키워드가 대화에 나오면 그 내용을 모델에 알려 줍니다. "항상"으로 두면 늘 알려 줍니다. 키워드는 쉼표로 나눠 적습니다.</p>
                {#each work.lore as entry, at (entry.id)}
                    <section class="site-card" data-site-lore>
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <span class="text-sm font-semibold">로어북 {at + 1}</span>
                            <button type="button" class="site-button" onclick={() => { work.lore.splice(at, 1) }}><Trash2Icon size={16} /> 빼기</button>
                        </div>
                        <label class="site-field"><span>이름 *</span><input class="site-input" data-site-field="lore-name" bind:value={entry.name} placeholder="로어북 이름을 입력해 주세요" /></label>
                        <label class="site-field"><span>내용 *</span><textarea class="site-input min-h-32" data-site-field="lore-content" bind:value={entry.content}></textarea></label>
                        <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="언제 캐릭터에게 알려줄까요?">
                            <button type="button" role="radio" aria-checked={!entry.always} class="site-choice" class:is-on={!entry.always} onclick={() => { entry.always = false }}>특정 키워드가 나올 때</button>
                            <button type="button" role="radio" aria-checked={entry.always} class="site-choice" class:is-on={entry.always} data-site-lore-always onclick={() => { entry.always = true }}>항상</button>
                        </div>
                        {#if !entry.always}
                            <label class="site-field"><span>켜는 키워드 *</span><input class="site-input" data-site-field="lore-on" value={entry.onKeys.join(', ')} onchange={(event) => keys(entry, 'onKeys', event.currentTarget.value)} placeholder="예: 마법, 세계관, 역사" /></label>
                            <label class="site-field"><span>끄는 키워드 (켜는 키워드보다 힘이 셉니다)</span><input class="site-input" data-site-field="lore-off" value={entry.offKeys.join(', ')} onchange={(event) => keys(entry, 'offKeys', event.currentTarget.value)} placeholder="예: 전투, 싸움" /></label>
                            <label class="site-field"><span>최근 몇 턴 안에서 키워드를 찾을까요 (비우면 앱 설정대로)</span><input class="site-input" type="number" min="1" data-site-field="lore-turns" value={entry.turns ?? ''} onchange={(event) => { entry.turns = number(event.currentTarget.value) }} placeholder="에덴챗 기본 5" /></label>
                        {/if}
                        <details>
                            <summary class="cursor-pointer text-sm text-textcolor2">루나톡 항목 (순서 · 최소 턴 · 최대 턴)</summary>
                            <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                                <label class="site-field"><span>순서 (낮을수록 우선)</span><input class="site-input" type="number" min="1" data-site-field="lore-order" value={entry.order ?? ''} onchange={(event) => { entry.order = number(event.currentTarget.value) }} /></label>
                                <label class="site-field"><span>최소 턴</span><input class="site-input" type="number" min="0" data-site-field="lore-min" value={entry.minTurn ?? ''} onchange={(event) => { entry.minTurn = number(event.currentTarget.value) }} /></label>
                                <label class="site-field"><span>최대 턴</span><input class="site-input" type="number" min="0" data-site-field="lore-max" value={entry.maxTurn ?? ''} onchange={(event) => { entry.maxTurn = number(event.currentTarget.value) }} /></label>
                            </div>
                        </details>
                    </section>
                {/each}
                <button type="button" class="site-button self-start" data-site-add-lore onclick={() => { work.lore.push(emptyLore()) }}><PlusIcon size={16} /> 로어북 항목 추가</button>
            {:else if tab === 'rule'}
                <p class="site-help">루나톡의 "매 응답에 적용할 규칙"입니다. 상태창, 수치, 턴 종료 로직처럼 답할 때마다 지켜야 하는 것을 적습니다. 에덴챗에는 이 칸이 없으니, 에덴챗 프롬에서 그런 부분을 떼어 여기에 적으면 됩니다.</p>
                <label class="site-field"><span>매 응답 규칙</span><textarea class="site-input min-h-[20rem]" data-site-field="rule" bind:value={work.rule} placeholder="매 응답시 AI가 지켜야 할 규칙이나 기믹(상태창 등)"></textarea></label>
            {:else}
                <p class="site-help">저장하면 봇에 이렇게 들어갑니다. 모델에 들어가는 글은 적은 그대로이고, 방주가 붙이는 것은 설명 칸의 구분용 제목 <code>{WORLD_HEADING}</code>, <code>{characterHeading('이름')}</code> 두 가지와 로어북 맨 위의 <code>@@</code> 표시 줄뿐입니다.</p>
                {#if converted.notes.length}
                    <section class="site-card" data-site-notes>
                        <span class="text-sm font-semibold">옮기지 못했거나 확인할 것 {converted.notes.length}개</span>
                        <ul class="list-disc pl-5 text-sm">
                            {#each converted.notes as note (note)}<li>{note}</li>{/each}
                        </ul>
                    </section>
                {/if}
                <section class="site-card"><span class="text-sm font-semibold">이름</span><pre class="site-pre" data-site-result="name">{converted.name}</pre></section>
                <section class="site-card"><span class="text-sm font-semibold">설명 (모델에 들어감)</span><pre class="site-pre" data-site-result="desc">{converted.desc || '(비어 있음)'}</pre></section>
                <section class="site-card"><span class="text-sm font-semibold">첫 메시지 {converted.alternateGreetings.length ? `외 ${converted.alternateGreetings.length}개` : ''}</span><pre class="site-pre" data-site-result="first">{converted.firstMessage || '(비어 있음)'}</pre></section>
                <section class="site-card"><span class="text-sm font-semibold">매 응답 규칙 (모델에 들어감 · 모든 채팅에서 답할 때마다 맨 끝에)</span><pre class="site-pre" data-site-result="rule">{converted.rule || '(비어 있음)'}</pre></section>
                <section class="site-card">
                    <span class="text-sm font-semibold">로어북 {converted.lore.length}개</span>
                    {#each converted.lore as entry, at (at)}
                        <div class="text-sm">
                            <span class="font-semibold">{entry.comment || '이름 없음'}</span>
                            <span class="text-textcolor2"> · {entry.alwaysActive ? '항상' : `키워드: ${entry.key || '없음'}`}</span>
                        </div>
                        <pre class="site-pre" data-site-result="lore">{entry.content}</pre>
                    {/each}
                </section>
                <section class="site-card"><span class="text-sm font-semibold">그림 {converted.assets.length}장</span><pre class="site-pre" data-site-result="assets">{converted.assets.map(([name]) => name).join(', ') || '(없음)'}</pre></section>
            {/if}
        </div>
    </div>

    <div class="flex shrink-0 items-center justify-between gap-3 border-t border-darkborderc px-4 py-3">
        <span class="site-help min-w-0 truncate">{chaId ? '저장하면 작품에 반영됩니다.' : '만들면 작품 목록에 생깁니다.'}</span>
        <button type="button" class="shrink-0 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-accenttext disabled:opacity-50" data-site-save disabled={saving || uploading > 0} onclick={save}>
            {chaId ? '저장' : '만들기'}
        </button>
    </div>
</div>

<style>
    .site-help {
        font-size: 0.8125rem;
        color: var(--color-textcolor2);
    }
    .site-field {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        font-size: 0.875rem;
    }
    .site-field > span {
        color: var(--color-textcolor2);
    }
    .site-input {
        width: 100%;
        border-radius: var(--risu-radius-md);
        border: 1px solid var(--color-darkborderc);
        background: var(--color-darkbg);
        padding: 0.55rem 0.75rem;
        color: var(--color-textcolor);
        font-size: 0.9375rem;
    }
    textarea.site-input {
        resize: vertical;
        line-height: 1.5;
    }
    .site-card {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        border-radius: var(--risu-radius-lg);
        border: 1px solid var(--color-darkborderc);
        padding: 0.9rem;
    }
    .site-button {
        display: inline-flex;
        min-height: 2.25rem;
        cursor: pointer;
        align-items: center;
        gap: 0.4rem;
        border-radius: 9999px;
        border: 1px solid var(--color-darkborderc);
        background: var(--color-darkbg);
        padding: 0 0.9rem;
        font-size: 0.875rem;
    }
    .site-button:disabled {
        opacity: 0.45;
        cursor: default;
    }
    .site-choice {
        min-height: 2.25rem;
        border-radius: 9999px;
        border: 1px solid var(--color-darkborderc);
        padding: 0 0.9rem;
        font-size: 0.875rem;
        color: var(--color-textcolor2);
    }
    .site-choice.is-on {
        border-color: var(--color-primary);
        color: var(--color-textcolor);
        font-weight: 600;
    }
    .site-drop {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.6rem;
        border-radius: var(--risu-radius-lg);
        border: 2px dashed var(--color-darkborderc);
        padding: 1.5rem 1rem;
        text-align: center;
        font-size: 0.875rem;
        color: var(--color-textcolor2);
    }
    .site-drop.is-over {
        border-color: var(--color-primary);
        background: var(--color-selected);
    }
    .site-pre {
        max-height: 18rem;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        border-radius: var(--risu-radius-md);
        background: var(--color-darkbg);
        padding: 0.6rem 0.75rem;
        font-size: 0.8125rem;
        line-height: 1.5;
    }
</style>
