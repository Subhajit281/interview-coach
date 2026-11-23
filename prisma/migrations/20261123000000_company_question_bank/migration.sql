CREATE TABLE "CachedQuestion" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "topic" TEXT,
    "title" TEXT NOT NULL,
    "titleKey" TEXT NOT NULL,
    "spoken" TEXT NOT NULL DEFAULT '',
    "board" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'live',
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CachedQuestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CachedQuestion_company_mode_titleKey_key" ON "CachedQuestion"("company", "mode", "titleKey");
CREATE INDEX "CachedQuestion_company_mode_difficulty_idx" ON "CachedQuestion"("company", "mode", "difficulty");
