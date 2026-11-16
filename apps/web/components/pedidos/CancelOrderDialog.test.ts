import { act, createElement as h } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { CancelOrderDialog } from './CancelOrderDialog';

// B5: the cancellation dialog never cancels by itself. Plain react-dom, no JSX: Jest here only
// picks up *.test.ts.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function render(props: { onClose: () => void; onConfirm: (reason: string) => Promise<boolean> }) {
  act(() => {
    root.render(
      h(CancelOrderDialog, {
        open: true,
        orderNumber: 'ABC-123',
        effects: ['Estornar no caixa o valor recebido em dinheiro (o caixa precisa estar aberto).', 'O cancelamento não pode ser desfeito.'],
        ...props,
      }),
    );
  });
}

const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

function typeReason(text: string) {
  const area = container.querySelector('#cancel-reason') as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(area, text);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('CancelOrderDialog (B5)', () => {
  it('shows the question, the order number and what the cancellation undoes', () => {
    render({ onClose: jest.fn(), onConfirm: jest.fn() });
    const text = container.textContent ?? '';
    expect(text).toContain('Tem certeza que deseja cancelar este pedido?');
    expect(text).toContain('Pedido #ABC-123');
    expect(text).toContain('Estornar no caixa');
    expect(text).toContain('não pode ser desfeito');
    expect(text).toContain('Motivo do cancelamento');
  });

  it('keeps "Confirmar cancelamento" off without a reason or with spaces only', () => {
    const onConfirm = jest.fn();
    render({ onClose: jest.fn(), onConfirm });
    expect(button('Confirmar cancelamento').disabled).toBe(true);
    typeReason('     ');
    expect(button('Confirmar cancelamento').disabled).toBe(true);
    act(() => button('Confirmar cancelamento').click());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Esc closes without cancelling', () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();
    render({ onClose, onConfirm });
    typeReason('Cliente desistiu');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('"Voltar" closes without cancelling', () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();
    render({ onClose, onConfirm });
    typeReason('Cliente desistiu');
    act(() => button('Voltar').click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('sends ONE request with the trimmed reason, however many times the button is pressed', async () => {
    let finish: (value: boolean) => void = () => undefined;
    const onConfirm = jest.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const onClose = jest.fn();
    render({ onClose, onConfirm });
    typeReason('  Pedido lançado em duplicidade  ');
    await act(async () => {
      button('Confirmar cancelamento').click();
      button('Confirmar cancelamento').click();
      button('Confirmar cancelamento').click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('Pedido lançado em duplicidade');
    await act(async () => finish(true));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
