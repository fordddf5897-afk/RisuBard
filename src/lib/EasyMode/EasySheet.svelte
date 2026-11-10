<script lang="ts">
    // Full-screen panel on phones, a centered panel on wide screens. Hosts classic
    // editors (character settings, chat list) and easy-mode settings.
    import type { Snippet } from 'svelte'
    import { XIcon } from '@lucide/svelte'

    interface Props {
        title: string
        onClose: () => void
        children: Snippet
        header?: Snippet
        wide?: boolean
    }

    let { title, onClose, children, header, wide = false }: Props = $props()

    function onKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') onClose()
    }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="fixed inset-0 z-40 flex items-stretch justify-center bg-overlay/60 md:items-center md:p-6" role="presentation" data-easy-sheet>
    <button type="button" class="absolute inset-0 hidden cursor-default md:block" aria-label="닫기" onclick={onClose}></button>
    <div
        class="relative flex h-full w-full flex-col overflow-hidden bg-bgcolor text-textcolor md:h-[min(56rem,92vh)] md:rounded-2xl md:border md:border-darkborderc md:shadow-xl"
        class:md:max-w-3xl={!wide}
        class:md:max-w-5xl={wide}
        role="dialog"
        aria-modal="true"
        aria-label={title}
    >
        <header class="flex h-14 shrink-0 items-center gap-2 border-b border-darkborderc px-3">
            <button type="button" class="flex h-10 w-10 items-center justify-center rounded-full hover:bg-selected" aria-label="닫기" onclick={onClose}>
                <XIcon size={20} />
            </button>
            <h2 class="min-w-0 flex-1 truncate text-base font-semibold">{title}</h2>
        </header>
        {#if header}
            <div class="shrink-0 border-b border-darkborderc">{@render header()}</div>
        {/if}
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {@render children()}
        </div>
    </div>
</div>
