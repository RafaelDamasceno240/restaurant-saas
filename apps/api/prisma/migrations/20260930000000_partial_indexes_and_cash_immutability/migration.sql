CREATE UNIQUE INDEX IF NOT EXISTS "cash_register_sessions_one_open_per_branch"
  ON "cash_register_sessions" ("tenantId", "branchId")
  WHERE "status" = 'OPEN';

CREATE OR REPLACE FUNCTION cash_movements_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cash_movements is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cash_movements_no_update_delete ON "cash_movements";
CREATE TRIGGER cash_movements_no_update_delete
  BEFORE UPDATE OR DELETE ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION cash_movements_immutable();

CREATE UNIQUE INDEX IF NOT EXISTS "tabs_one_open_per_table"
  ON "tabs" ("tableId")
  WHERE "status" = 'OPEN';
