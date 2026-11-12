export const MODES = {
  dsa: {
    label: 'DSA',
    topics: ['Arrays & Strings', 'Hashing', 'Two Pointers', 'Sliding Window', 'Binary Search', 'Linked Lists',
      'Stacks & Queues', 'Trees & BST', 'Graphs', 'Greedy', 'Dynamic Programming', 'Heaps', 'Backtracking', 'Tries',
      'Advanced Problem Solving'],
    guidance:
      'Run a coding interview. Progression (adapt, do not force): problem statement -> let candidate clarify -> candidate\'s initial approach -> ' +
      'complexity analysis -> push for optimization -> implementation (candidate submits code via [CODE] messages or explains verbally) -> edge cases -> follow-ups. ' +
      'Evaluate methodology, not only final code. Occasionally ask: why this data structure, can you prove it works, what if values are negative, is it optimal, can you reduce auxiliary space. ' +
      'Put the full problem statement with 1-2 examples and constraints in "board" when you pose it. Never include the solution or the intended technique in the problem.',
  },
  core_cs: {
    label: 'Core CS',
    topics: ['Operating Systems', 'DBMS', 'Computer Networks', 'OOP', 'Computer Architecture',
      'Concurrency & Synchronization', 'Memory Management', 'SQL'],
    guidance:
      'Ask conceptual and applied core CS questions. Start with a definition-level question, then probe depth: why, trade-offs, failure modes, a concrete scenario, and a tricky edge. ' +
      'Prefer "explain with an example" and "what breaks if..." over trivia. Use "board" only for small snippets or scenarios.',
  },
  system_design: {
    label: 'System Design',
    topics: ['Low-Level Design', 'High-Level Design', 'Object-Oriented Design', 'Design Patterns', 'Scalability',
      'Distributed Systems', 'Database Design', 'Caching', 'Load Balancing'],
    guidance:
      'Run a design interview suited to the position level (interns/new grads: scoped systems, clear fundamentals; do not demand staff-level depth). ' +
      'Flow: requirements and scale clarification -> API and data model -> core components -> bottlenecks and scaling -> trade-offs and failure handling. ' +
      'For low-level design, ask for classes, responsibilities, relationships and patterns. Put the problem prompt in "board". Challenge decisions with "what happens when X fails/grows 100x".',
  },
  project: {
    label: 'Project Discussion',
    topics: ['Architecture', 'Technology Choices', 'Database Design', 'API Design', 'Scalability', 'Security',
      'Performance', 'Trade-offs', 'Production Issues'],
    guidance:
      'Interview the candidate about THEIR project using only the project description provided. Probe architecture decisions, technology choices, DB and API design, scalability, security, performance and trade-offs. ' +
      'Ask what they personally built, what broke, what they would change. Challenge claims that sound vague ("how exactly does that work?"). Never invent features that are not in the description; if you need detail, ask.',
  },
  behavioral: {
    label: 'Behavioral / HR',
    topics: ['Leadership', 'Teamwork', 'Conflict Resolution', 'Failure', 'Problem Solving', 'Ownership', 'Decision Making'],
    guidance:
      'Ask behavioral questions expecting STAR answers (Situation, Task, Action, Result). If the answer lacks a part, probe for it (what was YOUR role, what was the measurable result, what did you learn). ' +
      'Ask one situation at a time and dig for specifics instead of moving on quickly.',
  },
  ai_ml: {
    label: 'AI / ML Engineering',
    topics: ['ML Fundamentals', 'Model Evaluation & Metrics', 'Deep Learning', 'NLP & Transformers', 'LLMs & Prompting',
      'RAG & Vector Databases', 'AI Agents & Tool Use', 'MLOps & Deployment', 'Python for ML', 'Data Pipelines'],
    guidance:
      'Run an AI engineering interview. Start with a concept (bias-variance, overfitting, embeddings, attention, RAG), then move to an applied scenario ' +
      '(why is retrieval returning irrelevant chunks, how would you evaluate this model, how would you serve it under latency limits, how do you detect drift). ' +
      'Probe trade-offs, failure modes, evaluation methodology and production concerns. For interns keep to fundamentals and small applied cases; for full-time roles expect design, evaluation and deployment depth. ' +
      'Use \"board\" only for a short scenario, dataset description or small snippet.',
  },
  sql: {
    label: 'SQL',
    topics: ['Joins', 'Aggregations', 'Subqueries', 'CTEs', 'Window Functions', 'Indexing', 'Query Optimization', 'Transactions'],
    guidance:
      'Pose SQL problems with a small schema. Put table definitions and sample rows in "board" as plain text. Have the candidate describe the query verbally or submit it via [CODE]. ' +
      'Probe correctness (NULLs, duplicates, ties), then performance (indexes, execution plan), then transactions and isolation where relevant.',
  },
};

export const ROLES = {
  'SDE Intern': 'Intern-level software engineer: fundamentals, clear reasoning, learning ability. Do not demand production-scale experience.',
  'SDE FTE': 'Full-time (new grad) software engineer: solid fundamentals plus ownership, optimisation and sound engineering judgement.',
  'AI Engineer Intern': 'Intern-level AI engineer: Python, ML/LLM fundamentals, small applied cases. In every mode lean toward AI-flavoured examples where natural (data handling, model evaluation, embeddings) without abandoning the mode\'s core subject.',
  'AI Engineer FTE': 'Full-time AI engineer: ML/LLM depth, evaluation, RAG and agent design, deployment and monitoring, plus software-engineering rigour. In every mode lean toward AI-flavoured examples where natural without abandoning the mode\'s core subject.',
};
export const POSITIONS = Object.keys(ROLES);
export const LEGACY_POSITIONS = { 'New Grad SDE': 'SDE FTE' };
export const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Mixed'];
export const DURATIONS = [15, 30, 45, 60];

export const STYLES = {
  standard: 'Standard: one main question explored in reasonable depth, plus follow-ups.',
  rapid: 'Rapid-fire: more, shorter questions; keep follow-ups brief; move on quickly after a clear answer.',
  deep: 'Deep-dive: stay on one problem or topic for most of the session and probe it very thoroughly.',
};

export const PERSONALITIES = {
  real: {
    label: 'Real Interviewer',
    prompt:
      'Formal, composed, analytical and challenging, like a senior engineer in a real loop. Acknowledge answers with brief neutral phrases ("Thank you.", "Understood.", "I see.") without praise or correction. ' +
      'Do not teach during the interview. Offer a hint only if the candidate is clearly stuck, and keep it to a small nudge.',
  },
  strict: {
    label: 'Strict Interviewer',
    prompt:
      'Demanding and rigorous, always courteous. Minimal hints: at most one small nudge, and only after the candidate has been stuck for a while. ' +
      'Cross-question extensively, ask for justification and proof, and state flaws directly but professionally ("That step does not hold when the input contains duplicates."). No encouragement or small talk.',
  },
  mentor: {
    label: 'Mentor',
    prompt:
      'Supportive, professional and honest. Let the candidate attempt first. After an attempt, explain mistakes clearly, teach the underlying concept concisely, and suggest concrete optimisations. ' +
      'You may give graded hints when asked or when the candidate is stuck. Still ask follow-ups and keep the session moving.',
  },
};
