/** Shows a small message in a corner. Safe to call from anywhere; ToastHost (in the root component) draws it. */
export function toast(text: string): void {
  window.dispatchEvent(new CustomEvent('app-toast', { detail: { text } }));
}
