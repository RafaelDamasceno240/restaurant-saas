import { act, createElement as h, Fragment, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Dialog } from './Dialog';

// Regression: every form inside a Dialog lost focus after the first key. Callers pass onClose
// inline, so each keystroke handed the Dialog a new function and re-ran its open/close effect,
// which moved the focus to the trigger and then to the panel. Plain react-dom, no JSX: Jest here
// only picks up *.test.ts.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The form keeps its state in the component that renders the Dialog, as MenuAdmin and the
// restaurant profile do, and closes with an inline arrow that reads that state.
function Form({
  autoFocus,
  field = true,
  onClosed,
}: {
  autoFocus?: boolean;
  field?: boolean;
  onClosed: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  return h(
    Fragment,
    null,
    h('button', { type: 'button', id: 'trigger', onClick: () => setOpen(true) }, 'Novo produto'),
    h(Dialog, {
      open,
      title: 'Novo produto',
      onClose: () => {
        onClosed(name);
        setOpen(false);
      },
      children:
        field &&
        h('input', {
          id: 'name',
          autoFocus,
          value: name,
          onChange: (e) => setName(e.target.value),
        }),
    }),
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

function render(props: Parameters<typeof Form>[0]) {
  act(() => root.render(h(Form, props)));
}

// The way a person opens it: the button has the focus, then the click.
function openFromTrigger() {
  const trigger = byId<HTMLButtonElement>('trigger')!;
  trigger.focus();
  act(() => trigger.click());
  return trigger;
}

// One key the way the browser delivers it: keydown, the new value with an input event, keyup.
function typeKey(input: HTMLInputElement, char: string) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    setNativeValue.call(input, input.value + char);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
  });
}

function pressEscape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

describe('Dialog', () => {
  it('keeps the focus in the field after every key, and Esc gives it back to the trigger', () => {
    const onClosed = jest.fn();
    render({ onClosed });
    const trigger = openFromTrigger();
    const input = byId<HTMLInputElement>('name')!;
    input.focus();
    expect(document.activeElement).toBe(input);

    for (const char of 'Teste') {
      typeKey(input, char);
      expect(document.activeElement).toBe(input);
      expect(byId('name')).toBe(input);
    }
    expect(input.value).toBe('Teste');

    pressEscape();
    expect(document.querySelector('[role=dialog]')).toBeNull();
    // Esc runs the onClose of the latest render, not the one from when the dialog opened.
    expect(onClosed).toHaveBeenCalledWith('Teste');
    expect(document.activeElement).toBe(trigger);
  });

  it('leaves a field with autoFocus focused when it opens, and still returns the focus on close', () => {
    render({ autoFocus: true, onClosed: jest.fn() });
    const trigger = openFromTrigger();
    const input = byId<HTMLInputElement>('name')!;
    expect(document.activeElement).toBe(input);

    for (const char of 'Teste') {
      typeKey(input, char);
      expect(document.activeElement).toBe(input);
    }
    expect(input.value).toBe('Teste');

    pressEscape();
    expect(document.activeElement).toBe(trigger);
  });

  it('focuses the panel when nothing inside took the focus', () => {
    render({ field: false, onClosed: jest.fn() });
    openFromTrigger();
    expect(document.activeElement).toBe(document.querySelector('[role=dialog]'));
  });

  it('closes on a backdrop click and returns the focus to the trigger', () => {
    const onClosed = jest.fn();
    render({ onClosed });
    const trigger = openFromTrigger();
    const backdrop = document.querySelector('[role=dialog]')!.previousElementSibling as HTMLElement;
    act(() => backdrop.click());
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
