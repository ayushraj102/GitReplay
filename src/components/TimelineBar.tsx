import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Filter,
  Check,
  Repeat,
  Plus,
  Loader2,
  Tag,
} from 'lucide-react';
import { GitCommit, CommitCategory } from '../types/git';

export type TimelineViewMode = 'diff' | 'matrix';

interface TimelineBarProps {
  commits: GitCommit[];
  activeIndex: number;
  isPlaying: boolean;
  playbackSpeed: number;
  loopPlayback: boolean;
  categoryFilter: CommitCategory | 'All';
  viewMode: TimelineViewMode;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  onSelectIndex: (index: number) => void;
  onTogglePlay: () => void;
  onStepPrev: () => void;
  onStepNext: () => void;
  onChangeSpeed: (speed: number) => void;
  onToggleLoop: () => void;
  onChangeCategoryFilter: (cat: CommitCategory | 'All') => void;
  onChangeViewMode: (mode: TimelineViewMode) => void;
}

const CATEGORIES: Array<CommitCategory | 'All'> = [
  'All',
  'Architecture',
  'Performance',
  'Feature',
  'Refactor',
  'Bugfix',
];

interface ReleaseGroup {
  label: string;
  startIndex: number;
  endIndex: number;
  count: number;
}

export const TimelineBar: React.FC<TimelineBarProps> = ({
  commits,
  activeIndex,
  isPlaying,
  playbackSpeed,
  loopPlayback,
  categoryFilter,
  viewMode,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onSelectIndex,
  onTogglePlay,
  onStepPrev,
  onStepNext,
  onChangeSpeed,
  onToggleLoop,
  onChangeCategoryFilter,
  onChangeViewMode,
}) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const settingsRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const scrollTrackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const isLargeTimeline = commits.length > 15;

  // Auto-scroll active commit node into view when timeline is scrollable (> 15 commits)
  useEffect(() => {
    if (!isLargeTimeline || !scrollTrackRef.current) return;
    const activeEl = scrollTrackRef.current.querySelector(
      `[data-commit-idx="${activeIndex}"]`
    ) as HTMLElement | null;
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeIndex, isLargeTimeline]);

  // Group commits chronologically by release tag (commits leading up to a tagged commit belong to that release)
  const releaseGroups = useMemo<ReleaseGroup[]>(() => {
    if (commits.length === 0) return [];
    const groups: ReleaseGroup[] = [];
    let bucketStart = 0;

    for (let i = 0; i < commits.length; i++) {
      if (commits[i].tag) {
        groups.push({
          label: commits[i].tag!,
          startIndex: bucketStart,
          endIndex: i,
          count: i - bucketStart + 1,
        });
        bucketStart = i + 1;
      }
    }

    if (bucketStart < commits.length) {
      groups.push({
        label: groups.length > 0 ? 'Unreleased' : 'All commits',
        startIndex: bucketStart,
        endIndex: commits.length - 1,
        count: commits.length - bucketStart,
      });
    }

    return groups;
  }, [commits]);

  const progressPct =
    commits.length > 1 ? (activeIndex / (commits.length - 1)) * 100 : 100;

  return (
    <section
      aria-label="Commit Timeline Controls"
      className="relative px-6 py-3 bg-[var(--gr-surface)] border-b border-[var(--gr-border)] space-y-2.5 select-none"
    >
      <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-5">
        {/* Left: Compact Playback Group + Settings Popover + Progress Label */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="inline-flex items-center rounded-lg bg-[var(--gr-bg)] border border-[var(--gr-border)] p-0.5">
            <button
              type="button"
              onClick={onStepPrev}
              disabled={activeIndex <= 0}
              title="Previous commit (←)"
              aria-label="Previous commit"
              className="h-7 w-8 flex items-center justify-center rounded-md text-[var(--gr-muted)] hover:bg-[var(--gr-surface-elevated)] hover:text-[var(--gr-text)] disabled:opacity-35 disabled:pointer-events-none transition-colors duration-150 ease-out cursor-pointer"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={onTogglePlay}
              title="Play or pause timeline (Space)"
              aria-label={isPlaying ? 'Pause timeline' : 'Play timeline'}
              className="h-7 px-3 flex items-center gap-1.5 rounded-md bg-[#E0A458] hover:bg-[#E8B46E] text-[#141414] text-[12px] font-semibold transition-colors duration-150 ease-out cursor-pointer whitespace-nowrap"
            >
              {isPlaying ? (
                <>
                  <Pause className="w-3.5 h-3.5 fill-current" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Play</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onStepNext}
              disabled={activeIndex >= commits.length - 1}
              title="Next commit (→)"
              aria-label="Next commit"
              className="h-7 w-8 flex items-center justify-center rounded-md text-[var(--gr-muted)] hover:bg-[var(--gr-surface-elevated)] hover:text-[var(--gr-text)] disabled:opacity-35 disabled:pointer-events-none transition-colors duration-150 ease-out cursor-pointer"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Speed & Loop Settings Popover */}
          <div className="relative" ref={settingsRef}>
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              title="Playback settings"
              aria-expanded={settingsOpen}
              className="h-8 px-2.5 rounded-lg bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] border border-[var(--gr-border)] text-[12px] font-mono text-[var(--gr-muted)] hover:text-[var(--gr-text)] flex items-center gap-1.5 transition-colors duration-150 ease-out cursor-pointer tabular-nums"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{playbackSpeed}x</span>
            </button>

            {settingsOpen && (
              <div className="absolute left-0 mt-2 w-52 rounded-xl bg-[var(--gr-surface)] border border-[var(--gr-border)] shadow-lg p-3 z-40 space-y-3">
                <div className="space-y-1.5">
                  <div className="text-[12px] font-medium text-[var(--gr-muted)]">
                    Playback speed
                  </div>
                  <div className="grid grid-cols-4 gap-1 bg-[var(--gr-bg)] p-1 rounded-lg border border-[var(--gr-border)]">
                    {[0.5, 1, 2, 4].map((spd) => (
                      <button
                        key={spd}
                        type="button"
                        onClick={() => onChangeSpeed(spd)}
                        className={`py-1 rounded text-[12px] font-mono tabular-nums cursor-pointer transition-colors duration-150 ease-out ${
                          playbackSpeed === spd
                            ? 'bg-[var(--gr-surface-elevated)] text-[var(--gr-accent-text)] font-semibold'
                            : 'text-[var(--gr-muted)] hover:text-[var(--gr-text)]'
                        }`}
                      >
                        {spd}x
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onToggleLoop}
                  className="w-full px-2.5 py-2 rounded-lg bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] border border-[var(--gr-border)] text-[12px] text-[var(--gr-text)] flex items-center justify-between cursor-pointer transition-colors duration-150 ease-out"
                >
                  <span className="flex items-center gap-2">
                    <Repeat className="w-3.5 h-3.5 text-[var(--gr-muted)]" />
                    <span>Loop replay</span>
                  </span>
                  <span
                    className={`font-mono text-[12px] ${
                      loopPlayback ? 'text-[var(--gr-accent-text)] font-medium' : 'text-[var(--gr-muted)]'
                    }`}
                  >
                    {loopPlayback ? 'On' : 'Off'}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Step Progress Label */}
          <span className="text-[12px] font-mono text-[var(--gr-muted)] tabular-nums whitespace-nowrap pl-1">
            Step {activeIndex + 1} of {commits.length}
          </span>

          {hasMore && onLoadMore && (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={isLoadingMore}
              className="h-7 px-2.5 rounded-lg bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] disabled:opacity-50 border border-[var(--gr-border)] text-[12px] font-medium text-[var(--gr-accent-text)] flex items-center gap-1 transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
            >
              {isLoadingMore ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Plus className="w-3 h-3" />
              )}
              <span>{isLoadingMore ? 'Loading...' : 'Load more'}</span>
            </button>
          )}

          {!isLargeTimeline && (
            <span className="hidden xl:inline-block text-[12px] text-[var(--gr-muted)] pl-1 whitespace-nowrap">
              · <kbd className="font-mono">← →</kbd> step · <kbd className="font-mono">Space</kbd> play
            </span>
          )}
        </div>

        {/* Center: Slim Horizontal Timeline Dots + Track (Scrollable when > 15 commits) */}
        <div
          ref={scrollTrackRef}
          className={`relative flex-1 min-w-[220px] px-3 py-3 ${
            isLargeTimeline ? 'overflow-x-auto' : ''
          }`}
        >
          <div
            className="relative"
            style={
              isLargeTimeline
                ? { minWidth: `${Math.max(520, commits.length * 24)}px` }
                : undefined
            }
          >
            {/* Base Track */}
            <div className="relative h-0.5 bg-[var(--gr-border-strong)] rounded-full">
              {/* Completed Segment in Accent */}
              <div
                className="absolute left-0 top-0 h-full bg-[#E0A458] rounded-full transition-all duration-150 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            {/* Commit Nodes */}
            <div className="relative flex items-center justify-between -mt-[7px]">
              {commits.map((commit, idx) => {
                const isSelected = idx === activeIndex;
                const isPast = idx < activeIndex;
                const matchesFilter =
                  categoryFilter === 'All' || commit.category === categoryFilter;
                const isHovered = hoveredIndex === idx;

                const tooltipAlignClass =
                  idx <= 1
                    ? 'left-0'
                    : idx >= commits.length - 2
                    ? 'right-0'
                    : 'left-1/2 -translate-x-1/2';

                return (
                  <div
                    key={commit.sha}
                    data-commit-idx={idx}
                    className="relative flex flex-col items-center shrink-0"
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    {/* Hover Tooltip */}
                    {isHovered && (
                      <div
                        role="tooltip"
                        className={`absolute bottom-full mb-2.5 ${tooltipAlignClass} w-64 p-2.5 rounded-lg bg-[var(--gr-surface)] border border-[var(--gr-border-strong)] shadow-lg z-40 pointer-events-none`}
                      >
                        <div className="flex items-center justify-between text-[12px] font-mono text-[var(--gr-muted)] mb-0.5 tabular-nums">
                          <span className="text-[var(--gr-accent-text)] font-medium">
                            {commit.shortSha}
                            {commit.tag ? ` · ${commit.tag}` : ''}
                          </span>
                          <span>
                            Step {idx + 1}/{commits.length}
                          </span>
                        </div>
                        <div className="text-[12px] font-medium text-[var(--gr-text)] line-clamp-2 leading-snug">
                          {commit.title}
                        </div>
                        <div className="text-[12px] text-[var(--gr-muted)] mt-1">
                          {commit.author} · {commit.category}
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => onSelectIndex(idx)}
                      onFocus={() => setHoveredIndex(idx)}
                      onBlur={() => setHoveredIndex(null)}
                      aria-label={`Jump to commit ${commit.shortSha}: ${commit.title}`}
                      className={`rounded-full transition-all duration-150 ease-out cursor-pointer flex items-center justify-center ${
                        isSelected
                          ? 'w-4 h-4 bg-[#E0A458] ring-4 ring-[#E0A458]/25'
                          : isPast
                          ? 'w-2.5 h-2.5 bg-[#E0A458] hover:scale-125'
                          : commit.tag
                          ? 'w-3 h-3 bg-[var(--gr-muted)] hover:bg-[#E0A458]'
                          : 'w-2.5 h-2.5 bg-[var(--gr-border-strong)] hover:bg-[var(--gr-muted)]'
                      } ${!matchesFilter ? 'opacity-25' : 'opacity-100'}`}
                    />

                    {/* Version Milestone Label underneath tagged commits */}
                    {commit.tag && (
                      <span
                        className={`absolute top-4 text-[12px] font-mono tabular-nums whitespace-nowrap pointer-events-none ${
                          isSelected
                            ? 'text-[var(--gr-accent-text)] font-semibold'
                            : 'text-[var(--gr-muted)]'
                        }`}
                      >
                        {commit.tag}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Small Filter Dropdown + Code/List View Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Category Filter Dropdown */}
          <div className="relative" ref={filterRef}>
            <button
              type="button"
              onClick={() => setFilterOpen((o) => !o)}
              aria-expanded={filterOpen}
              className={`h-8 px-3 rounded-lg border text-[12px] font-medium flex items-center gap-1.5 transition-colors duration-150 ease-out cursor-pointer whitespace-nowrap ${
                categoryFilter !== 'All'
                  ? 'bg-[var(--gr-accent-soft)] border-[#E0A458]/60 text-[var(--gr-accent-text)]'
                  : 'bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] border-[var(--gr-border)] text-[var(--gr-text)]'
              }`}
            >
              <Filter className="w-3.5 h-3.5 text-[var(--gr-muted)]" />
              <span>{categoryFilter === 'All' ? 'Filter' : categoryFilter}</span>
            </button>

            {filterOpen && (
              <div className="absolute right-0 mt-2 w-44 rounded-xl bg-[var(--gr-surface)] border border-[var(--gr-border)] shadow-lg py-1.5 z-40">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      onChangeCategoryFilter(cat);
                      setFilterOpen(false);
                    }}
                    className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--gr-text)] hover:bg-[var(--gr-surface-elevated)] flex items-center justify-between cursor-pointer transition-colors duration-150 ease-out"
                  >
                    <span>{cat}</span>
                    {categoryFilter === cat && (
                      <Check className="w-3.5 h-3.5 text-[var(--gr-accent-text)]" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Code vs List View Toggle */}
          <div
            role="group"
            aria-label="Timeline content view"
            className="inline-flex items-center rounded-lg bg-[var(--gr-bg)] border border-[var(--gr-border)] p-0.5"
          >
            <button
              type="button"
              onClick={() => onChangeViewMode('diff')}
              className={`h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors duration-150 ease-out cursor-pointer whitespace-nowrap ${
                viewMode === 'diff'
                  ? 'bg-[var(--gr-surface)] text-[var(--gr-text)] shadow-xs'
                  : 'text-[var(--gr-muted)] hover:text-[var(--gr-text)]'
              }`}
            >
              Code
            </button>
            <button
              type="button"
              onClick={() => onChangeViewMode('matrix')}
              className={`h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors duration-150 ease-out cursor-pointer whitespace-nowrap ${
                viewMode === 'matrix'
                  ? 'bg-[var(--gr-surface)] text-[var(--gr-text)] shadow-xs'
                  : 'text-[var(--gr-muted)] hover:text-[var(--gr-text)]'
              }`}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {/* Release / Tag Group Jump Strip when timeline has > 15 commits */}
      {isLargeTimeline && releaseGroups.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pt-1 border-t border-[var(--gr-border)]">
          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--gr-muted)] whitespace-nowrap shrink-0 pr-1">
            <Tag className="w-3 h-3 text-[var(--gr-accent-text)]" />
            <span>Releases:</span>
          </span>
          {releaseGroups.map((group) => {
            const isInGroup =
              activeIndex >= group.startIndex && activeIndex <= group.endIndex;
            return (
              <button
                key={`${group.label}-${group.startIndex}`}
                type="button"
                onClick={() => onSelectIndex(group.endIndex)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-mono whitespace-nowrap shrink-0 cursor-pointer border transition-colors duration-150 ${
                  isInGroup
                    ? 'bg-[var(--gr-accent-soft)] border-[#E0A458]/60 text-[var(--gr-accent-text)] font-medium'
                    : 'bg-[var(--gr-bg)] border-[var(--gr-border)] text-[var(--gr-muted)] hover:text-[var(--gr-text)]'
                }`}
              >
                {group.label} ({group.count})
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};
