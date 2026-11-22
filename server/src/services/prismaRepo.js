const session = (x) => x && ({ ...x, duration_min: Math.round((x.durationSec || 0) / 60), elapsed_sec: x.durationSec || 0, started_at: x.startTime, ended_at: x.endTime, mode: x.type, project_id: x.projectId });
const message = (x) => ({ ...x, interview_id: x.sessionId, meta: x.meta ? JSON.stringify(x.meta) : null, created_at: x.createdAt });
const question = (x) => ({ ...x, interview_id: x.sessionId, title: x.question, mode: x.questionType, hints_used: x.hintsUsed, asked_at: x.createdAt });

export function createPrismaRepo(prisma, userId) {
  const own = (id) => ({ id, userId });
  return {
    async addProject(name, description) { return (await prisma.interviewProject.create({ data: { userId, name, description } })).id; },
    async listProjects() { return (await prisma.interviewProject.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })).map((p) => ({ ...p, preview: p.description.slice(0, 200), created_at: p.createdAt })); },
    async getProject(id) { return prisma.interviewProject.findFirst({ where: { id, userId } }); },
    async deleteProject(id) { return prisma.interviewProject.deleteMany({ where: own(id) }); },
    async createInterview(c) {
      const row = await prisma.interviewSession.create({ data: { userId, projectId: c.projectId || null, title: `${c.position} ${c.mode} interview`, type: c.mode, company: c.company, position: c.position, round: c.round || '', style: c.style || 'standard', personality: c.personality, difficulty: c.difficulty, model: 'automatic', durationSec: c.durationMin * 60 } });
      return row.id;
    },
    async getInterview(id) { return session(await prisma.interviewSession.findFirst({ where: own(id) })); },
    async listInterviews() { const rows = await prisma.interviewSession.findMany({ where: { userId }, include: { analytics: true }, orderBy: { createdAt: 'desc' }, take: 200 }); return rows.map((r) => ({ ...session(r), overall_score: r.analytics?.overallScore ?? null })); },
    async setStatus(id, status) { return prisma.interviewSession.updateMany({ where: own(id), data: { status } }); },
    async finishInterview(id, status, elapsedSec) { return prisma.interviewSession.updateMany({ where: own(id), data: { status, durationSec: Math.max(0, Math.round(elapsedSec || 0)), endTime: new Date() } }); },
    async deleteInterview(id) {
      await prisma.interviewSession.deleteMany({ where: own(id) });
      const remaining = await prisma.interviewAnalytics.findMany({ where: { userId } });
      await prisma.topicStat.deleteMany({ where: { userId } });
      for (const row of remaining) {
        const topics = row.report?.topic_scores || [];
        for (const t of topics) {
          if (!t.topic) continue;
          await this.upsertTopicStat(t.topic, t.score, t.hints_used || 0);
        }
      }
    },
    async addMessage(id, role, content, board = null, meta = null) {
      const row = await prisma.interviewMessage.create({ data: { sessionId: id, role, content, board: board || null, meta: meta || undefined } });
      if (role === 'candidate') { const q = await prisma.interviewQuestion.findFirst({ where: { sessionId: id }, orderBy: { sequenceNumber: 'desc' } }); await prisma.interviewResponse.create({ data: { sessionId: id, questionId: q?.id, messageId: row.id, userResponse: content } }); }
      return row.id;
    },
    async deleteMessage(id) { await prisma.interviewResponse.deleteMany({ where: { messageId: id } }); return prisma.interviewMessage.delete({ where: { id } }); },
    async getMessages(id, limit = null) { const rows = await prisma.interviewMessage.findMany({ where: { session: { is: own(id) } }, orderBy: { createdAt: limit ? 'desc' : 'asc' }, take: limit || undefined }); return (limit ? rows.reverse() : rows).map(message); },
    async lastMessage(id) { const row = await prisma.interviewMessage.findFirst({ where: { session: { is: own(id) } }, orderBy: { createdAt: 'desc' } }); return row ? message(row) : null; },
    async addQuestion(id, mode, topic, title, difficulty) { const count = await prisma.interviewQuestion.count({ where: { sessionId: id } }); return (await prisma.interviewQuestion.create({ data: { sessionId: id, question: title, questionType: mode, topic: topic || null, difficulty, sequenceNumber: count + 1 } })).id; },
    async bumpHint(id) { const q = await prisma.interviewQuestion.findFirst({ where: { sessionId: id }, orderBy: { sequenceNumber: 'desc' } }); return q && prisma.interviewQuestion.update({ where: { id: q.id }, data: { hintsUsed: { increment: 1 } } }); },
    async questionsFor(id) { return (await prisma.interviewQuestion.findMany({ where: { sessionId: id }, orderBy: { sequenceNumber: 'asc' } })).map(question); },
    async interviewQuestions(id) { return (await this.questionsFor(id)).map((q) => ({ topic: q.topic, title: q.title })); },
    async recentQuestionTitles(mode, limit = 25) { const rows = await prisma.interviewQuestion.findMany({ where: { session: { is: { userId, type: mode } } }, orderBy: { createdAt: 'desc' }, take: limit, select: { question: true } }); return rows.map((x) => x.question); },
    async recentSeeds(mode, limit = 150) { const rows = await prisma.interviewMessage.findMany({ where: { role: 'interviewer', session: { is: { userId, type: mode } } }, orderBy: { createdAt: 'desc' }, take: limit, select: { meta: true } }); return rows.map((r) => r.meta?.seed).filter(Boolean); },
    async saveReport(id, overall, scores, report) { const cat = scores || {}; await prisma.interviewAnalytics.upsert({ where: { sessionId: id }, create: { userId, sessionId: id, overallScore: overall, communicationScore: cat.communication ?? null, technicalScore: cat.technical_knowledge ?? null, confidenceScore: cat.confidence_clarity ?? null, strengths: report.strengths || [], weaknesses: report.weaknesses || [], improvementSuggestions: report.improvement_plan || [], report }, update: { overallScore: overall, communicationScore: cat.communication ?? null, technicalScore: cat.technical_knowledge ?? null, confidenceScore: cat.confidence_clarity ?? null, strengths: report.strengths || [], weaknesses: report.weaknesses || [], improvementSuggestions: report.improvement_plan || [], report } }); },
    async getReport(id) { const row = await prisma.interviewAnalytics.findFirst({ where: { session: { is: own(id) } } }); return row ? { ...row.report, overall_score: row.overallScore, categories: row.report.categories || {}, created_at: row.createdAt } : null; },
    async upsertTopicStat(topic, score, hints = 0) { const old = await prisma.topicStat.findUnique({ where: { userId_topic: { userId, topic } } }); return old ? prisma.topicStat.update({ where: { id: old.id }, data: { average: (old.average * old.attempts + score) / (old.attempts + 1), attempts: { increment: 1 }, hintsTotal: { increment: hints }, lastSeen: new Date() } }) : prisma.topicStat.create({ data: { userId, topic, attempts: 1, average: score, hintsTotal: hints } }); },
    async topicStats(prefix = null) { const rows = await prisma.topicStat.findMany({ where: { userId, ...(prefix ? { topic: { startsWith: `${prefix}:` } } : {}) } }); return rows.map((r) => ({ topic: r.topic, attempts: r.attempts, avg_score: r.average, hints_total: r.hintsTotal, last_seen: r.lastSeen })); },
    async recentWeaknesses(reports = 3, max = 6, mode = null) { const rows = await prisma.interviewAnalytics.findMany({ where: { userId, ...(mode ? { session: { is: { type: mode } } } : {}) }, orderBy: { createdAt: 'desc' }, take: reports, select: { weaknesses: true } }); return [...new Set(rows.flatMap((r) => Array.isArray(r.weaknesses) ? r.weaknesses : []))].slice(0, max); },
    async overview() { const rows = await prisma.interviewAnalytics.findMany({ where: { userId }, include: { session: true }, orderBy: { createdAt: 'desc' }, take: 12 }); const all = await prisma.interviewAnalytics.findMany({ where: { userId }, select: { overallScore: true } }); return { reports: all.length, avgScore: all.length ? Math.round(all.reduce((s, x) => s + (x.overallScore || 0), 0) / all.length * 10) / 10 : null, trend: rows.reverse().map((r) => ({ id: r.sessionId, score: r.overallScore, mode: r.session.type, company: r.session.company, started_at: r.session.startTime })), solvedWithoutHints: 0, neededHints: 0 }; },
    async setQuestionResult(id, solved, hints) { return prisma.interviewQuestion.update({ where: { id }, data: { solved, hintsUsed: hints } }); },
  };
}
