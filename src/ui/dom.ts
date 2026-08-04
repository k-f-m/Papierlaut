/**
 * Element lookups fail loudly at start-up rather than producing `null`
 * dereferences later: the markup and the controller are one unit, and a missing
 * id is a bug in the build, not a runtime condition to handle.
 */
export function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

export function setHidden(target: HTMLElement, hidden: boolean): void {
  target.toggleAttribute('hidden', hidden);
}

/** True when a keystroke belongs to a control the user is typing or dragging in. */
export function isEditingContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'SELECT', 'TEXTAREA', 'OPTION'].includes(target.tagName);
}
