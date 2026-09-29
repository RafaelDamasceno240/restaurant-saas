import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { AdminOrderListItem, FULFILLMENT_LABEL, ORDER_SOURCE_LABEL } from '@/lib/orders-api';
import { formatBRL, formatTime } from '@/lib/format';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { customerLabel, PAYMENT_LABEL } from './OrderCard';
import { SourceBadge, StatusBadge } from './StatusBadge';

// Dense table used by /dashboard/pedidos (full) and the dashboard's
// "Pedidos recentes" (compact: fewer columns).
export function OrdersTable({ orders, compact }: { orders: AdminOrderListItem[]; compact?: boolean }) {
  return (
    <TableWrap>
      <Table>
        <THead>
          <tr>
            <Th>Pedido</Th>
            <Th>Cliente</Th>
            {!compact && <Th>Tipo</Th>}
            {!compact && <Th>Pagamento</Th>}
            {!compact && <Th className="text-right">Itens</Th>}
            <Th>Hora</Th>
            <Th>Status</Th>
            <Th className="text-right">Total</Th>
            <Th className="w-8" />
          </tr>
        </THead>
        <TBody>
          {orders.map((order) => (
            <Tr key={order.id} className="group">
              <Td>
                <Link
                  href={`/dashboard/pedidos/${order.id}`}
                  className="flex items-center gap-2 font-semibold text-foreground hover:text-accent"
                >
                  #{order.orderNumber}
                  <SourceBadge source={order.source} label={ORDER_SOURCE_LABEL[order.source] ?? order.source} />
                </Link>
              </Td>
              <Td className="max-w-[12rem] truncate text-muted-foreground">{customerLabel(order)}</Td>
              {!compact && (
                <Td className="text-muted-foreground">{FULFILLMENT_LABEL[order.fulfillmentType] ?? order.fulfillmentType}</Td>
              )}
              {!compact && (
                <Td className="text-muted-foreground">{PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod}</Td>
              )}
              {!compact && <Td className="text-right text-muted-foreground">{order.itemCount}</Td>}
              <Td className="whitespace-nowrap text-muted-foreground">{formatTime(order.createdAt)}</Td>
              <Td>
                <StatusBadge status={order.status} />
              </Td>
              <Td className="whitespace-nowrap text-right font-semibold text-foreground">{formatBRL(order.total)}</Td>
              <Td className="pr-3">
                <Link
                  href={`/dashboard/pedidos/${order.id}`}
                  aria-label={`Abrir pedido ${order.orderNumber}`}
                  className="text-subtle transition-colors group-hover:text-foreground"
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  );
}
