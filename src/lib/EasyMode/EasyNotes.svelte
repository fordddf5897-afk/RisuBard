<script lang="ts">
    // Creator notes as sanitized markdown. A language picker appears only when the
    // notes really contain several `# \`lang\`` sections.
    import { DBState } from 'src/ts/stores.svelte'
    import { parseMultilangString, toLangName } from 'src/ts/util'
    import { parseMarkdownSafe } from 'src/ts/parser/parser.svelte'

    interface Props {
        value: string
    }

    let { value }: Props = $props()

    const sections = $derived.by(() => {
        const parsed = parseMultilangString(value ?? '')
        const named = Object.entries(parsed).filter(([code, text]) => code !== 'xx' && text.trim())
        const plain = parsed.xx?.trim() ? [['xx', parsed.xx] as [string, string]] : []
        return named.length ? named : plain
    })
    const preferred = $derived(
        sections.find(([code]) => code === DBState.db.language)?.[0]
            ?? sections.find(([code]) => code === 'en')?.[0]
            ?? sections[0]?.[0]
            ?? 'xx'
    )
    let chosen = $state<string | null>(null)
    const active = $derived(sections.some(([code]) => code === chosen) ? chosen! : preferred)
    const html = $derived(parseMarkdownSafe(sections.find(([code]) => code === active)?.[1] ?? ''))
</script>

{#if sections.length > 1}
    <div class="mb-2 flex flex-wrap gap-1.5">
        {#each sections as [code] (code)}
            <button type="button" class="rounded-full border px-2.5 py-0.5 text-xs" class:border-primary={code === active} class:border-darkborderc={code !== active} onclick={() => { chosen = code }}>
                {toLangName(code)}
            </button>
        {/each}
    </div>
{/if}
<div class="easy-notes text-textcolor">
    {@html html}
</div>

<style>
    .easy-notes :global(p) {
        margin: 0 0 0.6em;
    }
    .easy-notes :global(ul),
    .easy-notes :global(ol) {
        margin: 0 0 0.6em;
        padding-inline-start: 1.25em;
    }
    .easy-notes :global(ul) {
        list-style: disc;
    }
    .easy-notes :global(ol) {
        list-style: decimal;
    }
    .easy-notes :global(img) {
        max-width: 100%;
        height: auto;
        border-radius: var(--risu-radius-lg);
    }
</style>
