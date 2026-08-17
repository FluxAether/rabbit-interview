import { matchResumeKeywords, normalizeResumeText, resumeTextFingerprint } from './resumeOptimizer.ts'
import type { EvidenceBrief, EvidenceBriefSource, EvidenceProject } from './mockInterviewState.ts'

export interface EvidenceWorkspaceHint {
  requirements?: Array<{
    keyword: string
    priority: 'required' | 'preferred'
    status: 'supported' | 'unsupported'
    evidence: string
  }>
  targetKeywords?: string[]
  matchedKeywords?: string[]
  missingKeywords?: string[]
  analysisOriginalFingerprint?: string
  analysisJobDescriptionFingerprint?: string
}

const PROJECT_HEADING = /^(?:项目经历|项目经验|项目|主要项目|代表项目|工作经历|工作经验|实习经历|职业经历|projects?|selected projects?|experience|work experience|professional experience|employment)\s*[:：]?$/i
const SKILL_HEADING = /^(?:专业技能|技能|技术栈|掌握技能|skills?|technical skills?|core skills?|tech stack)\s*[:：]?$/i
const OTHER_HEADING = /^(?:教育|教育经历|education|awards?|certificates?|certifications?|summary|profile|自我评价|个人总结|languages?)\s*[:：]?$/i

export function buildEvidenceBrief(
  resumeText: string,
  jobDescription: string,
  workspace?: EvidenceWorkspaceHint | null,
): EvidenceBrief {
  const resume = normalizeResumeText(resumeText)
  const posting = normalizeResumeText(jobDescription)
  const resumeEmpty = resume.length === 0
  const jobDescriptionEmpty = posting.length === 0
  const workspaceFresh = isWorkspaceFresh(resume, posting, workspace)
  const source: EvidenceBriefSource = resumeEmpty && jobDescriptionEmpty
    ? 'empty'
    : workspaceFresh
      ? 'workspace'
      : 'extracted'

  const projects = resumeEmpty ? [] : extractProjects(resume)
  const localSkills = resumeEmpty ? [] : extractSkills(resume)
  const keywordPlan = resolveKeywords(resume, posting, workspace, workspaceFresh)
  const skills = uniqueStrings([...keywordPlan.overlap, ...localSkills], 16)

  return {
    projects,
    skills,
    jdRequired: keywordPlan.jdRequired,
    jdPreferred: keywordPlan.jdPreferred,
    overlap: keywordPlan.overlap,
    gaps: keywordPlan.gaps,
    resumeEmpty,
    jobDescriptionEmpty,
    source,
  }
}

export function compactEvidenceBrief(brief: EvidenceBrief): string {
  if (brief.source === 'empty') {
    return 'Evidence: none. Resume and job description are empty. Do not invent companies, projects, metrics, or skills.'
  }
  const projects = brief.projects.length
    ? brief.projects.map(project => `- ${project.name}: ${project.summary}${project.skills.length ? ` [${project.skills.join(', ')}]` : ''}`).join('\n')
    : '- none'
  return [
    `Evidence source: ${brief.source}`,
    `Resume empty: ${brief.resumeEmpty}`,
    `Job description empty: ${brief.jobDescriptionEmpty}`,
    'Projects mentioned in the resume (use only these names):',
    projects,
    `Skills: ${brief.skills.join(', ') || 'none'}`,
    `JD required: ${brief.jdRequired.join(', ') || 'none'}`,
    `JD preferred: ${brief.jdPreferred.join(', ') || 'none'}`,
    `Overlap: ${brief.overlap.join(', ') || 'none'}`,
    `JD gaps: ${brief.gaps.join(', ') || 'none'}`,
    'Never invent candidate experience. If a project or skill is not listed, do not name it.',
  ].join('\n')
}

function isWorkspaceFresh(
  resume: string,
  posting: string,
  workspace?: EvidenceWorkspaceHint | null,
): boolean {
  if (!workspace?.analysisOriginalFingerprint || !workspace.analysisJobDescriptionFingerprint) return false
  if (!resume || !posting) return false
  return workspace.analysisOriginalFingerprint === resumeTextFingerprint(resume)
    && workspace.analysisJobDescriptionFingerprint === resumeTextFingerprint(posting)
}

function resolveKeywords(
  resume: string,
  posting: string,
  workspace: EvidenceWorkspaceHint | null | undefined,
  workspaceFresh: boolean,
): { jdRequired: string[]; jdPreferred: string[]; overlap: string[]; gaps: string[] } {
  if (workspaceFresh && workspace) {
    const requirements = workspace.requirements ?? []
    if (requirements.length) {
      return {
        jdRequired: uniqueStrings(requirements.filter(item => item.priority === 'required').map(item => item.keyword), 12),
        jdPreferred: uniqueStrings(requirements.filter(item => item.priority === 'preferred').map(item => item.keyword), 12),
        overlap: uniqueStrings(requirements.filter(item => item.status === 'supported').map(item => item.keyword), 12),
        gaps: uniqueStrings(requirements.filter(item => item.status === 'unsupported').map(item => item.keyword), 12),
      }
    }
    if ((workspace.matchedKeywords?.length || workspace.missingKeywords?.length || workspace.targetKeywords?.length)) {
      const matched = uniqueStrings(workspace.matchedKeywords ?? [], 12)
      const missing = uniqueStrings(workspace.missingKeywords ?? [], 12)
      return {
        jdRequired: uniqueStrings(workspace.targetKeywords ?? [...matched, ...missing], 12),
        jdPreferred: [],
        overlap: matched,
        gaps: missing,
      }
    }
  }

  if (!posting) {
    return { jdRequired: [], jdPreferred: [], overlap: [], gaps: [] }
  }

  const matched = matchResumeKeywords(resume, posting)
  const classified = classifyJobKeywords(posting, [...matched.matchedKeywords, ...matched.missingKeywords])
  return {
    jdRequired: classified.required,
    jdPreferred: classified.preferred,
    overlap: matched.matchedKeywords,
    gaps: matched.missingKeywords,
  }
}

