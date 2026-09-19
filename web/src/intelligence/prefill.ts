/**
 * A question handed to Intelligence in its link (`/intelligence?q=…`), such as
 * "Ask SPROUT Intelligence about NVIDIA" in the stock guide. It only fills in
 * the question box; nothing is sent until the parent sends it.
 */
export const PREFILL_MAX = 2500;

export function prefillQuestion(search: string = typeof window === 'undefined' ? '' : window.location.search): string {
  try {
    return (new URLSearchParams(search).get('q') ?? '').trim().slice(0, PREFILL_MAX);
  } catch {
    return '';
  }
}
