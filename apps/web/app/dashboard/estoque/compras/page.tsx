import Link from 'next/link';
import { FileText, ShoppingBag, Truck, Users } from 'lucide-react';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';

const UPCOMING = [
  { icon: Users, title: 'Fornecedores', description: 'Cadastro com contatos, prazos e condições de pagamento.' },
  { icon: ShoppingBag, title: 'Pedidos de compra', description: 'Sugestão de compra pelo estoque mínimo e máximo.' },
  { icon: FileText, title: 'Notas de entrada', description: 'Recebimento conferido item a item, com lote e validade.' },
  { icon: Truck, title: 'Recebimento', description: 'Entrada automática no estoque ao confirmar a nota.' },
];

export default function ComprasPage() {
  return (
    <div className="space-y-4">
      <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <ShoppingBag className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="text-lg font-semibold text-foreground">Controle de compras será disponibilizado em breve.</h2>
        <p className="max-w-xl text-sm text-muted-foreground">
          Enquanto isso, registre as compras como <span className="text-foreground">Nova entrada</span> informando fornecedor e número do
          documento: elas ficam marcadas com a origem <span className="text-foreground">Compra</span> no histórico.
        </p>
        <Link href="/dashboard/estoque/movimentacoes?origin=PURCHASE">
          <Button variant="outline">Ver entradas de compra</Button>
        </Link>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {UPCOMING.map(({ icon: Icon, title, description }) => (
          <Card key={title} className="p-4 opacity-80">
            <div className="flex items-center justify-between">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-hover text-muted-foreground">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="rounded bg-surface-hover px-1.5 py-px text-2xs font-semibold uppercase tracking-wide text-subtle">
                Em breve
              </span>
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">{title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
