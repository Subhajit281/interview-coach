ALTER TABLE "InterviewSession" ADD COLUMN "startRequestKey" TEXT;
CREATE UNIQUE INDEX "InterviewSession_userId_startRequestKey_key" ON "InterviewSession"("userId", "startRequestKey");
