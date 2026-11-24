// Calls back when the element comes near the visible part of the page. Lists
// put it after the rows drawn so far and draw the next page when it fires.
// Wrap the element in `{#key drawnCount}` so a fresh one is watched after each
// page: an element that stays in view does not fire twice.
export function onVisible(node: HTMLElement, callback: () => void) {
    let current = callback
    if (typeof IntersectionObserver === 'undefined') {
        current()
        return { update(next: () => void) { current = next } }
    }
    const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) current()
    }, { rootMargin: '800px 0px' })
    observer.observe(node)
    return {
        update(next: () => void) { current = next },
        destroy() { observer.disconnect() },
    }
}

/** How many rows to draw first, and how many more each time the end comes into view. */
export const LIST_PAGE = 60

/** The next amount to draw: one more page, never past the end. */
export function nextLimit(limit: number, total: number, page: number = LIST_PAGE): number {
    return Math.min(Math.max(total, 0), Math.max(limit, 0) + page)
}
