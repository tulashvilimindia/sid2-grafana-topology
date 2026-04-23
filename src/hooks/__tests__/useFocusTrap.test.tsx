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

  test('active=false is a no-op: does not grab focus, does not trap Tab', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'outside';
    document.body.appendChild(trigger);
    trigger.focus();
    const onEscape = jest.fn();
    render(<ThreeButtons active={false} onEscape={onEscape} />);
    // Focus unchanged.
    expect(document.activeElement).toBe(trigger);
    // Escape must not fire the handler when inactive.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).not.toHaveBeenCalled();
    document.body.removeChild(trigger);
  });

  test('container with zero focusables renders without crashing', () => {
    const EmptyTrap: React.FC = () => {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, jest.fn(), true);
      return <div ref={ref}><span>no focusables here</span></div>;
    };
    // No crash when handleKey runs on Tab with zero items.
    expect(() => {
      render(<EmptyTrap />);
      fireEvent.keyDown(document, { key: 'Tab' });
    }).not.toThrow();
  });

  test('Tab re-queries focusables — a dynamically-added button becomes the wrap anchor', () => {
    // The hook re-queries focusables on every Tab so focus cycles include
    // any nodes added after mount (e.g., alert rows appearing inside a
    // popup after an async fetch). Without the re-query, Tab from the
    // newly-last element would not wrap to the first.
    const DynamicTrap: React.FC = () => {
      const ref = useRef<HTMLDivElement>(null);
      const [extra, setExtra] = React.useState(false);
      useFocusTrap(ref, jest.fn(), true);
      return (
        <div ref={ref}>
          <button type="button">first</button>
          <button type="button" onClick={() => setExtra(true)}>add</button>
          {extra && <button type="button">dynamic</button>}
        </div>
      );
    };
    render(<DynamicTrap />);
    // Click 'add' — the new 'dynamic' button is now the last focusable.
    const addBtn = document.querySelectorAll('button')[1] as HTMLButtonElement;
    fireEvent.click(addBtn);
    const dynamicBtn = document.querySelectorAll('button')[2] as HTMLButtonElement;
    dynamicBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    // Without re-query, the hook would think 'add' is still the last and
    // skip wrapping. With re-query, Tab from 'dynamic' wraps to 'first'.
    expect(document.activeElement?.textContent).toBe('first');
  });
});
