import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  FileCode,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  History,
  Copy,
  Check,
  ChevronsUpDown,
  ArrowUpRight,
  GitCompare,
  RotateCcw,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { GitCommit, BlameLineInfo, DiffLine } from '../types/git';
import { computeLineDiff, computeDiffStats, computeFileBlame } from '../utils/gitEngine';

interface CodeViewerProps {
  commits: GitCommit[];
  activeCommitIndex: number;
  baseCommitIndex: number | null;
  selectedFilePath: string;
  onSelectFile: (path: string) => void;
  onJumpToCommitSha: (sha: string) => void;
  onTogglePinBase: (index: number | null) => void;
  onRetryLoadDiff?: (commitSha: string) => void;
}

type DiffLayout = 'unified' | 'split';

interface DiffBlock {
  kind: 'lines' | 'collapsed';
  lines: DiffLine[];
  blockId: string;
}

/**
 * Collapses long runs (> 6 lines) of unchanged context lines into expandable blocks
 */
function groupDiffBlocks(diffLines: DiffLine[], showAll: boolean): DiffBlock[] {
  if (showAll || diffLines.length <= 14) {
    return [{ kind: 'lines', lines: diffLines, blockId: 'all' }];
  }

  const blocks: DiffBlock[] = [];
  let i = 0;

  while (i < diffLines.length) {
    if (diffLines[i].type !== 'context') {
      const start = i;
      while (i < diffLines.length && diffLines[i].type !== 'context') {
        i++;
      }
      blocks.push({
        kind: 'lines',
        lines: diffLines.slice(start, i),
        blockId: `chg-${start}`,
      });
    } else {
      const start = i;
      while (i < diffLines.length && diffLines[i].type === 'context') {
        i++;
      }
      const run = diffLines.slice(start, i);
      if (run.length <= 6) {
        blocks.push({ kind: 'lines', lines: run, blockId: `ctx-${start}` });
      } else {
        const keepLeading = start === 0 ? 0 : 2;
        const keepTrailing = i === diffLines.length ? 0 : 2;

        if (keepLeading > 0) {
          blocks.push({
            kind: 'lines',
            lines: run.slice(0, keepLeading),
            blockId: `ctx-lead-${start}`,
          });
        }

        const middle = run.slice(keepLeading, run.length - keepTrailing);
        if (middle.length > 0) {
          blocks.push({
            kind: 'collapsed',
            lines: middle,
            blockId: `col-${start}`,
          });
        }

        if (keepTrailing > 0) {
          blocks.push({
            kind: 'lines',
            lines: run.slice(run.length - keepTrailing),
            blockId: `ctx-trail-${start}`,
          });
        }
      }
    }
  }

  return blocks;
}

/**
 * Builds a concise plain-English summary of what the selected file does in this revision.
 */
function summarizeFilePurpose(
  filePath: string,
  fileStatus: string,
  content: string,
  commit: GitCommit,
  additions: number,
  deletions: number
): string {
  const symbolMatches = Array.from(
    content.matchAll(/export\s+(?:class|interface|type|function|const|enum)\s+([A-Za-z0-9_]+)/g)
  )
    .map((m) => m[1])
    .slice(0, 4);

  const fileName = filePath.split('/').pop() || filePath;
  const matchingModule = (commit.adr?.modules || []).find(
    (m) =>
      filePath.toLowerCase().includes(m.name.toLowerCase().split(' ')[0]) ||
      m.description.toLowerCase().includes(fileName.toLowerCase())
  );

  const roleClause = matchingModule
    ? `${fileName} implements ${matchingModule.name} (${matchingModule.description.toLowerCase()}).`
    : commit.adr?.decisionSummary || commit.message;

  const symbolClause =
    symbolMatches.length > 0
      ? ` Exports ${symbolMatches.join(', ')}.`
      : '';

  const deltaClause =
    fileStatus === 'added'
      ? ` Introduced in ${commit.shortSha} (+${additions} lines).`
      : ` Updated in ${commit.shortSha} (+${additions} / -${deletions} lines).`;

  return `${roleClause}${symbolClause}${deltaClause}`;
}

