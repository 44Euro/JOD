-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "record_kind" AS ENUM ('account', 'instrument', 'transaction', 'setting', 'daily_value', 'import', 'plan', 'watch', 'picture');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "sealed_password_key" TEXT,
    "sealed_recovery_key" TEXT,
    "change_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "sync_records" (
    "user_id" UUID NOT NULL,
    "kind" "record_kind" NOT NULL,
    "record_id" TEXT NOT NULL,
    "sealed" TEXT,
    "change" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_records_pkey" PRIMARY KEY ("user_id","kind","record_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sync_records_user_id_change_idx" ON "sync_records"("user_id", "change");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_records" ADD CONSTRAINT "sync_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Only the sync server, connecting as the owner, touches these tables. Row level security with no policies keeps
-- them closed to Supabase's public API even if that API is switched on later.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_resets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_records" ENABLE ROW LEVEL SECURITY;
