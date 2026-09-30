-- At most one ACTIVE supplier per (tenant, case-insensitive name). Inactive
-- suppliers are historical and may share a name with an active one.
-- Not expressible in schema.prisma (partial + expression index), same approach
-- as 20260930000000_partial_indexes_and_cash_immutability.
CREATE UNIQUE INDEX "suppliers_tenantId_lower_name_active_key"
  ON "suppliers" ("tenantId", lower("name"))
  WHERE "active" = true;