export const CodeViewer: React.FC<CodeViewerProps> = ({
  commits,
  activeCommitIndex,
  baseCommitIndex,
  selectedFilePath,
  onSelectFile,
  onJumpToCommitSha,
  onTogglePinBase,
  onRetryLoadDiff,
}) => {
  const [diffLayout, setDiffLayout] = useState<DiffLayout>('unified');
  const [blameMode, setBlameMode] = useState<boolean>(false);
  const [expandAllContext, setExpandAllContext] = useState<boolean>(false);
  const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({});
  const [selectedBlameLine, setSelectedBlameLine] = useState<BlameLineInfo | null>(null);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [fileSummaryOpen, setFileSummaryOpen] = useState<boolean>(true);

  const [fileMenuOpen, setFileMenuOpen] = useState<boolean>(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState<boolean>(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setFileMenuOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const activeCommit = commits[activeCommitIndex];
  const baseCommit = baseCommitIndex !== null ? commits[baseCommitIndex] : null;
  const files = activeCommit?.files || [];
  const currentFile = files.find((f) => f.path === selectedFilePath) || files[0];

  useEffect(() => {
    setExpandedBlocks({});
    setSelectedBlameLine(null);
  }, [activeCommitIndex, currentFile?.path]);

  const oldContent = useMemo(() => {
    if (!currentFile) return '';
    if (baseCommit) {
      const baseFile = baseCommit.files.find((f) => f.path === currentFile.path);
      return baseFile ? baseFile.content : '';
    }
    return currentFile.previousContent ?? '';
  }, [currentFile, baseCommit]);

  const newContent = currentFile?.content ?? '';

  const diffLines = useMemo(
    () => computeLineDiff(oldContent, newContent),
    [oldContent, newContent]
  );

  const fileStats = useMemo(
    () => computeDiffStats(oldContent, newContent),
    [oldContent, newContent]
  );

  const blocks = useMemo(
    () => groupDiffBlocks(diffLines, expandAllContext),
    [diffLines, expandAllContext]
  );

  const blameLines = useMemo(() => {
    if (!currentFile || !blameMode) return [];
    return computeFileBlame(commits, activeCommitIndex, currentFile.path);
  }, [commits, activeCommitIndex, currentFile, blameMode]);

  const fileSummaryText = useMemo(() => {
    if (!currentFile || !activeCommit) return '';
    return summarizeFilePurpose(
      currentFile.path,
      currentFile.status,
      newContent,
      activeCommit,
      fileStats.additions,
      fileStats.deletions
    );
  }, [currentFile, activeCommit, newContent, fileStats]);

  const handleCopyCode = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(newContent);
      }
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // Clipboard API may be blocked inside sandboxed iframes
    } finally {
      setMoreMenuOpen(false);
    }
  };

  if (activeCommit?.diffLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-12 text-center bg-[var(--gr-bg)]">
        <div className="space-y-2.5 max-w-sm">
          <Loader2 className="w-7 h-7 text-[var(--gr-accent-text)] animate-spin mx-auto" />
          <div className="text-[14px] font-medium text-[var(--gr-text)]">
            Loading commit diff ({activeCommit.shortSha})...
          </div>
          <p className="text-[12px] text-[var(--gr-muted)]">
            Fetching changed files lazily from GitHub API and caching locally.
          </p>
        </div>
      </div>
    );
  }

  if (activeCommit?.diffError) {
    return (
      <div className="flex-1 flex items-center justify-center p-12 text-center bg-[var(--gr-bg)]">
        <div className="space-y-3 max-w-md p-5 rounded-xl bg-[var(--gr-danger-bg)] border border-[var(--gr-danger-border)] text-[var(--gr-danger-text)]">
          <AlertCircle className="w-6 h-6 mx-auto" />
          <div className="text-[14px] font-semibold">Unable to load commit diff</div>
          <p className="text-[12px] leading-relaxed">{activeCommit.diffError}</p>
          {onRetryLoadDiff && (
            <button
              type="button"
              onClick={() => onRetryLoadDiff(activeCommit.sha)}
              className="px-3 py-1.5 rounded-lg bg-[var(--gr-surface)] border border-[var(--gr-danger-border)] text-[var(--gr-text)] text-[12px] font-medium inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!currentFile) {
    return (
      <div className="flex-1 flex items-center justify-center p-12 text-center bg-[var(--gr-bg)]">
        <div className="space-y-2 max-w-sm">
          <FileCode className="w-8 h-8 text-[var(--gr-muted)] mx-auto" />
          <div className="text-[14px] font-medium text-[var(--gr-text)]">
            No code changes in this commit
          </div>
          <p className="text-[12px] text-[var(--gr-muted)]">
            Select another commit on the timeline above to inspect file diffs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--gr-bg)]">
      {/* File Header + Diff Controls */}
      <div className="px-5 py-3 bg-[var(--gr-surface)] border-b border-[var(--gr-border)] flex flex-wrap items-center justify-between gap-3">
        {/* File List: Compact buttons when <= 3 files, clean dropdown when > 3 files */}
        <div className="flex items-center gap-2 min-w-0">
          {files.length <= 3 ? (
            <div className="flex items-center gap-1 overflow-x-auto">
              {files.map((file) => {
                const isSelected = file.path === currentFile.path;
                const stats = computeDiffStats(file.previousContent ?? '', file.content);
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => onSelectFile(file.path)}
                    className={`h-8 px-3 rounded-lg text-[12px] font-mono flex items-center gap-2 transition-colors duration-150 ease-out whitespace-nowrap shrink-0 cursor-pointer border ${
                      isSelected
                        ? 'bg-[var(--gr-surface-elevated)] text-[var(--gr-text)] border-[var(--gr-border-strong)] font-medium'
                        : 'bg-transparent text-[var(--gr-muted)] border-transparent hover:text-[var(--gr-text)] hover:bg-[var(--gr-surface-elevated)]/60'
                    }`}
                  >
                    <span className="truncate max-w-[200px]">{file.path}</span>
                    <span className="text-[12px] tabular-nums">
                      <span className="text-[var(--gr-diff-add-sign)]">+{stats.additions}</span>{' '}
                      <span className="text-[var(--gr-diff-del-sign)]">-{stats.deletions}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="relative" ref={fileMenuRef}>
              <button
                type="button"
                onClick={() => setFileMenuOpen((o) => !o)}
                className="h-8 px-3 rounded-lg bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] border border-[var(--gr-border)] text-[12px] font-mono text-[var(--gr-text)] flex items-center gap-2 cursor-pointer transition-colors duration-150 ease-out"
              >
                <FileCode className="w-3.5 h-3.5 text-[var(--gr-accent-text)] shrink-0" />
                <span className="truncate max-w-[240px]">{currentFile.path}</span>
                <span className="text-[var(--gr-muted)]">({files.length} files)</span>
                <ChevronDown className="w-3.5 h-3.5 text-[var(--gr-muted)] shrink-0" />
              </button>

              {fileMenuOpen && (
                <div className="absolute left-0 mt-2 w-80 max-h-72 overflow-y-auto rounded-xl bg-[var(--gr-surface)] border border-[var(--gr-border)] shadow-lg py-1.5 z-40">
                  {files.map((file) => {
                    const isSelected = file.path === currentFile.path;
                    const stats = computeDiffStats(file.previousContent ?? '', file.content);
                    return (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => {
                          onSelectFile(file.path);
                          setFileMenuOpen(false);
                        }}
                        className={`w-full px-3 py-2 text-left text-[12px] font-mono flex items-center justify-between gap-3 cursor-pointer transition-colors duration-150 ease-out ${
                          isSelected
                            ? 'bg-[var(--gr-accent-soft)] text-[var(--gr-accent-text)] font-medium'
                            : 'text-[var(--gr-text)] hover:bg-[var(--gr-surface-elevated)]'
                        }`}
                      >
                        <span className="truncate">{file.path}</span>
                        <span className="text-[12px] shrink-0 tabular-nums">
                          <span className="text-[var(--gr-diff-add-sign)]">+{stats.additions}</span>{' '}
                          <span className="text-[var(--gr-diff-del-sign)]">-{stats.deletions}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Controls: Unified/Split Toggle + "..." Overflow Menu */}
        <div className="flex items-center gap-2 shrink-0">
          {blameMode ? (
            <button
              type="button"
              onClick={() => setBlameMode(false)}
              className="h-8 px-3 rounded-lg bg-[var(--gr-accent-soft)] border border-[#E0A458]/60 text-[12px] font-medium text-[var(--gr-accent-text)] flex items-center gap-1.5 cursor-pointer transition-colors duration-150 ease-out"
            >
              <History className="w-3.5 h-3.5" />
              <span>Exit Line Blame</span>
            </button>
          ) : (
            <div
              role="group"
              aria-label="Diff layout"
              className="inline-flex items-center rounded-lg bg-[var(--gr-bg)] border border-[var(--gr-border)] p-0.5"
            >
              <button
                type="button"
                onClick={() => setDiffLayout('unified')}
                className={`h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors duration-150 ease-out cursor-pointer ${
                  diffLayout === 'unified'
                    ? 'bg-[var(--gr-surface)] text-[var(--gr-text)] shadow-xs'
                    : 'text-[var(--gr-muted)] hover:text-[var(--gr-text)]'
                }`}
              >
                Unified
              </button>
              <button
                type="button"
                onClick={() => setDiffLayout('split')}
                className={`h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors duration-150 ease-out cursor-pointer ${
                  diffLayout === 'split'
                    ? 'bg-[var(--gr-surface)] text-[var(--gr-text)] shadow-xs'
                    : 'text-[var(--gr-muted)] hover:text-[var(--gr-text)]'
                }`}
              >
                Split
              </button>
            </div>
          )}

          {/* Overflow "..." Menu (Line Blame, Copy Code, Expand Context, Pin Base) */}
          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              onClick={() => setMoreMenuOpen((o) => !o)}
              aria-label="More code actions"
              aria-expanded={moreMenuOpen}
              className="h-8 w-8 rounded-lg bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] border border-[var(--gr-border)] text-[var(--gr-muted)] hover:text-[var(--gr-text)] flex items-center justify-center transition-colors duration-150 ease-out cursor-pointer"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {moreMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-xl bg-[var(--gr-surface)] border border-[var(--gr-border)] shadow-lg py-1.5 z-40">
                <button
                  type="button"
                  onClick={() => {
                    setBlameMode((b) => !b);
                    setMoreMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-[12px] text-[var(--gr-text)] hover:bg-[var(--gr-surface-elevated)] flex items-center justify-between cursor-pointer transition-colors duration-150 ease-out"
                >
                  <span className="flex items-center gap-2">
                    <History className="w-3.5 h-3.5 text-[var(--gr-muted)]" />
                    <span>Line blame</span>
                  </span>
                  {blameMode && <Check className="w-3.5 h-3.5 text-[var(--gr-accent-text)]" />}
                </button>

                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="w-full px-3 py-2 text-left text-[12px] text-[var(--gr-text)] hover:bg-[var(--gr-surface-elevated)] flex items-center gap-2 cursor-pointer transition-colors duration-150 ease-out"
                >
                  {copiedCode ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[var(--gr-accent-text)]" />
                      <span>Copied snapshot</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-[var(--gr-muted)]" />
                      <span>Copy code</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setExpandAllContext((v) => !v);
                    setMoreMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-[12px] text-[var(--gr-text)] hover:bg-[var(--gr-surface-elevated)] flex items-center justify-between cursor-pointer transition-colors duration-150 ease-out"
                >
                  <span className="flex items-center gap-2">
                    <ChevronsUpDown className="w-3.5 h-3.5 text-[var(--gr-muted)]" />
                    <span>
                      {expandAllContext ? 'Collapse unchanged lines' : 'Expand all lines'}
                    </span>
                  </span>
                </button>

                <div className="my-1 border-t border-[var(--gr-border)]" />

                {baseCommitIndex !== null ? (
                  <button
                    type="button"
                    onClick={() => {
                      onTogglePinBase(null);
                      setMoreMenuOpen(false);
                    }}
                    className="w-full px-3 py-2 text-left text-[12px] text-[var(--gr-accent-text)] hover:bg-[var(--gr-surface-elevated)] flex items-center gap-2 cursor-pointer transition-colors duration-150 ease-out"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Clear diff base ({baseCommit?.shortSha})</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onTogglePinBase(activeCommitIndex);
                      setMoreMenuOpen(false);
                    }}
                    className="w-full px-3 py-2 text-left text-[12px] text-[var(--gr-text)] hover:bg-[var(--gr-surface-elevated)] flex items-center gap-2 cursor-pointer transition-colors duration-150 ease-out"
                  >
                    <GitCompare className="w-3.5 h-3.5 text-[var(--gr-muted)]" />
                    <span>Pin {activeCommit.shortSha} as diff base</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Collapsible "What this file does" Summary Above Diff */}
      <div className="px-5 py-2.5 bg-[var(--gr-surface)]/70 border-b border-[var(--gr-border)]">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setFileSummaryOpen((v) => !v)}
            aria-expanded={fileSummaryOpen}
            className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--gr-text)] hover:text-[var(--gr-accent-text)] transition-colors duration-150 ease-out cursor-pointer"
          >
            {fileSummaryOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-[var(--gr-muted)]" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[var(--gr-muted)]" />
            )}
            <span>What this file does</span>
          </button>

          <div className="flex items-center gap-2 text-[12px] font-mono text-[var(--gr-muted)] tabular-nums">
            <span>
              {baseCommit
                ? `${baseCommit.shortSha} → ${activeCommit.shortSha}`
                : activeCommit.parentSha
                ? `${activeCommit.parentSha.slice(0, 7)} → ${activeCommit.shortSha}`
                : `Initial (${activeCommit.shortSha})`}
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-[var(--gr-diff-add-sign)]">+{fileStats.additions}</span>
            <span className="text-[var(--gr-border-strong)]">/</span>
            <span className="text-[var(--gr-diff-del-sign)]">-{fileStats.deletions}</span>
          </div>
        </div>

        {fileSummaryOpen && (
          <p className="mt-1.5 pl-5 text-[12px] text-[var(--gr-muted)] leading-relaxed">
            {fileSummaryText}
          </p>
        )}
      </div>

      {/* Selected Line Blame Banner */}
      {blameMode && selectedBlameLine && (
        <div className="px-5 py-2.5 bg-[var(--gr-surface)] border-b border-[var(--gr-border)] flex flex-wrap items-center justify-between gap-3 text-[12px]">
          <div className="flex flex-wrap items-center gap-2 text-[var(--gr-muted)]">
            <span className="font-mono text-[var(--gr-accent-text)] font-medium">
              L{selectedBlameLine.lineNumber}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-[var(--gr-text)]">{selectedBlameLine.shortSha}</span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-[var(--gr-text)]">
              {selectedBlameLine.commitTitle}
            </span>
            <span aria-hidden="true">·</span>
            <span>{selectedBlameLine.author}</span>
          </div>
          {selectedBlameLine.commitSha !== activeCommit.sha && (
            <button
              type="button"
              onClick={() => onJumpToCommitSha(selectedBlameLine.commitSha)}
              className="text-[12px] font-medium text-[var(--gr-accent-text)] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>Jump to {selectedBlameLine.shortSha}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Code Scroll Viewport */}
      <div className="flex-1 overflow-auto font-mono text-[13px] leading-6">
        {blameMode ? (
          <table className="w-full border-collapse">
            <tbody>
              {blameLines.map((bLine) => {
                const isOriginatedHere = bLine.commitSha === activeCommit.sha;
                const isSelected = selectedBlameLine?.lineNumber === bLine.lineNumber;
                return (
                  <tr
                    key={bLine.lineNumber}
                    onClick={() => setSelectedBlameLine(bLine)}
                    className={`cursor-pointer transition-colors duration-150 border-l-2 ${
                      isSelected
                        ? 'bg-[var(--gr-accent-soft)] border-[#E0A458] text-[var(--gr-text)]'
                        : isOriginatedHere
                        ? 'bg-[var(--gr-diff-add-bg)] border-[var(--gr-diff-add-bar)] text-[var(--gr-text)]'
                        : 'border-transparent hover:bg-[var(--gr-surface-elevated)]/60 text-[var(--gr-text)]/85'
                    }`}
                  >
                    <td className="w-40 px-3 py-0.5 select-none text-[12px] border-r border-[var(--gr-border)]">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={
                            isOriginatedHere
                              ? 'text-[var(--gr-accent-text)] font-medium'
                              : 'text-[var(--gr-muted)]'
                          }
                        >
                          {bLine.shortSha}
                        </span>
                        <span className="text-[var(--gr-muted)] truncate max-w-[78px]">
                          {(bLine.author || 'Unknown').split(' ')[0]}
                        </span>
                      </div>
                    </td>
                    <td className="w-11 px-2 text-right select-none text-[12px] text-[var(--gr-muted)] tabular-nums border-r border-[var(--gr-border)]">
                      {bLine.lineNumber}
                    </td>
                    <td className="px-4 whitespace-pre">{bLine.content || ' '}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : diffLayout === 'unified' ? (
          <table className="w-full border-collapse">
            <tbody>
              {blocks.map((block) => {
                if (block.kind === 'collapsed' && !expandedBlocks[block.blockId]) {
                  return (
                    <tr
                      key={block.blockId}
                      className="bg-[var(--gr-surface)] border-y border-[var(--gr-border)]"
                    >
                      <td colSpan={4} className="px-4 py-1 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedBlocks((prev) => ({ ...prev, [block.blockId]: true }))
                          }
                          className="text-[12px] font-sans text-[var(--gr-muted)] hover:text-[var(--gr-accent-text)] inline-flex items-center gap-1.5 cursor-pointer py-0.5 transition-colors duration-150"
                        >
                          <ChevronsUpDown className="w-3.5 h-3.5" />
                          <span>Show {block.lines.length} unchanged lines</span>
                        </button>
                      </td>
                    </tr>
                  );
                }

                return block.lines.map((line, idx) => {
                  const isAdd = line.type === 'add';
                  const isDel = line.type === 'del';
                  return (
                    <tr
                      key={`${block.blockId}-${idx}`}
                      className={
                        isAdd
                          ? 'bg-[var(--gr-diff-add-bg)] border-l-2 border-[var(--gr-diff-add-bar)] text-[var(--gr-text)]'
                          : isDel
                          ? 'bg-[var(--gr-diff-del-bg)] border-l-2 border-[var(--gr-diff-del-bar)] text-[var(--gr-muted)]'
                          : 'border-l-2 border-transparent text-[var(--gr-text)]/90 hover:bg-[var(--gr-surface-elevated)]/50'
                      }
                    >
                      <td className="w-11 px-2 text-right select-none text-[12px] text-[var(--gr-muted)] tabular-nums border-r border-[var(--gr-border)]">
                        {line.oldLineNumber ?? ''}
                      </td>
                      <td className="w-11 px-2 text-right select-none text-[12px] text-[var(--gr-muted)] tabular-nums border-r border-[var(--gr-border)]">
                        {line.newLineNumber ?? ''}
                      </td>
                      <td className="w-6 px-1.5 text-center select-none font-semibold">
                        {isAdd ? (
                          <span className="text-[var(--gr-diff-add-sign)]">+</span>
                        ) : isDel ? (
                          <span className="text-[var(--gr-diff-del-sign)]">-</span>
                        ) : (
                          ' '
                        )}
                      </td>
                      <td className="px-4 whitespace-pre">{line.content || ' '}</td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[var(--gr-border)]">
            <div className="overflow-x-auto">
              <div className="px-4 py-1.5 bg-[var(--gr-surface)] border-b border-[var(--gr-border)] text-[12px] text-[var(--gr-muted)]">
                Before ({baseCommit ? baseCommit.shortSha : activeCommit.parentSha?.slice(0, 7) || 'empty'})
              </div>
              <table className="w-full border-collapse">
                <tbody>
                  {diffLines
                    .filter((l) => l.type !== 'add')
                    .map((line, idx) => (
                      <tr
                        key={idx}
                        className={
                          line.type === 'del'
                            ? 'bg-[var(--gr-diff-del-bg)] border-l-2 border-[var(--gr-diff-del-bar)] text-[var(--gr-muted)]'
                            : 'border-l-2 border-transparent text-[var(--gr-muted)]'
                        }
                      >
                        <td className="w-10 px-2 text-right select-none text-[12px] text-[var(--gr-muted)] tabular-nums border-r border-[var(--gr-border)]">
                          {line.oldLineNumber ?? ''}
                        </td>
                        <td className="w-5 px-1 text-center select-none font-semibold">
                          {line.type === 'del' ? (
                            <span className="text-[var(--gr-diff-del-sign)]">-</span>
                          ) : (
                            ' '
                          )}
                        </td>
                        <td className="px-3 whitespace-pre">{line.content || ' '}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto">
              <div className="px-4 py-1.5 bg-[var(--gr-surface)] border-b border-[var(--gr-border)] text-[12px] text-[var(--gr-text)] font-medium">
                After ({activeCommit.shortSha})
              </div>
              <table className="w-full border-collapse">
                <tbody>
                  {diffLines
                    .filter((l) => l.type !== 'del')
                    .map((line, idx) => (
                      <tr
                        key={idx}
                        className={
                          line.type === 'add'
                            ? 'bg-[var(--gr-diff-add-bg)] border-l-2 border-[var(--gr-diff-add-bar)] text-[var(--gr-text)]'
                            : 'border-l-2 border-transparent text-[var(--gr-text)]/90'
                        }
                      >
                        <td className="w-10 px-2 text-right select-none text-[12px] text-[var(--gr-muted)] tabular-nums border-r border-[var(--gr-border)]">
                          {line.newLineNumber ?? ''}
                        </td>
                        <td className="w-5 px-1 text-center select-none font-semibold">
                          {line.type === 'add' ? (
                            <span className="text-[var(--gr-diff-add-sign)]">+</span>
                          ) : (
                            ' '
                          )}
                        </td>
                        <td className="px-3 whitespace-pre">{line.content || ' '}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
