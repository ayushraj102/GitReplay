import {
  DiffLine,
  BlameLineInfo,
  GitCommit,
  GitRepository,
  CommitCategory,
  ArchitectureModule,
} from '../types/git';

/**
 * Computes a line-by-line Longest Common Subsequence (LCS) unified diff
 * between two strings of source code.
 */
export function computeLineDiff(oldText: string = '', newText: string = ''): DiffLine[] {
  const oldLines = oldText === '' ? [] : oldText.split('\n');
  const newLines = newText === '' ? [] : newText.split('\n');

  const m = oldLines.length;
  const n = newLines.length;

  // Guard for very large files from external GitHub imports
  if (m * n > 250000) {
    const fallback: DiffLine[] = [];
    const maxLen = Math.max(m, n);
    for (let i = 0; i < maxLen; i++) {
      if (i < m && i < n && oldLines[i] === newLines[i]) {
        fallback.push({
          type: 'context',
          oldLineNumber: i + 1,
          newLineNumber: i + 1,
          content: oldLines[i],
        });
      } else {
        if (i < m) {
          fallback.push({
            type: 'del',
            oldLineNumber: i + 1,
            newLineNumber: null,
            content: oldLines[i],
          });
        }
        if (i < n) {
          fallback.push({
            type: 'add',
            oldLineNumber: null,
            newLineNumber: i + 1,
            content: newLines[i],
          });
        }
      }
    }
    return fallback;
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldLineNum = 1;
  let newLineNum = 1;

  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      result.push({
        type: 'context',
        oldLineNumber: oldLineNum++,
        newLineNumber: newLineNum++,
        content: oldLines[i],
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({
        type: 'del',
        oldLineNumber: oldLineNum++,
        newLineNumber: null,
        content: oldLines[i],
      });
      i++;
    } else {
      result.push({
        type: 'add',
        oldLineNumber: null,
        newLineNumber: newLineNum++,
        content: newLines[j],
      });
      j++;
    }
  }

  while (i < m) {
    result.push({
      type: 'del',
      oldLineNumber: oldLineNum++,
      newLineNumber: null,
      content: oldLines[i++],
    });
  }

  while (j < n) {
    result.push({
      type: 'add',
      oldLineNumber: null,
      newLineNumber: newLineNum++,
      content: newLines[j++],
    });
  }

  return result;
}

/**
 * Computes diff stats (+additions / -deletions) for a file or commit
 */
export function computeDiffStats(oldText: string = '', newText: string = '') {
  const diff = computeLineDiff(oldText, newText);
  let additions = 0;
  let deletions = 0;
  for (const line of diff) {
    if (line.type === 'add') additions++;
    if (line.type === 'del') deletions++;
  }
  return { additions, deletions, totalChanges: additions + deletions };
}

/**
 * Computes line-level blame history across commits up to targetCommitIndex
 */
export function computeFileBlame(
  commits: GitCommit[],
  targetCommitIndex: number,
  filePath: string
): BlameLineInfo[] {
  const targetCommit = commits[targetCommitIndex];
  if (!targetCommit) return [];

  const targetFile = targetCommit.files.find((f) => f.path === filePath);
  if (!targetFile || !targetFile.content) return [];

  const currentLines = targetFile.content.split('\n');

  // Track which commit last touched each line content
  const lineOriginMap = new Map<string, GitCommit>();

  for (let idx = 0; idx <= targetCommitIndex; idx++) {
    const commit = commits[idx];
    const file = commit.files.find((f) => f.path === filePath);
    if (!file) continue;

    const prevContent = file.previousContent ?? '';
    const diff = computeLineDiff(prevContent, file.content);
    for (const d of diff) {
      if (d.type === 'add' || (idx === 0 && d.type === 'context')) {
        lineOriginMap.set(d.content.trim(), commit);
      }
    }
  }

  return currentLines.map((lineText, idx) => {
    const originCommit = lineOriginMap.get(lineText.trim()) || commits[0] || targetCommit;
    return {
      lineNumber: idx + 1,
      content: lineText,
      commitSha: originCommit.sha,
      shortSha: originCommit.shortSha,
      author: originCommit.author,
      timestamp: originCommit.timestamp,
      commitTitle: originCommit.title,
      category: originCommit.category,
    };
  });
}

/**
 * Infers a CommitCategory from a commit message
 */
export function inferCommitCategory(message: string): CommitCategory {
  const lower = message.toLowerCase();
  if (
    lower.includes('arch') ||
    lower.includes('migrate') ||
    lower.includes('engine') ||
    lower.includes('protocol') ||
    lower.includes('schema')
  ) {
    return 'Architecture';
  }
  if (lower.includes('perf') || lower.includes('optim') || lower.includes('cache') || lower.includes('batch')) {
    return 'Performance';
  }
  if (lower.includes('refactor') || lower.includes('clean') || lower.includes('extract')) {
    return 'Refactor';
  }
  if (lower.includes('fix') || lower.includes('bug') || lower.includes('patch') || lower.includes('resolve')) {
    return 'Bugfix';
  }
  return 'Feature';
}

/**
 * Infers an architecture layer from a file path so imported commits land in logical layers
 */
export function inferModuleLayer(filePath: string): ArchitectureModule['layer'] {
  const lower = filePath.toLowerCase();
  if (
    lower.includes('storage') ||
    lower.includes('store') ||
    lower.includes('db') ||
    lower.includes('sql') ||
    lower.includes('redis') ||
    lower.includes('wal') ||
    lower.includes('cache') ||
    lower.includes('index') ||
    lower.includes('repo') ||
    lower.includes('persist')
  ) {
    return 'storage';
  }
  if (
    lower.includes('api') ||
    lower.includes('http') ||
    lower.includes('ws') ||
    lower.includes('socket') ||
    lower.includes('transport') ||
    lower.includes('router') ||
    lower.includes('route') ||
    lower.includes('proxy') ||
    lower.includes('gateway') ||
    lower.includes('edge') ||
    lower.includes('server') ||
    lower.includes('broker')
  ) {
    return 'edge';
  }
  if (
    lower.includes('client') ||
    lower.includes('ui') ||
    lower.includes('component') ||
    lower.includes('view') ||
    lower.includes('page') ||
    lower.includes('hook') ||
    lower.includes('parser') ||
    lower.includes('planner') ||
    lower.includes('cli')
  ) {
    return 'client';
  }
  return 'core';
}

/**
 * Parses a raw `git log -p` string into a playable GitRepository
 */
export function parseRawGitLog(rawLog: string, repoName = 'custom/git-log-replay'): GitRepository {
  const commitBlocks = rawLog.split(/(?=^commit [0-9a-f]{7,40})/m).filter((b) => b.trim().length > 0);
  const parsedCommits: GitCommit[] = [];

  commitBlocks.forEach((block, idx) => {
    const lines = block.split('\n');
    const shaMatch = lines[0]?.match(/^commit ([0-9a-f]{7,40})/i);
    const sha = shaMatch ? shaMatch[1] : `c0ffee${idx}9a8b7c6d5e4f`;
    const shortSha = sha.slice(0, 7);

    const authorLine = lines.find((l) => l.startsWith('Author:'));
    const author = authorLine
      ? authorLine.replace('Author:', '').replace(/<.*>/, '').trim()
      : 'Developer';

    const dateLine = lines.find((l) => l.startsWith('Date:'));
    const timestamp = dateLine ? dateLine.replace('Date:', '').trim() : new Date().toISOString().slice(0, 16).replace('T', ' ');

    // Find commit title and message
    const emptyLineIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '');
    let title = `Commit #${idx + 1}`;
    let messageBody = '';
    if (emptyLineIdx !== -1) {
      const msgLines: string[] = [];
      for (let i = emptyLineIdx + 1; i < lines.length; i++) {
        if (lines[i].startsWith('diff --git')) break;
        if (lines[i].trim() !== '') msgLines.push(lines[i].trim());
      }
      if (msgLines.length > 0) {
        title = msgLines[0];
        messageBody = msgLines.slice(1).join(' ');
      }
    }

    // Extract diffs per file
    const diffSections = block.split(/^diff --git /m).slice(1);
    const files = diffSections.map((section, fIdx) => {
      const sectionLines = section.split('\n');
      const headerMatch = sectionLines[0]?.match(/a\/(\S+)\s+b\/(\S+)/);
      const path = headerMatch ? headerMatch[2] : `src/module_${fIdx + 1}.ts`;

      const oldContentLines: string[] = [];
      const newContentLines: string[] = [];

      let inHunk = false;
      for (const line of sectionLines) {
        if (line.startsWith('@@')) {
          inHunk = true;
          continue;
        }
        if (!inHunk) continue;
        if (line.startsWith('+')) {
          newContentLines.push(line.slice(1));
        } else if (line.startsWith('-')) {
          oldContentLines.push(line.slice(1));
        } else if (line.startsWith(' ') || line === '') {
          const clean = line.startsWith(' ') ? line.slice(1) : line;
          oldContentLines.push(clean);
          newContentLines.push(clean);
        }
      }

      return {
        path,
        language: 'typescript' as const,
        previousContent: oldContentLines.join('\n'),
        content: newContentLines.join('\n'),
        status: (oldContentLines.length === 0 ? 'added' : 'modified') as 'added' | 'modified',
      };
    });

    if (files.length === 0) {
      files.push({
        path: 'src/index.ts',
        language: 'typescript',
        previousContent: `export const version = "${idx}";`,
        content: `export const version = "${idx + 1}";\n// ${title}`,
        status: 'modified',
      });
    }

    const category = inferCommitCategory(title + ' ' + messageBody);

    parsedCommits.push({
      sha,
      shortSha,
      parentSha: idx > 0 ? parsedCommits[idx - 1].sha : null,
      branch: 'main',
      title,
      message: messageBody || title,
      author,
      authorRole: 'Contributor',
      timestamp,
      relativeTime: `Step ${idx + 1}`,
      category,
      isArchitecturalMilestone: category === 'Architecture' || category === 'Performance' || idx === 0,
      files,
      adr: {
        id: `ADR-${String(idx + 1).padStart(2, '0')}`,
        title,
        problemStatement: messageBody || `Codebase state prior to ${shortSha} required ${category.toLowerCase()} updates.`,
        decisionSummary: `Applied changes across ${files.length} file(s) in commit ${shortSha}.`,
        tradeoffs: [
          `Modified ${files.map((f) => f.path).join(', ')}`,
          'Preserved backward compatibility across existing module boundaries',
        ],
        measurableOutcome: `${files.length} file(s) updated in timeline step ${idx + 1}`,
        modules: files.map((f, i) => ({
          id: `mod-${i}`,
          name: f.path.split('/').pop() || f.path,
          layer: inferModuleLayer(f.path),
          description: f.path,
          status: f.status === 'added' ? 'added' : 'modified',
        })),
        edges:
          files.length > 1
            ? [
                {
                  from: 'mod-0',
                  to: 'mod-1',
                  protocol: 'import',
                  isNew: true,
                },
              ]
            : [],
      },
    });
  });

  // Reverse if git log was newest-first so playback runs chronologically oldest -> newest
  const chronological = parsedCommits.length > 1 ? parsedCommits.reverse() : parsedCommits;
  chronological.forEach((c, i) => {
    c.parentSha = i > 0 ? chronological[i - 1].sha : null;
    c.adr.id = `ADR-${String(i + 1).padStart(2, '0')}`;
  });

  const [owner, name] = repoName.includes('/') ? repoName.split('/') : ['local', repoName];

  return {
    id: `custom-${Date.now()}`,
    owner,
    name,
    description: 'Imported Git log history transformed into an interactive chronological replay.',
    defaultBranch: 'main',
    primaryLanguage: 'TypeScript',
    commits: chronological,
  };
}