function classifyJobKeywords(posting: string, keywords: string[]): { required: string[]; preferred: string[] } {
  const required: string[] = []
  const preferred: string[] = []
  for (const keyword of keywords) {
    const line = posting.split(/\r?\n/).find(item => item.toLocaleLowerCase().includes(keyword.toLocaleLowerCase())) || posting
    const isPreferred = /\b(?:preferred|nice[- ]to[- ]have|bonus|ideally|plus)\b|优先/.test(line)
    if (isPreferred) preferred.push(keyword)
    else required.push(keyword)
  }
  return {
    required: uniqueStrings(required, 12),
    preferred: uniqueStrings(preferred, 12),
  }
}

function extractProjects(resume: string): EvidenceProject[] {
  const blocks = collectSectionBlocks(resume, PROJECT_HEADING)
  const source = blocks.length ? blocks.join('\n') : resume
  const projects: EvidenceProject[] = []
  let current: { name: string; lines: string[] } | null = null

  const flush = () => {
    if (!current) return
    const summary = current.lines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 220)
    if (!summary && current.name.length < 2) return
    projects.push({
      name: current.name.slice(0, 80),
      summary: summary || current.name,
      skills: inferProjectSkills(summary),
      source: 'resume',
    })
    current = null
  }

  for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/^•\s*/, '').trim()
    if (!line || SKILL_HEADING.test(line) || OTHER_HEADING.test(line) || PROJECT_HEADING.test(line)) {
      if (SKILL_HEADING.test(line) || OTHER_HEADING.test(line)) flush()
      continue
    }
    if (looksLikeProjectTitle(line)) {
      flush()
      current = { name: stripTitleDecor(line), lines: [] }
      continue
    }
    if (!current && line.length >= 8) {
      current = { name: inferNameFromLine(line), lines: [line] }
      continue
    }
    if (current && current.lines.length < 4) current.lines.push(line)
  }
  flush()
  return projects.slice(0, 6)
}

function extractSkills(resume: string): string[] {
  const blocks = collectSectionBlocks(resume, SKILL_HEADING)
  if (!blocks.length) return []
  const tokens: string[] = []
  for (const block of blocks) {
    for (const token of block.split(/[,，、;；|/]+/)) {
      const skill = token.replace(/^•\s*/, '').trim()
      if (skill.length < 2 || skill.length > 32 || PROJECT_HEADING.test(skill) || OTHER_HEADING.test(skill)) continue
      if (/^(?:and|with|including)$/i.test(skill)) continue
      tokens.push(skill)
    }
  }
  return uniqueStrings(tokens, 16)
}

function collectSectionBlocks(text: string, heading: RegExp): string[] {
  const lines = text.split('\n')
  const blocks: string[] = []
  let collecting = false
  let current: string[] = []
  const finish = () => {
    if (current.length) blocks.push(current.join('\n'))
    current = []
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (heading.test(trimmed)) {
      finish()
      collecting = true
      continue
    }
    if (collecting && (OTHER_HEADING.test(trimmed) || PROJECT_HEADING.test(trimmed) || SKILL_HEADING.test(trimmed))) {
      if (!heading.test(trimmed)) {
        finish()
        collecting = false
      }
      continue
    }
    if (collecting) current.push(trimmed)
  }
  finish()
  return blocks.filter(Boolean)
}

function looksLikeProjectTitle(line: string): boolean {
  if (line.length > 80) return false
  if (/[。？?]$/.test(line)) return false
  return /(?:\d{4}|项目|系统|平台|中台|App|SDK|API|服务|工程|website|platform|system)/i.test(line)
    || /[|·•—–-]/.test(line)
    || (/^[A-Z0-9][\w .+/#-]{2,40}$/.test(line) && line.split(' ').length <= 8)
}

function stripTitleDecor(line: string): string {
  return line.replace(/\s*[|·•—–-]\s*(?:\d{4}.*)?$/, '').replace(/\s+\d{4}.*$/, '').trim() || line.trim()
}

function inferNameFromLine(line: string): string {
  const clipped = line.split(/[，。,:：]/)[0]?.trim() || line
  return clipped.slice(0, 48)
}

function inferProjectSkills(summary: string): string[] {
  const tokens = summary.match(/[A-Za-z][A-Za-z0-9+#.-]{1,}|[\p{Script=Han}]{2,8}/gu) ?? []
  return uniqueStrings(tokens.filter(token => token.length >= 2 && token.length <= 24), 6)
}

function uniqueStrings(values: string[], limit: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
    if (result.length >= limit) break
  }
  return result
}
