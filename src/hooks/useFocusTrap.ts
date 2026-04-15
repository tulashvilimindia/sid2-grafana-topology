import { RefObject, useEffect } from 'react';

/**
 * useFocusTrap — trap keyboard focus inside a container, handle Escape,
 * and restore focus to the previously-focused element on cleanup.
 *
 * Usage:
 *   const containerRef = useRef<HTMLDivElement>(null);
 *   useFocusTrap(containerRef, onClose, isOpen);
 *   return <div ref={containerRef}>...</div>;
 *
 * Behavior when `active` is true:
 *   1. Save the currently-focused element.
 *   2. Move focus to the first focusable descendant of `ref.current`.
 *   3. Tab at the last focusable cycles back to the first.
 *   4. Shift+Tab at the first focusable cycles to the last.
 *   5. Escape calls onEscape().
 *   6. On cleanup (unmount or active=false), restore focus to the
 *      previously-focused element if it's still in the document.
 *
 * Hand-rolled instead of pulling in the `focus-trap` package — this
 * plugin already has zero runtime dependencies, and the focus-trap
 * surface we need is tiny. Adds ~40 LOC vs. an 8KB gzipped dep.
 */

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]';

export function useFocusTrap(
  ref: RefObject<HTMLElement>,
  onEscape: () => void,
  active: boolean
): void {
  useEffect(() => {
    if (!active || !ref.current) {
      return;
    }
    const container = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the container on activate
    const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusables.length > 0) {
      focusables[0].focus();
    }

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key !== 'Tab') {
        return;
      }
      // Re-query every Tab — focusables can change while the popup is open
      // (e.g. alert rows appearing after an async fetch).
      const items = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (items.length === 0) {
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      // Restore focus only if the previously-focused element is still
      // attached to the document. Otherwise (e.g. clicked node was
      // removed while the popup was open), leave focus where it is.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [ref, onEscape, active]);
}
