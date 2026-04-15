import React, { useRef } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { useFocusTrap } from '../useFocusTrap';

// ─── Test harness ─────────────────────────────────────────────────────
//
// A minimal component that wraps useFocusTrap around 3 buttons. The
// `active` prop toggles the trap so cleanup-path tests can watch focus
// restoration.

interface HarnessProps {
  active?: boolean;
  onEscape?: () => void;
}

const ThreeButtons: React.FC<HarnessProps> = ({ active = true, onEscape = jest.fn() }) => {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onEscape, active);
  return (
    <div ref={ref}>
      <button type="button">first</button>
      <button type="button">second</button>
      <button type="button">third</button>
    </div>
  );
};

describe('useFocusTrap', () => {
  test('moves focus to first focusable on activate', () => {
    const { getByText } = render(<ThreeButtons />);
    expect(document.activeElement).toBe(getByText('first'));
  });

  test('Tab from last wraps to first', () => {
    const { getByText } = render(<ThreeButtons />);
    const third = getByText('third') as HTMLButtonElement;
    third.focus();
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(getByText('first'));
  });

  test('Shift+Tab from first wraps to last', () => {
    const { getByText } = render(<ThreeButtons />);
    const first = getByText('first') as HTMLButtonElement;
    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(getByText('third'));
  });

  test('Escape calls onEscape handler', () => {
    const onEscape = jest.fn();
    render(<ThreeButtons onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  test('cleanup restores focus to previously-focused element', () => {
    // Put a trigger button outside the trap, focus it, then mount the trap
    // and unmount it. Focus should return to the trigger.
    const trigger = document.createElement('button');
    trigger.textContent = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(<ThreeButtons />);
    // Trap moved focus into the popup
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    // Cleanup restored it
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });
});
