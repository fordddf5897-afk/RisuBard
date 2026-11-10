<script lang="ts">
    // Resolves a RisuAI asset path (character cover, persona icon) to a URL.
    import { getCharImage } from 'src/ts/characters'

    interface Props {
        src: string | undefined
        alt?: string
        /** Letter shown while loading or when there is no image. */
        fallback?: string
        className?: string
    }

    let { src, alt = '', fallback = '', className = '' }: Props = $props()
    let url = $state<string | null>(null)

    $effect(() => {
        const source = src
        url = null
        if (!source) return
        let alive = true
        getCharImage(source, 'plain').then((resolved) => {
            if (alive) url = resolved
        }).catch(() => {
            if (alive) url = null
        })
        return () => { alive = false }
    })
</script>

{#if url}
    <img src={url} {alt} class={className} loading="lazy" decoding="async" draggable="false" />
{:else}
    <div class="{className} flex items-center justify-center bg-selected text-textcolor2 font-semibold select-none" aria-hidden="true">
        <span>{fallback.slice(0, 1)}</span>
    </div>
{/if}
