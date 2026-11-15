export type CommitCategory =
  | 'Architecture'
  | 'Feature'
  | 'Performance'
  | 'Refactor'
  | 'Bugfix';

export interface FileSnapshot {
  path: string;
  language: 'typescript' | 'rust' | 'go' | 'sql' | 'json';
  content: string;
  previousContent?: string;
  status: 'added' | 'modified' | 'deleted' | 'unchanged';
}

export interface ArchitectureModule {
  id: string;
  name: string;
  layer: 'client' | 'edge' | 'core' | 'storage';
  description: string;
  status: 'existing' | 'added' | 'modified' | 'deprecated';
  metrics?: string;
}

export interface ArchitectureEdge {
  from: string;
  to: string;
  protocol: string;
  isNew?: boolean;
}

export interface ArchitecturalDecision {
  id: string;
  title: string;
  problemStatement: string;
  decisionSummary: string;
  tradeoffs: string[];
  measurableOutcome: string;
  modules: ArchitectureModule[];
  edges: ArchitectureEdge[];
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  parentSha: string | null;
  branch: string;
  tag?: string;
  title: string;
  message: string;
  author: string;
  authorRole: string;
  timestamp: string;
  relativeTime: string;
  category: CommitCategory;
  isArchitecturalMilestone: boolean;
  files: FileSnapshot[];
  adr: ArchitecturalDecision;
  diffLoaded?: boolean;
  diffLoading?: boolean;
  diffError?: string;
}

export interface GitHubRepoMeta {
  owner: string;
  repo: string;
  filterPath?: string;
  since?: string;
  until?: string;
  tagFrom?: string;
  tagTo?: string;
  milestonesOnly?: boolean;
  nextPage: number;
  hasMore: boolean;
}

export interface GitRepository {
  id: string;
  name: string;
  owner: string;
  description: string;
  defaultBranch: string;
  primaryLanguage: string;
  commits: GitCommit[];
  githubMeta?: GitHubRepoMeta;
}

export interface DiffLine {
  type: 'context' | 'add' | 'del';
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
}

export interface BlameLineInfo {
  lineNumber: number;
  content: string;
  commitSha: string;
  shortSha: string;
  author: string;
  timestamp: string;
  commitTitle: string;
  category: CommitCategory;
}

export interface AIAnalysisResult {
  summary: string;
  architecturalIntent: string;
  impactScore: 'Low' | 'Moderate' | 'High' | 'Critical';
  keyChanges: string[];
  risksAndTradeoffs: string[];
  suggestedQuestions: string[];
  detectedPatterns: string[];
}

