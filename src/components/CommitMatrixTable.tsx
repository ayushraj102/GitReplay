import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, Play, GitCompare, Tag, Plus, Loader2 } from 'lucide-react';
import { GitCommit } from '../types/git';
import { computeDiffStats } from '../utils/gitEngine';

interface CommitMatrixTableProps {
  commits: GitCommit[];
  activeCommitIndex: number;
  baseCommitIndex: number | null;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  onSelectCommitIndex: (idx: number) => void;
  onPinBaseCommitIndex: (idx: number | null) => void;
}

type VirtualRowItem =
  | { kind: 'group'; id: string; label: string; count: number }
  | { kind: 'commit'; id: string; commit: GitCommit; index: number };

const ROW_HEIGHT = 56;
const OVERSCAN = 6;

export const CommitMatrixTable: React.FC<CommitMatrixTableProps> = ({
  commits,
  activeCommitIndex,
  baseCommitIndex,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onSelectCommitIndex,
  onPinBaseCommitIndex,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(520);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const updateHeight = () => {
      if (el.clientHeight > 0) setViewportHeight(el.clientHeight);
    };
    updateHeight();
    const ro = new ResizeObserver(updateHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build release/tag grouping map chronologically (commits leading up to a tagged release belong to that tag)
  const commitGroupLabels = useMemo(() => {
    const labels: string[] = new Array(commits.length).fill('Unreleased');
    let nextTag: string | null = null;
    for (let i = commits.length - 1; i >= 0; i--) {
      if (commits[i].tag) {
        nextTag = commits[i].tag!;
      }
      labels[i] = nextTag || 'Unreleased';
    }
    return labels;
  }, [commits]);

  const virtualItems = useMemo<VirtualRowItem[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = commits
      .map((commit, index) => ({ commit, index, group: commitGroupLabels[index] }))
      .filter(({ commit }) => {
        if (!q) return true;
        return (
          commit.title.toLowerCase().includes(q) ||
          commit.shortSha.toLowerCase().includes(q) ||
          commit.author.toLowerCase().includes(q) ||
          commit.category.toLowerCase().includes(q) ||
          (commit.tag || '').toLowerCase().includes(q) ||
          commit.adr.title.toLowerCase().includes(q)
        );
      });

    if (filtered.length === 0) return [];

    // Group contiguous items by release/tag
    const hasTags = commits.some((c) => Boolean(c.tag));
    if (!hasTags) {
      return filtered.map(({ commit, index }) => ({
        kind: 'commit',
        id: commit.sha,
        commit,
        index,
      }));
    }

    const items: VirtualRowItem[] = [];
    let currentGroup = '';
    let groupHeaderIdx = -1;
    let groupCount = 0;

    for (const entry of filtered) {
      if (entry.group !== currentGroup) {
        if (groupHeaderIdx !== -1 && items[groupHeaderIdx].kind === 'group') {
          (items[groupHeaderIdx] as { kind: 'group'; id: string; label: string; count: number }).count =
            groupCount;
        }
        currentGroup = entry.group;
        groupCount = 0;
        groupHeaderIdx = items.length;
        items.push({
          kind: 'group',
          id: `grp-${currentGroup}-${entry.index}`,
          label: currentGroup,
          count: 0,
        });
      }
      items.push({
        kind: 'commit',
        id: entry.commit.sha,
        commit: entry.commit,
        index: entry.index,
      });
      groupCount += 1;
    }

    if (groupHeaderIdx !== -1 && items[groupHeaderIdx].kind === 'group') {
      (items[groupHeaderIdx] as { kind: 'group'; id: string; label: string; count: number }).count =
        groupCount;
    }

    return items;
  }, [commits, commitGroupLabels, searchQuery]);

  const totalCount = virtualItems.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const endIndex = Math.min(totalCount, startIndex + visibleCount);

  const visibleItems = virtualItems.slice(startIndex, endIndex);
  const topSpacerHeight = startIndex * ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (totalCount - endIndex) * ROW_HEIGHT);

  return (
    <div className="p-6 flex flex-col gap-4 h-full bg-[var(--gr-bg)] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--gr-text)]">
            Chronological Commit &amp; ADR List ({commits.length})
          </h2>
          <p className="text-[12px] text-[var(--gr-muted)]">
            Grouped by tag/release and virtualized for fast navigation across large histories.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="w-3.5 h-3.5 text-[var(--gr-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setScrollTop(0);
                if (scrollContainerRef.current) {
                  scrollContainerRef.current.scrollTop = 0;
                }
              }}
              placeholder="Filter by SHA, tag, author, or title..."
              className="w-full pl-8 pr-3 py-1.5 bg-[var(--gr-surface)] border border-[var(--gr-border)] rounded-lg text-[12px] text-[var(--gr-text)] placeholder:text-[var(--gr-muted)] focus:outline-none focus:border-[#E0A458]"
            />
          </div>

          {hasMore && onLoadMore && (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={isLoadingMore}
              className="h-8 px-3 rounded-lg bg-[var(--gr-surface)] hover:bg-[var(--gr-surface-elevated)] disabled:opacity-50 border border-[var(--gr-border)] text-[12px] font-medium text-[var(--gr-accent-text)] flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              {isLoadingMore ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              <span>{isLoadingMore ? 'Loading...' : 'Load more'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Virtualized Scroll Viewport */}
      <div
        ref={scrollContainerRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="flex-1 min-h-[360px] border border-[var(--gr-border)] rounded-xl overflow-auto bg-[var(--gr-surface)]"
      >
        {totalCount === 0 ? (
          <div className="py-12 text-center text-[12px] text-[var(--gr-muted)]">
            No commits match &ldquo;{searchQuery}&rdquo;.
          </div>
        ) : (
          <div style={{ minWidth: '720px' }}>
            {/* Sticky Header */}
            <div className="sticky top-0 z-10 grid grid-cols-12 items-center px-4 h-10 border-b border-[var(--gr-border)] bg-[var(--gr-surface-elevated)] text-[12px] font-mono text-[var(--gr-muted)]">
              <div className="col-span-1">Step</div>
              <div className="col-span-2">Revision</div>
              <div className="col-span-1">Type</div>
              <div className="col-span-4">Commit Summary</div>
              <div className="col-span-2">Author</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {topSpacerHeight > 0 && <div style={{ height: `${topSpacerHeight}px` }} />}

            {visibleItems.map((item) => {
              if (item.kind === 'group') {
                return (
                  <div
                    key={item.id}
                    style={{ height: `${ROW_HEIGHT}px` }}
                    className="px-4 border-b border-[var(--gr-border)] bg-[var(--gr-bg)]/70 flex items-center justify-between text-[12px]"
                  >
                    <span className="inline-flex items-center gap-2 font-mono font-semibold text-[var(--gr-accent-text)]">
                      <Tag className="w-3.5 h-3.5" />
                      <span>{item.label}</span>
                    </span>
                    <span className="font-mono text-[11px] text-[var(--gr-muted)] tabular-nums">
                      {item.count} commit{item.count === 1 ? '' : 's'}
                    </span>
                  </div>
                );
              }

              const { commit, index } = item;
              const isSelected = index === activeCommitIndex;
              const isBase = index === baseCommitIndex;
              const delta = commit.files.reduce(
                (acc, f) => {
                  const s = computeDiffStats(f.previousContent ?? '', f.content);
                  return {
                    add: acc.add + s.additions,
                    del: acc.del + s.deletions,
                  };
                },
                { add: 0, del: 0 }
              );

              return (
                <div
                  key={item.id}
                  style={{ height: `${ROW_HEIGHT}px` }}
                  onClick={() => onSelectCommitIndex(index)}
                  className={`grid grid-cols-12 items-center px-4 border-b border-[var(--gr-border)] text-[12px] cursor-pointer transition-colors duration-150 ease-out ${
                    isSelected
                      ? 'bg-[var(--gr-accent-soft)] text-[var(--gr-text)]'
                      : 'hover:bg-[var(--gr-surface-elevated)]/60 text-[var(--gr-text)]'
                  }`}
                >
                  <div className="col-span-1 font-mono tabular-nums text-[var(--gr-muted)]">
                    #{index + 1}
                  </div>
                  <div className="col-span-2 font-mono tabular-nums text-[var(--gr-accent-text)] font-medium truncate pr-2">
                    {commit.shortSha}
                    {commit.tag ? ` · ${commit.tag}` : ''}
                  </div>
                  <div className="col-span-1 text-[var(--gr-muted)] truncate pr-2">
                    {commit.category}
                  </div>
                  <div className="col-span-4 min-w-0 pr-3">
                    <div className="font-medium text-[var(--gr-text)] truncate">
                      {commit.title}
                    </div>
                    <div className="text-[11px] font-mono text-[var(--gr-muted)] truncate">
                      {commit.diffLoaded === false
                        ? 'Diff loads on open'
                        : `${commit.files.length} files · +${delta.add} / -${delta.del}`}
                    </div>
                  </div>
                  <div className="col-span-2 text-[var(--gr-muted)] truncate pr-2">
                    {commit.author}
                  </div>
                  <div
                    className="col-span-2 flex items-center justify-end gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectCommitIndex(index)}
                      className="px-2 py-1 border border-[var(--gr-border)] bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] text-[var(--gr-text)] rounded-md text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors duration-150"
                    >
                      <Play className="w-3 h-3" />
                      <span>Inspect</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onPinBaseCommitIndex(isBase ? null : index)}
                      className={`px-2 py-1 rounded-md text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer border transition-colors duration-150 ${
                        isBase
                          ? 'bg-[var(--gr-accent-soft)] border-[#E0A458] text-[var(--gr-accent-text)]'
                          : 'bg-transparent border-[var(--gr-border)] text-[var(--gr-muted)] hover:text-[var(--gr-text)]'
                      }`}
                    >
                      <GitCompare className="w-3 h-3" />
                      <span>{isBase ? 'Pinned' : 'Pin'}</span>
                    </button>
                  </div>
                </div>
              );
            })}

            {bottomSpacerHeight > 0 && <div style={{ height: `${bottomSpacerHeight}px` }} />}
          </div>
        )}
      </div>
    </div>
  );
};
