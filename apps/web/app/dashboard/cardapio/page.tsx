'use client';

import { useEffect, useState } from 'react';
import { Layers, UtensilsCrossed } from 'lucide-react';
import { MenuAdmin } from '@/components/cardapio/MenuAdmin';
import { OptionGroupsAdmin } from '@/components/cardapio/OptionGroupsAdmin';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { Tabs } from '@/components/ds/Tabs';

type Tab = 'produtos' | 'adicionais';

// The menu of the restaurant: products by category, and the add-on groups the products offer.
// The tab is kept in the address (#adicionais), so a reload or a shared link opens the same tab.
export default function CardapioPage() {
  const [tab, setTab] = useState<Tab>('produtos');

  useEffect(() => {
    if (window.location.hash === '#adicionais') setTab('adicionais');
  }, []);

  function change(next: Tab) {
    setTab(next);
    window.history.replaceState(
      null,
      '',
      next === 'adicionais' ? '#adicionais' : window.location.pathname,
    );
  }

  return (
    <Page>
      <PageHeader
        title="Cardápio"
        description="Produtos, preços, fotos, disponibilidade e adicionais do seu cardápio"
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={change}
        items={[
          {
            key: 'produtos',
            label: 'Produtos',
            icon: <UtensilsCrossed className="h-4 w-4" aria-hidden />,
          },
          {
            key: 'adicionais',
            label: 'Adicionais',
            icon: <Layers className="h-4 w-4" aria-hidden />,
          },
        ]}
      />
      {tab === 'produtos' ? <MenuAdmin /> : <OptionGroupsAdmin />}
    </Page>
  );
}
