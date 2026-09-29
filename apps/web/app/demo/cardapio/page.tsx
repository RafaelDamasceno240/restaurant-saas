'use client';

import { useState } from 'react';
import { demoCategories, demoProducts } from '@/lib/demo/data';
import { formatDemoBRL } from '@/lib/demo/format';
import { Badge } from '@/components/ds/Badge';
import { Card } from '@/components/ds/Card';
import { SearchInput, Select } from '@/components/ds/Input';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { EmptyState } from '@/components/ds/States';
import { BookOpen } from 'lucide-react';

export default function DemoCardapioPage() {
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();

  const sections = demoCategories
    .filter((c) => !categoryId || c.id === categoryId)
    .map((category) => {
      const all = demoProducts.filter((p) => p.categoryId === category.id);
      const shown = term ? all.filter((p) => p.name.toLowerCase().includes(term)) : all;
      return { category, all, shown };
    })
    .filter((s) => !term || s.shown.length > 0);

  return (
    <Page>
      <PageHeader title="Cardápio" description="Gerencie categorias e produtos do seu cardápio" />

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[14rem] flex-1 sm:max-w-sm">
          <SearchInput
            placeholder="Buscar produto..."
            aria-label="Buscar produto"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-56">
          <Select aria-label="Filtrar por categoria" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Todas as categorias</option>
            {demoCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {sections.length === 0 ? (
        <EmptyState icon={<BookOpen />} title="Nenhum produto encontrado" description="Ajuste a busca ou o filtro." />
      ) : (
        sections.map(({ category, all, shown }) => (
          <Card key={category.id} className="overflow-hidden">
            <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
              <Badge tone="success" dot>
                Ativa
              </Badge>
              <h2 className="text-sm font-semibold text-foreground">{category.name}</h2>
              <span className="text-xs text-subtle">
                ({all.length} produto{all.length === 1 ? '' : 's'})
              </span>
            </div>
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <Th>Produto</Th>
                    <Th className="w-40">Status</Th>
                    <Th className="w-32">Preço</Th>
                  </tr>
                </THead>
                <TBody>
                  {shown.map((product) => (
                    <Tr key={product.id}>
                      <Td>
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-xl"
                          >
                            {product.emoji}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{product.name}</p>
                            <p className="max-w-sm truncate text-xs text-subtle">{product.description}</p>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <Badge tone={product.available ? 'success' : 'neutral'} dot>
                          {product.available ? 'Disponível' : 'Indisponível'}
                        </Badge>
                      </Td>
                      <Td className="whitespace-nowrap font-semibold text-accent">{formatDemoBRL(product.priceCents)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </Card>
        ))
      )}
    </Page>
  );
}
