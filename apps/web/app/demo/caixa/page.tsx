import { demoCash } from '@/lib/demo/data';
import { formatDemoBRL } from '@/lib/demo/format';
import { Badge, BadgeTone } from '@/components/ds/Badge';
import { Card, CardHeader } from '@/components/ds/Card';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { StatCard } from '@/components/ds/StatCard';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';

const MOVEMENT_LABEL: Record<string, string> = {
  ABERTURA: 'Abertura',
  VENDA: 'Venda (dinheiro)',
  SUPRIMENTO: 'Suprimento',
  SANGRIA: 'Sangria',
};

const MOVEMENT_TONE: Record<string, BadgeTone> = {
  ABERTURA: 'neutral',
  VENDA: 'success',
  SUPRIMENTO: 'info',
  SANGRIA: 'danger',
};

export default function DemoCaixaPage() {
  const isBalanced = demoCash.differenceCents === 0;

  return (
    <Page>
      <PageHeader
        title="Caixa"
        description="Sessão do dia — abertura, movimentos e fechamento."
        actions={
          <Badge tone="success" dot>
            Caixa aberto
          </Badge>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Saldo inicial" value={formatDemoBRL(demoCash.openingBalanceCents)} />
        <StatCard label="Vendas em dinheiro" value={formatDemoBRL(demoCash.cashSalesCents)} tone="success" />
        <StatCard label="Suprimentos" value={formatDemoBRL(demoCash.suppliesCents)} tone="info" />
        <StatCard label="Sangrias" value={formatDemoBRL(demoCash.withdrawalsCents)} tone="danger" />
        <StatCard label="Saldo esperado" value={formatDemoBRL(demoCash.expectedBalanceCents)} featured />
        <StatCard label="Valor contado" value={formatDemoBRL(demoCash.countedBalanceCents)} featured />
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">Diferença de caixa</p>
          <Badge tone={isBalanced ? 'success' : 'danger'} dot>
            {isBalanced ? 'Sem diferença' : 'Divergente'}
          </Badge>
        </div>
        <p className={`mt-1.5 text-2xl font-semibold ${isBalanced ? 'text-success' : 'text-danger'}`}>
          {formatDemoBRL(demoCash.differenceCents)}
        </p>
        <p className="mt-1 text-xs text-subtle">
          Esperado e diferença são sempre calculados a partir dos movimentos — nunca informados manualmente, mesma
          regra do caixa real.
        </p>
      </Card>

      <Card>
        <CardHeader title="Movimentações" />
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <Th>Hora</Th>
                <Th>Tipo</Th>
                <Th>Descrição</Th>
                <Th className="text-right">Valor</Th>
              </tr>
            </THead>
            <TBody>
              {demoCash.movements.map((movement, i) => (
                <Tr key={i}>
                  <Td className="text-muted-foreground">{movement.time}</Td>
                  <Td>
                    <Badge tone={MOVEMENT_TONE[movement.type]}>{MOVEMENT_LABEL[movement.type]}</Badge>
                  </Td>
                  <Td className="text-muted-foreground">{movement.note}</Td>
                  <Td
                    className={`text-right font-semibold ${movement.amountCents < 0 ? 'text-danger' : 'text-foreground'}`}
                  >
                    {movement.amountCents < 0 ? '−' : '+'}
                    {formatDemoBRL(Math.abs(movement.amountCents))}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>
    </Page>
  );
}
