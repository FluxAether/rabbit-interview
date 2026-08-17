import type {
  EvidenceBrief,
  InterviewPlan,
  InterviewSlot,
  MockInterviewConfig,
  MockInterviewDifficulty,
  MockInterviewStage,
  MockInterviewType,
} from './mockInterviewState.ts'
import { maxFollowUpsSession } from './mockInterviewState.ts'

interface CompetencySeed {
  competency: string
  stage: Extract<MockInterviewStage, 'behavioral' | 'technical'>
  focus: string
}

const BEHAVIORAL_SEEDS: CompetencySeed[] = [
  { competency: 'ownership', stage: 'behavioral', focus: 'Probe a time the candidate owned an outcome end to end, including what they personally decided.' },
  { competency: 'collaboration', stage: 'behavioral', focus: 'Probe how the candidate worked across roles when goals or information were incomplete.' },
  { competency: 'conflict-resolution', stage: 'behavioral', focus: 'Probe a disagreement and how the candidate resolved it without blaming others.' },
  { competency: 'communication', stage: 'behavioral', focus: 'Probe how the candidate explained a complex situation to a non-expert stakeholder.' },
  { competency: 'execution-under-pressure', stage: 'behavioral', focus: 'Probe delivery under a hard deadline and what they cut or protected.' },
  { competency: 'stakeholder-management', stage: 'behavioral', focus: 'Probe competing stakeholder requests and how the candidate set expectations.' },
  { competency: 'learning-agility', stage: 'behavioral', focus: 'Probe a skill they had to learn quickly and how they validated they were doing it right.' },
  { competency: 'leadership', stage: 'behavioral', focus: 'Probe influence without formal authority, including who changed course and why.' },
]

const TECHNICAL_SEEDS: CompetencySeed[] = [
  { competency: 'problem-solving', stage: 'technical', focus: 'Probe how the candidate framed a hard problem, what options they considered, and why they chose one.' },
  { competency: 'technical-depth', stage: 'technical', focus: 'Probe a concrete implementation detail from their stack, including constraints and failure modes.' },
  { competency: 'debugging', stage: 'technical', focus: 'Probe a production or integration failure and the evidence they used to isolate it.' },
  { competency: 'tradeoff-analysis', stage: 'technical', focus: 'Probe a design or implementation tradeoff, including what they gave up and why.' },
  { competency: 'system-design', stage: 'technical', focus: 'Probe how they would design or extend a system for scale, reliability, or change.' },
  { competency: 'code-quality', stage: 'technical', focus: 'Probe how they keep changes reviewable, testable, and safe to ship.' },
  { competency: 'reliability', stage: 'technical', focus: 'Probe monitoring, rollback, or incident response around a system they touched.' },
  { competency: 'architecture', stage: 'technical', focus: 'Probe how they split responsibilities across services or modules and what coupling they accepted.' },
]

const DIFFICULTY_HINT: Record<MockInterviewDifficulty, string> = {
  junior: 'Keep the question concrete and check fundamentals, learning, and specific examples rather than strategy.',
  mid: 'Expect independent ownership, explicit tradeoffs, and measurable outcomes.',
  senior: 'Push on scope, influence, second-order effects, and system-level judgment.',
}

export function normalizePrimaryCount(count: number): 5 | 8 | 10 {
  if (count >= 10) return 10
  if (count >= 8) return 8
  return 5
}

export function buildInterviewPlan(config: MockInterviewConfig, brief: EvidenceBrief): InterviewPlan {
  const primaryCount = normalizePrimaryCount(config.questionCount)
  const coreCount = primaryCount - 2
  const cores = selectCoreSeeds(config.interviewType, config.difficulty, coreCount, brief)
  const slots: InterviewSlot[] = [
    buildSlot(1, {
      stage: 'introduction',
      competency: 'self-introduction',
      focus: introductionFocus(config, brief),
      evidenceRefs: evidenceRefsForIntro(brief),
      allowFollowUp: false,
    }),
    ...cores.map((seed, index) => buildSlot(index + 2, {
      stage: seed.stage,
      competency: seed.competency,
      focus: `${seed.focus} ${DIFFICULTY_HINT[config.difficulty]} ${bindEvidenceFocus(seed, brief)}`.trim(),
      evidenceRefs: evidenceRefsForSeed(seed, brief, index),
      allowFollowUp: true,
    })),
    buildSlot(primaryCount, {
      stage: 'conclusion',
      competency: 'closing',
      focus: conclusionFocus(config, brief),
      evidenceRefs: brief.gaps.slice(0, 2).map(gap => `gap:${gap}`),
      allowFollowUp: false,
    }),
  ]

  return {
    primaryCount,
    maxFollowUpsPerPrimary: 1,
    maxFollowUpsSession: maxFollowUpsSession(primaryCount),
    slots,
    brief,
  }
}

function buildSlot(sequence: number, input: Omit<InterviewSlot, 'id' | 'sequence'>): InterviewSlot {
  return { id: `slot-${sequence}`, sequence, ...input }
}

