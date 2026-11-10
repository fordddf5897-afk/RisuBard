<script lang="ts">
    import type { EasyWork } from 'src/ts/easyMode/works'
    import { formatPreviewTime } from 'src/ts/risubard/chatPreviewText'
    import EasyImage from './EasyImage.svelte'

    interface Props {
        work: EasyWork
        onOpen: (work: EasyWork) => void
    }

    let { work, onOpen }: Props = $props()
</script>

<button
    type="button"
    class="group flex min-w-0 flex-col text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary rounded-xl"
    data-easy-work-card={work.chaId}
    onclick={() => onOpen(work)}
>
    <div class="relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-darkborderc bg-darkbg">
        <EasyImage
            src={work.image}
            alt={work.name}
            fallback={work.name}
            className="h-full w-full object-cover text-4xl transition-transform duration-300 group-hover:scale-[1.03]"
        />
        {#if work.lastInteraction > 0}
            <span class="absolute bottom-2 left-2 rounded-full bg-darkbg/85 px-2 py-0.5 text-[11px] text-textcolor backdrop-blur-sm">
                {formatPreviewTime(work.lastInteraction)} 대화
            </span>
        {/if}
    </div>
    <div class="mt-2 min-w-0 px-0.5">
        <p class="truncate text-sm font-semibold text-textcolor">{work.name}</p>
        {#if work.subtitle}
            <p class="line-clamp-2 text-xs leading-snug text-textcolor2">{work.subtitle}</p>
        {/if}
        {#if work.tags.length}
            <div class="mt-1 flex flex-wrap gap-1 overflow-hidden" style:max-height="1.4rem">
                {#each work.tags.slice(0, 3) as tag (tag)}
                    <span class="truncate rounded-full bg-darkbutton px-1.5 text-[11px] leading-5 text-textcolor2">#{tag}</span>
                {/each}
            </div>
        {/if}
    </div>
</button>
