-- WhatsApp assistant (branch assistente-whatsapp): connections per restaurant in the shape of the
-- WhatsApp Business Platform Cloud API, contacts, conversations, messages, webhook receipts, the
-- job queue and checkout links.
--
-- Additive only: new enums and tables. No existing table or row changes.

-- CreateEnum
CREATE TYPE "WhatsappConnectionMode" AS ENUM ('SIMULATED', 'CLOUD');

-- CreateEnum
CREATE TYPE "WhatsappConversationStatus" AS ENUM ('AI', 'HUMAN');

-- CreateEnum
CREATE TYPE "WhatsappMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "WhatsappMessageAuthor" AS ENUM ('CUSTOMER', 'ASSISTANT', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "WhatsappMessageStatus" AS ENUM ('RECEIVED', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "WhatsappJobType" AS ENUM ('REPLY', 'SEND');

-- CreateEnum
CREATE TYPE "WhatsappJobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "whatsapp_connections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mode" "WhatsappConnectionMode" NOT NULL DEFAULT 'SIMULATED',
    "phoneNumberId" TEXT NOT NULL,
    "displayPhoneNumber" TEXT NOT NULL,
    "wabaId" TEXT,
    "accessTokenEncrypted" TEXT,
    "assistantEnabled" BOOLEAN NOT NULL DEFAULT false,
    "greetingMessage" TEXT,
    "behaviorInstructions" TEXT,
    "aiDailyReplyLimit" INTEGER NOT NULL DEFAULT 300,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "profileName" TEXT,
    "optedOutAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_conversations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "WhatsappConversationStatus" NOT NULL DEFAULT 'AI',
    "assignedUserId" TEXT,
    "cart" JSONB,
    "cartVersion" INTEGER NOT NULL DEFAULT 0,
    "awaitingConfirmationVersion" INTEGER,
    "dialogState" JSONB,
    "processingUntil" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "aiFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "WhatsappMessageDirection" NOT NULL,
    "author" "WhatsappMessageAuthor" NOT NULL,
    "authorUserId" TEXT,
    "providerMessageId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT NOT NULL,
    "status" "WhatsappMessageStatus" NOT NULL,
    "providerTimestamp" TIMESTAMP(3) NOT NULL,
    "inReplyToId" TEXT,
    "handledAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_webhook_events" (
    "id" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "messagesCount" INTEGER NOT NULL DEFAULT 0,
    "statusesCount" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "whatsapp_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT,
    "type" "WhatsappJobType" NOT NULL,
    "status" "WhatsappJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_checkout_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "cart" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_checkout_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_connections_tenantId_key" ON "whatsapp_connections"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_connections_phoneNumberId_key" ON "whatsapp_connections"("phoneNumberId");

-- CreateIndex
CREATE INDEX "whatsapp_contacts_tenantId_idx" ON "whatsapp_contacts"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_contacts_connectionId_waId_key" ON "whatsapp_contacts"("connectionId", "waId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_conversations_contactId_key" ON "whatsapp_conversations"("contactId");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_tenantId_lastMessageAt_idx" ON "whatsapp_conversations"("tenantId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_inReplyToId_key" ON "whatsapp_messages"("inReplyToId");

-- CreateIndex
CREATE INDEX "whatsapp_messages_conversationId_providerTimestamp_idx" ON "whatsapp_messages"("conversationId", "providerTimestamp");

-- CreateIndex
CREATE INDEX "whatsapp_messages_tenantId_author_createdAt_idx" ON "whatsapp_messages"("tenantId", "author", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_tenantId_providerMessageId_key" ON "whatsapp_messages"("tenantId", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_webhook_events_payloadHash_key" ON "whatsapp_webhook_events"("payloadHash");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_jobs_dedupeKey_key" ON "whatsapp_jobs"("dedupeKey");

-- CreateIndex
CREATE INDEX "whatsapp_jobs_status_runAt_idx" ON "whatsapp_jobs"("status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_checkout_links_tokenHash_key" ON "whatsapp_checkout_links"("tokenHash");

-- CreateIndex
CREATE INDEX "whatsapp_checkout_links_tenantId_idx" ON "whatsapp_checkout_links"("tenantId");

-- AddForeignKey
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "whatsapp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "whatsapp_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_inReplyToId_fkey" FOREIGN KEY ("inReplyToId") REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_jobs" ADD CONSTRAINT "whatsapp_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_jobs" ADD CONSTRAINT "whatsapp_jobs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_checkout_links" ADD CONSTRAINT "whatsapp_checkout_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_checkout_links" ADD CONSTRAINT "whatsapp_checkout_links_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Guarantees the API relies on.
ALTER TABLE "whatsapp_connections"
  ADD CONSTRAINT "whatsapp_connections_daily_limit_range" CHECK ("aiDailyReplyLimit" BETWEEN 0 AND 10000);
ALTER TABLE "whatsapp_conversations"
  ADD CONSTRAINT "whatsapp_conversations_counters_nonneg" CHECK ("unreadCount" >= 0 AND "aiFailures" >= 0 AND "cartVersion" >= 0);
ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_tokens_nonneg" CHECK (coalesce("inputTokens", 0) >= 0 AND coalesce("outputTokens", 0) >= 0),
  ADD CONSTRAINT "whatsapp_messages_body_length" CHECK (char_length("body") <= 4096);
ALTER TABLE "whatsapp_jobs"
  ADD CONSTRAINT "whatsapp_jobs_attempts_range" CHECK ("attempts" >= 0 AND "maxAttempts" >= 1);
