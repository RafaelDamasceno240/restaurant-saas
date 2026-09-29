'use client';

import { MenuAdmin } from '@/components/cardapio/MenuAdmin';
import { Page, PageHeader } from '@/components/ds/PageHeader';

export default function CardapioPage() {
  return (
    <Page>
      <PageHeader title="Cardápio" description="Gerencie categorias e produtos do seu cardápio" />
      <MenuAdmin />
    </Page>
  );
}
