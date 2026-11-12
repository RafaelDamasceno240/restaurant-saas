import { PrismaClient, RoleName } from '@prisma/client';

const prisma = new PrismaClient();

const PERMISSIONS: string[] = [
  'restaurant.read',
  'restaurant.update',
  'users.read',
  'users.create',
  'users.update',
  'users.delete',
  'products.read',
  'products.create',
  'products.update',
  'products.delete',
  'categories.read',
  'categories.create',
  'categories.update',
  'categories.delete',
  'orders.read',
  'orders.create',
  'orders.update',
  'orders.cancel',
  'pos.read',
  'pos.create',
  'cash.read',
  'cash.open',
  'cash.close',
  'cash.movement.create',
  'tables.read',
  'tables.create',
  'tables.update',
  'tables.delete',
  'tabs.read',
  'tabs.create',
  'tabs.update',
  'tabs.close',
  'inventory.read',
  'inventory.create',
  'inventory.update',
  'inventory.movement.create',
  'inventory.recipe.manage',
  'inventory.count',
  'purchases.read',
  'purchases.create',
  'purchases.update',
  'purchases.receive',
  'purchases.cancel',
  'suppliers.read',
  'suppliers.create',
  'suppliers.update',
  'delivery.read',
  'delivery.update',
  'delivery.configure',
  'delivery.assign',
  'customers.read',
  'customers.create',
  'customers.update',
  'coupons.read',
  'coupons.create',
  'coupons.update',
  'coupons.apply',
  'loyalty.read',
  'loyalty.redeem',
  'loyalty.adjust',
  'loyalty.configure',
  'cashback.read',
  'cashback.use',
  'cashback.adjust',
  'cashback.configure',
  'receivables.read',
  'receivables.receive',
  'receivables.manage',
  'reports.read',
];

const ROLE_PERMISSIONS: Record<RoleName, string[]> = {
  OWNER: PERMISSIONS,
  ADMIN: PERMISSIONS,
  MANAGER: [
    'restaurant.read',
    'users.read',
    'products.read',
    'products.create',
    'products.update',
    'categories.read',
    'categories.create',
    'categories.update',
    'orders.read',
    'orders.update',
    'orders.cancel',
    'pos.read',
    'pos.create',
    'cash.read',
    'cash.open',
    'cash.close',
    'cash.movement.create',
    'tables.read',
    'tables.create',
    'tables.update',
    'tables.delete',
    'tabs.read',
    'tabs.create',
    'tabs.update',
    'tabs.close',
    'inventory.read',
    'inventory.create',
    'inventory.update',
    'inventory.movement.create',
    'inventory.recipe.manage',
    'inventory.count',
    'purchases.read',
    'purchases.create',
    'purchases.update',
    'purchases.receive',
    'purchases.cancel',
    'suppliers.read',
    'suppliers.create',
    'suppliers.update',
    'delivery.read',
    'delivery.update',
    'delivery.configure',
    'delivery.assign',
    'customers.read',
    'customers.create',
    'customers.update',
    'coupons.read',
    'coupons.create',
    'coupons.update',
    'coupons.apply',
    // Runs the program day to day; the rate and the rewards catalogue (loyalty.configure)
    // stay with OWNER/ADMIN.
    'loyalty.read',
    'loyalty.redeem',
    'loyalty.adjust',
    // Same split for cashback: the percentage and the expiration (cashback.configure) stay
    // with OWNER/ADMIN.
    'cashback.read',
    'cashback.use',
    'cashback.adjust',
    // Fiado that already exists (no new fiado is sold since remocao-fiado): receives, reverses a
    // payment and cancels a debt.
    'receivables.read',
    'receivables.receive',
    'receivables.manage',
    // Sales, products, customers, stock, delivery and cash figures of the branches they run.
    'reports.read',
  ],
  CASHIER: [
    'orders.read',
    'orders.create',
    'products.read',
    'categories.read',
    'pos.read',
    'pos.create',
    'cash.read',
    'cash.open',
    'cash.close',
    'cash.movement.create',
    'tables.read',
    'tabs.read',
    'inventory.read',
    'customers.read',
    'customers.create',
    // Uses a coupon at the counter; administering coupons stays with management.
    'coupons.apply',
    // Sees the balance and hands out a reward at the counter; never adjusts points by hand.
    'loyalty.read',
    'loyalty.redeem',
    // Sees the balance and spends it on a sale; never adjusts it by hand.
    'cashback.read',
    'cashback.use',
    // Receives payments of fiado that already exists at the counter; never reverses or cancels.
    'receivables.read',
    'receivables.receive',
  ],
  WAITER: [
    'orders.read',
    'orders.create',
    'products.read',
    'categories.read',
    'tables.read',
    'tabs.read',
    'tabs.create',
    'tabs.update',
    'tabs.close',
  ],
  KITCHEN: ['orders.read', 'orders.update', 'inventory.read'],
  DELIVERY: ['orders.read', 'delivery.read', 'delivery.update'],
  VIEWER: [
    'restaurant.read',
    'products.read',
    'categories.read',
    'orders.read',
    'tables.read',
    'tabs.read',
  ],
};

async function main() {
  console.log('Seeding roles...');
  for (const name of Object.values(RoleName)) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  console.log('Seeding permissions...');
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
  }

  console.log('Wiring role -> permission...');
  for (const [roleName, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName as RoleName } });
    for (const key of permissionKeys) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  console.log('Seed complete. No fictitious tenants/users/products were created.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
