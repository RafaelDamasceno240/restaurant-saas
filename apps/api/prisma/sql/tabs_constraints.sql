-- Fatia 09 (Mesas/Comandas). Prisma não expressa índices únicos PARCIAIS no
-- schema, então este é aplicado após as migrations via `pnpm db:tabs-constraints`
-- (prisma db execute). Idempotente (IF NOT EXISTS).
--
-- Garante no NÍVEL DO BANCO que nunca existam duas comandas OPEN para a
-- mesma mesa, mesmo que duas aberturas simultâneas passassem pela checagem
-- da aplicação. Defesa em profundidade: TabsService.open() já serializa as
-- aberturas com SELECT ... FOR UPDATE na linha da mesa.
CREATE UNIQUE INDEX IF NOT EXISTS "tabs_one_open_per_table"
  ON "tabs" ("tableId")
  WHERE "status" = 'OPEN';
