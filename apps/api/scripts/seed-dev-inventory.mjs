const API = process.env.API_URL ?? 'http://localhost:4000/v1';
const EMAIL = 'dev.estoque@restaurant-saas.test';
const DEV_CREDENTIALS_NOTE = 'Conta local de teste; nunca usar fora do ambiente de desenvolvimento.';
const PASSWORD = 'DevEstoque#2026';

async function call(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data.code ?? ''} ${data.message ?? ''}`);
  return data;
}

async function main() {
  let token;
  try {
    token = (
      await call('POST', '/auth/register', null, {
        tenantName: 'Burger Dev',
        legalName: 'Burger Dev LTDA',
        document: String(Date.now()).padStart(14, '0').slice(-14),
        slug: `burger-dev-${Date.now()}`,
        branchName: 'Matriz',
        userName: 'Dev Estoque',
        email: EMAIL,
        password: PASSWORD,
      })
    ).accessToken;
  } catch (error) {
    if (!String(error.message).includes('409')) throw error;
    console.log(`Conta já existe. ${DEV_CREDENTIALS_NOTE}`);
    return;
  }

  const [branch] = await call('GET', '/branches/accessible', token);
  const branchId = branch.id;

  const categories = {};
  for (const name of ['Hambúrgueres', 'Porções', 'Bebidas']) {
    categories[name] = (await call('POST', '/categories', token, { name })).id;
  }
  const product = async (name, category, price) =>
    (await call('POST', '/products', token, { categoryId: categories[category], name, price })).id;
  const xBurger = await product('X-Burger', 'Hambúrgueres', 29.9);
  const xBacon = await product('X-Bacon', 'Hambúrgueres', 34.9);
  const duplo = await product('Duplo Cheddar', 'Hambúrgueres', 39.9);
  const batata = await product('Batata frita', 'Porções', 19.9);
  await product('Refrigerante lata', 'Bebidas', 6.9);

  const item = async (name, unit, minStock) => (await call('POST', '/inventory/items', token, { name, unit, minStock })).id;
  const pao = await item('Pão brioche', 'UNIT', 20);
  const carne = await item('Blend bovino', 'KG', 3);
  const queijo = await item('Queijo cheddar', 'KG', 1);
  const bacon = await item('Bacon fatiado', 'KG', 1);
  const fritas = await item('Batata pré-frita', 'KG', 5);
  const oleo = await item('Óleo de soja', 'L', 4);
  await item('Embalagem delivery', 'UNIT', 50);

  const entry = (inventoryItemId, quantity, unitCostCents, reason) =>
    call('POST', '/inventory/movements', token, { branchId, inventoryItemId, type: 'ENTRY', quantity, unitCostCents, reason });
  await entry(pao, 40, 145, 'Padaria Central');
  await entry(carne, 6, 4290, 'NF 4821 — Frigorífico');
  await entry(carne, 4, 4450);
  await entry(queijo, 1.2, 5890);
  await entry(bacon, 2.5, 4450);
  await entry(fritas, 12, 1890);
  await entry(oleo, 3, 890);

  const recipe = (productId, items) => call('PUT', `/inventory/recipes/${productId}`, token, { items });
  await recipe(xBurger, [
    { inventoryItemId: pao, quantity: 1 },
    { inventoryItemId: carne, quantity: 150, unit: 'G' },
    { inventoryItemId: queijo, quantity: 30, unit: 'G' },
  ]);
  await recipe(xBacon, [
    { inventoryItemId: pao, quantity: 1 },
    { inventoryItemId: carne, quantity: 150, unit: 'G' },
    { inventoryItemId: queijo, quantity: 30, unit: 'G' },
    { inventoryItemId: bacon, quantity: 40, unit: 'G' },
  ]);
  await recipe(duplo, [
    { inventoryItemId: pao, quantity: 1 },
    { inventoryItemId: carne, quantity: 300, unit: 'G' },
    { inventoryItemId: queijo, quantity: 60, unit: 'G' },
  ]);
  await recipe(batata, [
    { inventoryItemId: fritas, quantity: 300, unit: 'G' },
    { inventoryItemId: oleo, quantity: 50, unit: 'ML' },
  ]);

  for (const [productId, quantity] of [[xBurger, 3], [xBacon, 2], [duplo, 4], [batata, 2]]) {
    const order = await call('POST', '/pos/orders', token, {
      branchId,
      items: [{ productId, quantity }],
      paymentMethod: 'PIX',
    });
    await call('PATCH', `/orders/${order.id}/status`, token, { status: 'CONFIRMED' });
  }

  await call('POST', '/inventory/movements', token, {
    branchId, inventoryItemId: queijo, type: 'EXIT', quantity: 0.2, exitReason: 'LOSS', notes: 'Venceu na câmara',
  });
  await call('POST', '/inventory/inventory-counts', token, {
    branchId, notes: 'Contagem de fechamento', items: [{ inventoryItemId: pao, countedQuantity: 28 }],
  });

  console.log(`Dados criados. Login: ${EMAIL}. ${DEV_CREDENTIALS_NOTE}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
