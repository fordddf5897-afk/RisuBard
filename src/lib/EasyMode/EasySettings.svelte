<script lang="ts">
    import { ArchiveRestoreIcon, CheckIcon, ChevronRightIcon, DownloadIcon, ImageIcon, LayoutPanelLeftIcon, SettingsIcon, SparklesIcon, UploadIcon } from '@lucide/svelte'
    import { DBState, OtherBotsSubmenuIndex } from 'src/ts/stores.svelte'
    import { easyPrefs, saveEasyPrefs, setEasyModeEnabled } from 'src/ts/easyMode/state.svelte'
    import { importAppSkinFile, installAppSkinFromText, isAppSkinSuppressed, listAppSkins, selectAppSkin } from 'src/ts/gui/appSkinRuntime'
    import { appSkinSwatch, defaultAppSkinSwatch } from 'src/ts/gui/appSkinSwatch'
    import { openSettings, SettingsRoute } from 'src/ts/routing'
    import gardenSkin from 'src/ts/easyMode/gardenSkin.json'
    import ShSwitch from '../UI/GUI/ShSwitch.svelte'

    const skins = $derived(listAppSkins(DBState.db))
    const activeSkin = $derived(DBState.db.appSkinId ?? '')
    const gardenInstalled = $derived(skins.some((entry) => entry.skin.id === gardenSkin.id))
    const defaultSwatch = $derived(defaultAppSkinSwatch(DBState.db.colorScheme))
    const suppressed = isAppSkinSuppressed()

    const everyOptions = [1, 2, 3, 5, 10]

    async function installGarden() {
        const skin = await installAppSkinFromText(JSON.stringify(gardenSkin))
        if (skin) selectAppSkin(skin.id)
    }

    function setEvery(value: number) {
        easyPrefs.illustrateEvery = value
        saveEasyPrefs()
    }

    function setAuto(value: boolean) {
        easyPrefs.autoIllustrate = value
        saveEasyPrefs()
    }

    function openImageSettings() {
        openSettings(SettingsRoute.OtherBots)
        OtherBotsSubmenuIndex.set(3)
    }
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-8 p-4 pb-12">
    <section aria-labelledby="easy-full-title">
        <h3 id="easy-full-title" class="text-base font-bold">전체 설정</h3>
        <p class="mt-1 text-sm text-textcolor2">AI 연결(모델·API 키), 기존 리스 데이터 가져오기 같은 설정은 RisuBard 전체 설정에 있어요. 닫으면 간편 모드로 돌아와요.</p>
        <div class="mt-3 flex flex-col overflow-hidden rounded-xl border border-darkborderc bg-darkbg">
            <button type="button" class="easy-link" data-easy-open-ai onclick={() => openSettings(SettingsRoute.ModelPreset)}>
                <SparklesIcon size={18} class="shrink-0 text-textcolor2" />
                <span class="min-w-0 flex-1">AI 연결 · 모델 · API 키</span>
                <ChevronRightIcon size={16} class="shrink-0 text-textcolor2" />
            </button>
            <button type="button" class="easy-link" data-easy-open-migration onclick={() => openSettings(SettingsRoute.Migration)}>
                <ArchiveRestoreIcon size={18} class="shrink-0 text-textcolor2" />
                <span class="min-w-0 flex-1">기존 리스 데이터 가져오기 (.bin 백업)</span>
                <ChevronRightIcon size={16} class="shrink-0 text-textcolor2" />
            </button>
            <button type="button" class="easy-link" data-easy-open-settings onclick={() => openSettings(SettingsRoute.None)}>
                <SettingsIcon size={18} class="shrink-0 text-textcolor2" />
                <span class="min-w-0 flex-1">전체 설정 열기</span>
                <ChevronRightIcon size={16} class="shrink-0 text-textcolor2" />
            </button>
        </div>
    </section>

    <section aria-labelledby="easy-skin-title">
        <h3 id="easy-skin-title" class="text-base font-bold">앱 스킨</h3>
        <p class="mt-1 text-sm text-textcolor2">스킨은 간편 모드와 기존 화면에 똑같이 적용돼요. .risuskin 파일도 가져올 수 있어요.</p>
        {#if suppressed}
            <p class="mt-2 rounded-lg bg-warning-bg px-3 py-2 text-sm text-on-warning">안전 모드(?safeskin)라 스킨이 꺼져 있어요.</p>
        {/if}
        <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <button type="button" class="easy-skin" class:is-active={!activeSkin} onclick={() => selectAppSkin('')}>
                <span class="easy-swatch" style:background={defaultSwatch.ground} style:border-color={defaultSwatch.border}>
                    <span style:background={defaultSwatch.surface}></span>
                    <span style:background={defaultSwatch.accent}></span>
                </span>
                <span class="flex items-center gap-1 text-sm">{#if !activeSkin}<CheckIcon size={14} />{/if}기본</span>
            </button>
            {#each skins as entry (entry.skin.id)}
                {@const swatch = appSkinSwatch(entry.skin)}
                <button type="button" class="easy-skin" class:is-active={activeSkin === entry.skin.id} onclick={() => selectAppSkin(entry.skin.id)}>
                    <span class="easy-swatch" style:background={swatch.ground} style:border-color={swatch.border}>
                        <span style:background={swatch.surface}></span>
                        <span style:background={swatch.accent}></span>
                    </span>
                    <span class="flex min-w-0 items-center gap-1 text-sm">
                        {#if activeSkin === entry.skin.id}<CheckIcon size={14} class="shrink-0" />{/if}
                        <span class="truncate">{entry.skin.name}</span>
                    </span>
                </button>
            {/each}
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
            {#if !gardenInstalled}
                <button type="button" class="easy-action" onclick={installGarden}><DownloadIcon size={16} />'정원' 스킨 설치</button>
            {/if}
            <button type="button" class="easy-action" onclick={() => importAppSkinFile()}><UploadIcon size={16} />스킨 파일 가져오기</button>
        </div>
    </section>

    <section aria-labelledby="easy-illust-title">
        <h3 id="easy-illust-title" class="text-base font-bold">자동 삽화 (NovelAI)</h3>
        <p class="mt-1 text-sm text-textcolor2">
            AI 답변이 끝나면 바드 페인터가 보조 모델로 장면 프롬프트를 쓰고, NovelAI로 그려서 답변 아래에 넣어요.
            그림체·인물 외형은 바드 페인터 설정을 그대로 따라요. 그릴 때마다 Anlas가 들어요.
        </p>
        <div class="mt-3 flex items-center gap-3 rounded-xl border border-darkborderc bg-darkbg p-3">
            <ImageIcon size={18} class="shrink-0 text-textcolor2" />
            <span class="flex-1 text-sm">자동 삽화 켜기</span>
            <ShSwitch checked={easyPrefs.autoIllustrate} ariaLabel="자동 삽화 켜기" onCheckedChange={setAuto} />
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span class="text-textcolor2">그리는 간격</span>
            {#each everyOptions as value (value)}
                <button type="button" class="rounded-full border px-3 py-1" class:border-primary={easyPrefs.illustrateEvery === value} class:bg-selected={easyPrefs.illustrateEvery === value} class:border-darkborderc={easyPrefs.illustrateEvery !== value} onclick={() => setEvery(value)}>
                    {value === 1 ? '매 답변' : `답변 ${value}개마다`}
                </button>
            {/each}
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-2">
            <span class="text-sm" class:text-success={!!DBState.db.NAIApiKey?.trim()} class:text-draculared={!DBState.db.NAIApiKey?.trim()}>
                {DBState.db.NAIApiKey?.trim() ? 'NovelAI 키 등록됨' : 'NovelAI 키 없음'}
            </span>
            <button type="button" class="easy-action" onclick={openImageSettings}><SettingsIcon size={16} />이미지 생성 설정 열기</button>
        </div>
    </section>

    <section aria-labelledby="easy-mode-title">
        <h3 id="easy-mode-title" class="text-base font-bold">화면</h3>
        <p class="mt-1 text-sm text-textcolor2">
            기존 RisuBard 화면으로 돌아가도 데이터는 같아요. 기존 화면의 사이드바 메뉴나 설정 화면의 '간편 모드로 전환'으로 다시 올 수 있어요.
            주소 끝에 <code>?classic</code>을 붙이면 이번만 기존 화면으로 열려요.
        </p>
        <button type="button" class="easy-action mt-3" onclick={() => setEasyModeEnabled(false)}><LayoutPanelLeftIcon size={16} />기존 화면으로 전환</button>
    </section>
</div>

<style>
    .easy-skin {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.5rem;
        border: 1px solid var(--color-darkborderc);
        border-radius: var(--risu-radius-xl);
        background: var(--color-darkbg);
        text-align: start;
    }
    .easy-skin.is-active {
        border-color: var(--color-primary);
    }
    .easy-swatch {
        display: flex;
        gap: 0.35rem;
        align-items: flex-end;
        height: 3rem;
        padding: 0.4rem;
        border: 1px solid;
        border-radius: var(--risu-radius-lg);
    }
    .easy-swatch > span:first-child {
        flex: 1;
        height: 100%;
        border-radius: var(--risu-radius-md);
    }
    .easy-swatch > span:last-child {
        width: 1.25rem;
        height: 1.25rem;
        border-radius: 999px;
    }
    .easy-action {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        min-height: 2.25rem;
        padding: 0.35rem 0.85rem;
        border: 1px solid var(--color-darkborderc);
        border-radius: 999px;
        font-size: 0.85rem;
        background: var(--color-darkbg);
    }
    .easy-action:hover {
        border-color: var(--color-borderc);
    }
    .easy-link {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-height: 3rem;
        padding: 0.6rem 0.9rem;
        text-align: start;
        font-size: 0.9rem;
    }
    .easy-link + .easy-link {
        border-top: 1px solid var(--color-darkborderc);
    }
    .easy-link:hover {
        background: var(--color-selected);
    }
</style>
