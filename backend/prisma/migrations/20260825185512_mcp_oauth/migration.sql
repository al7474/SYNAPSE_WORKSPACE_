-- CreateTable
CREATE TABLE "mcp_clients" (
    "id" BIGSERIAL NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_name" TEXT,
    "redirect_uris" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_authorization_codes" (
    "id" BIGSERIAL NOT NULL,
    "code_hash" TEXT NOT NULL,
    "client_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "code_challenge_method" TEXT NOT NULL DEFAULT 'S256',
    "scopes" TEXT[],
    "resource" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_authorization_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_access_tokens" (
    "id" BIGSERIAL NOT NULL,
    "token_hash" TEXT NOT NULL,
    "client_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "scopes" TEXT[],
    "resource" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_refresh_tokens" (
    "id" BIGSERIAL NOT NULL,
    "token_hash" TEXT NOT NULL,
    "client_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "scopes" TEXT[],
    "resource" TEXT,
    "access_token_id" BIGINT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_clients_client_id_key" ON "mcp_clients"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_authorization_codes_code_hash_key" ON "mcp_authorization_codes"("code_hash");

-- CreateIndex
CREATE INDEX "idx_mcp_authorization_codes_expiry" ON "mcp_authorization_codes"("expires_at");

-- CreateIndex
CREATE INDEX "idx_mcp_authorization_codes_client" ON "mcp_authorization_codes"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_access_tokens_token_hash_key" ON "mcp_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "idx_mcp_access_tokens_user" ON "mcp_access_tokens"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_mcp_access_tokens_expiry" ON "mcp_access_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_refresh_tokens_token_hash_key" ON "mcp_refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_refresh_tokens_access_token_id_key" ON "mcp_refresh_tokens"("access_token_id");

-- CreateIndex
CREATE INDEX "idx_mcp_refresh_tokens_user" ON "mcp_refresh_tokens"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_mcp_refresh_tokens_expiry" ON "mcp_refresh_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "mcp_authorization_codes" ADD CONSTRAINT "mcp_authorization_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "mcp_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_authorization_codes" ADD CONSTRAINT "mcp_authorization_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "mcp_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_refresh_tokens" ADD CONSTRAINT "mcp_refresh_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "mcp_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_refresh_tokens" ADD CONSTRAINT "mcp_refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_refresh_tokens" ADD CONSTRAINT "mcp_refresh_tokens_access_token_id_fkey" FOREIGN KEY ("access_token_id") REFERENCES "mcp_access_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Prisma does not model PostgreSQL CHECK constraints or functional indexes.
ALTER TABLE "mcp_authorization_codes"
  ADD CONSTRAINT "mcp_authorization_codes_challenge_method_check"
  CHECK ("code_challenge_method" = 'S256');

