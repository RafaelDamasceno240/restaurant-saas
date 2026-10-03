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
