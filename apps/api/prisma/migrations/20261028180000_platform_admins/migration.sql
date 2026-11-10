-- Super Admin MVP (2026-10-28): who administers the PLATFORM, across every restaurant. A new
-- table, not a role: roles are tenant-scoped (user_roles.tenantId) and OWNER/ADMIN must keep
-- administering one restaurant only. A row here is granted and revoked by the local CLI
-- (src/cli/platform-admin.ts), never by a route.
--
-- Purely additive: one new empty table, one unique index, one foreign key to users. No existing
-- table, column, row or constraint changes. Deleting a user deletes its grant (CASCADE), the
-- same as the user's other rows.

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_userId_key" ON "platform_admins"("userId");

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
