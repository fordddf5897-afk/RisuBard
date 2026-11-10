<script lang="ts">
    // The classic character editor (CharConfig) with tabs, inside an easy-mode sheet.
    // Lorebook includes the Grimoire retrieval settings.
    import CharConfig from '../SideBars/CharConfig.svelte'

    interface Props {
        tab: number
    }

    let { tab = $bindable(0) }: Props = $props()

    // Tab values are CharConfig's sub-menu numbers.
    const editorTabs: { value: number; label: string }[] = [
        { value: 0, label: '기본 정보' },
        { value: 1, label: '이미지 · 에셋' },
        { value: 3, label: '로어북 · Grimoire' },
        { value: 4, label: '스크립트' },
        { value: 5, label: 'TTS' },
        { value: 6, label: '공유' },
        { value: 2, label: '고급' },
    ]
</script>

<div class="flex h-full flex-col">
    <div class="flex shrink-0 gap-1 overflow-x-auto border-b border-darkborderc px-2 py-2" role="tablist" aria-label="작품 설정">
        {#each editorTabs as item (item.value)}
            <button
                type="button"
                role="tab"
                aria-selected={tab === item.value}
                class="shrink-0 rounded-full px-3 py-1.5 text-sm"
                class:bg-primary={tab === item.value}
                class:text-accenttext={tab === item.value}
                class:text-textcolor2={tab !== item.value}
                onclick={() => { tab = item.value }}
            >
                {item.label}
            </button>
        {/each}
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto p-4" data-easy-editor>
        {#key tab}
            <CharConfig subMenuOverride={tab} />
        {/key}
    </div>
</div>
