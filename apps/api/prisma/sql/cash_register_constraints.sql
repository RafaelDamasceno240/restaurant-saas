-- Fatia 08 (Caixa). Prisma não expressa índices únicos PARCIAIS no schema,
-- então este é aplicado após as migrations via `pnpm db:constraints`
-- (prisma db execute). Idempotente (IF NOT EXISTS).
--
-- Garante no NÍVEL DO BANCO que nunca existam duas sessões OPEN para a mesma
-- tenant+branch, mesmo que duas aberturas simultâneas passassem pela checagem
-- da aplicação. Defesa em profundidade: o CashRegisterService já serializa as
-- aberturas com SELECT ... FOR UPDATE na linha da branch.
CREATE UNIQUE INDEX IF NOT EXISTS "cash_register_sessions_one_open_per_branch"
  ON "cash_register_sessions" ("tenantId", "branchId")
  WHERE "status" = 'OPEN';

-- Movimentos são imutáveis: bloqueia UPDATE/DELETE até por acesso direto ao
-- banco fora da API (a API já não expõe rota nenhuma para isso).
CREATE OR REPLACE FUNCTION cash_movements_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cash_movements is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cash_movements_no_update_delete ON "cash_movements";
CREATE TRIGGER cash_movements_no_update_delete
  BEFORE UPDATE OR DELETE ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION cash_movements_immutable();