function selectCoreSeeds(
  interviewType: MockInterviewType,
  difficulty: MockInterviewDifficulty,
  coreCount: number,
  brief: EvidenceBrief,
): CompetencySeed[] {
  const behavioral = rotateSeeds(BEHAVIORAL_SEEDS, difficulty)
  const technical = rotateSeeds(rankTechnicalSeeds(TECHNICAL_SEEDS, difficulty, brief), difficulty)
  if (interviewType === 'behavioral') return behavioral.slice(0, coreCount)
  if (interviewType === 'technical') return technical.slice(0, coreCount)

  const mixed: CompetencySeed[] = []
  for (let index = 0; index < coreCount; index += 1) {
    mixed.push(index % 2 === 0
      ? technical[Math.floor(index / 2) % technical.length]
      : behavioral[Math.floor(index / 2) % behavioral.length])
  }
  return mixed
}

function rotateSeeds(seeds: CompetencySeed[], difficulty: MockInterviewDifficulty): CompetencySeed[] {
  const offset = difficulty === 'senior' ? 2 : difficulty === 'mid' ? 1 : 0
  return seeds.map((_, index) => seeds[(index + offset) % seeds.length])
}

function rankTechnicalSeeds(
  seeds: CompetencySeed[],
  difficulty: MockInterviewDifficulty,
  brief: EvidenceBrief,
): CompetencySeed[] {
  const preferred = difficulty === 'junior'
    ? ['debugging', 'problem-solving', 'technical-depth', 'code-quality']
    : difficulty === 'senior'
      ? ['system-design', 'architecture', 'tradeoff-analysis', 'reliability']
      : ['technical-depth', 'tradeoff-analysis', 'problem-solving', 'debugging']
  const hasStack = brief.overlap.length > 0 || brief.skills.length > 0
  return [...seeds].sort((left, right) => {
    const leftScore = preferred.indexOf(left.competency)
    const rightScore = preferred.indexOf(right.competency)
    const leftRank = leftScore === -1 ? 50 : leftScore
    const rightRank = rightScore === -1 ? 50 : rightScore
    if (left.competency === 'technical-depth' && hasStack) return -1
    if (right.competency === 'technical-depth' && hasStack) return 1
    return leftRank - rightRank
  })
}

function introductionFocus(config: MockInterviewConfig, brief: EvidenceBrief): string {
  if (brief.resumeEmpty) {
    return `Ask for a concise self-introduction aimed at ${config.role}${config.company ? ` at ${config.company}` : ''}. Do not mention any specific project, company, or metric that is not supplied.`
  }
  const names = brief.projects.slice(0, 2).map(project => project.name).join(', ')
  return `Ask the candidate to introduce themselves for ${config.role}, using only resume-backed work${names ? ` such as ${names}` : ''}.`
}

function conclusionFocus(config: MockInterviewConfig, brief: EvidenceBrief): string {
  const gap = brief.gaps[0]
  if (gap) {
    return `Close the interview for ${config.role}. If useful, ask how they would ramp on ${gap} without claiming they already have that experience.`
  }
  return `Close the interview for ${config.role}. Ask a short motivation or wrap-up question, then invite the candidate's questions.`
}

function bindEvidenceFocus(seed: CompetencySeed, brief: EvidenceBrief): string {
  if (brief.resumeEmpty && seed.competency === 'technical-depth' && brief.jdRequired[0]) {
    return `The resume is empty. Ask a role-generic question about ${brief.jdRequired[0]}; do not invent a past project.`
  }
  if (seed.competency === 'technical-depth') {
    const skill = brief.overlap[0] || brief.skills[0]
    return skill ? `Ground the question in ${skill} only if that skill appears in the evidence brief.` : ''
  }
  if (seed.competency === 'system-design' || seed.competency === 'architecture') {
    const project = brief.projects[0]
    return project ? `If you mention prior work, use only ${project.name}.` : 'Keep the prompt hypothetical if no project is listed.'
  }
  if (!brief.resumeEmpty && brief.projects[0]) {
    return `If you mention prior work, use only listed projects.`
  }
  return ''
}

function evidenceRefsForIntro(brief: EvidenceBrief): string[] {
  return brief.projects.slice(0, 2).map(project => `project:${project.name}`)
}

function evidenceRefsForSeed(seed: CompetencySeed, brief: EvidenceBrief, index: number): string[] {
  const refs: string[] = []
  if (seed.competency === 'technical-depth') {
    const skill = brief.overlap[0] || brief.skills[0]
    if (skill) refs.push(`skill:${skill}`)
  }
  const project = brief.projects[index % Math.max(brief.projects.length, 1)]
  if (project && !brief.resumeEmpty) refs.push(`project:${project.name}`)
  if (seed.stage === 'technical' && brief.gaps[0] && index === 0) refs.push(`gap:${brief.gaps[0]}`)
  return uniqueRefs(refs)
}

function uniqueRefs(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, 4)
}
