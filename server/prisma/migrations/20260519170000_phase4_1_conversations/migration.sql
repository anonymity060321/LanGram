-- CreateEnum
CREATE TYPE "conversation_type" AS ENUM ('DIRECT');

-- CreateEnum
CREATE TYPE "message_type" AS ENUM ('TEXT');

-- CreateEnum
CREATE TYPE "message_status" AS ENUM ('SENT', 'DELIVERED', 'READ', 'RECALLED');

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "type" "conversation_type" NOT NULL,
    "direct_user_a_id" UUID,
    "direct_user_b_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_members" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_message_id" UUID,
    "last_read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "message_type" "message_type" NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "encryption_version" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "reply_to_message_id" UUID,
    "status" "message_status" NOT NULL DEFAULT 'SENT',
    "edited_at" TIMESTAMP(3),
    "recalled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_deliveries" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "receiver_id" UUID NOT NULL,
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_type_direct_user_a_id_direct_user_b_id_key" ON "conversations"("type", "direct_user_a_id", "direct_user_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_members_conversation_id_user_id_key" ON "conversation_members"("conversation_id", "user_id");

-- CreateIndex
CREATE INDEX "conversation_members_user_id_idx" ON "conversation_members"("user_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_sender_id_created_at_idx" ON "messages"("sender_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_deliveries_message_id_receiver_id_key" ON "message_deliveries"("message_id", "receiver_id");

-- CreateIndex
CREATE INDEX "message_deliveries_receiver_id_delivered_at_idx" ON "message_deliveries"("receiver_id", "delivered_at");

-- CreateIndex
CREATE INDEX "message_deliveries_receiver_id_read_at_idx" ON "message_deliveries"("receiver_id", "read_at");

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
