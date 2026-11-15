import React, { useState, useRef, useLayoutEffect, useCallback } from 'react';
import { ArrowRight, Layers } from 'lucide-react';
import { GitCommit, ArchitectureModule, ArchitectureEdge } from '../types/git';

interface ArchitectureViewProps {
  commits: GitCommit[];
  activeCommitIndex: number;
  onSelectCommitIndex: (index: number) => void;
  onInspectCommitCode: (index: number) => void;
}

const TIERS: Array<{ key: ArchitectureModule['layer']; label: string }> = [
  { key: 'client', label: 'Query & Client' },
  { key: 'edge', label: 'Transport & Routing' },
  { key: 'core', label: 'Execution & Core' },
  { key: 'storage', label: 'Storage & Persistence' },
];

interface ArrowCoord {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isNew: boolean;
  protocol: string;
  key: string;
}

export const ArchitectureView: React.FC<ArchitectureViewProps> = ({
  commits,
  activeCommitIndex,
  onSelectCommitIndex,
  onInspectCommitCode,
}) => {
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [snapshotMode, setSnapshotMode] = useState<'after' | 'before'>('after');
  const [arrowCoords, setArrowCoords] = useState<ArrowCoord[]>([]);

  const diagramRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const safeIndex = Math.min(activeCommitIndex, Math.max(0, commits.length - 1));
  const activeCommit = commits[safeIndex];
  const prevCommit = safeIndex > 0 ? commits[safeIndex - 1] : null;

  const isBeforeMode = snapshotMode === 'before';
  const displayedCommit =
    isBeforeMode && prevCommit ? prevCommit : activeCommit;

  const modules: ArchitectureModule[] =
    isBeforeMode && !prevCommit ? [] : displayedCommit?.adr?.modules || [];
  const edges: ArchitectureEdge[] =
    isBeforeMode && !prevCommit ? [] : displayedCommit?.adr?.edges || [];

  const recomputeArrows = useCallback(() => {
    const container = diagramRef.current;
    if (!container || edges.length === 0) {
      setArrowCoords([]);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const nextArrows: ArrowCoord[] = [];

    edges.forEach((edge, idx) => {
      const fromEl = nodeRefs.current[edge.from];
      const toEl = nodeRefs.current[edge.to];
      if (!fromEl || !toEl) return;

      const r1 = fromEl.getBoundingClientRect();
      const r2 = toEl.getBoundingClientRect();

      const fromCenterX = r1.left - containerRect.left + r1.width / 2;
      const fromCenterY = r1.top - containerRect.top + r1.height / 2;
      const toCenterX = r2.left - containerRect.left + r2.width / 2;
      const toCenterY = r2.top - containerRect.top + r2.height / 2;

      let x1 = fromCenterX;
      let y1 = fromCenterY;
      let x2 = toCenterX;
      let y2 = toCenterY;

      // Connect bottom-to-top when flowing downward, top-to-bottom when upward, side-to-side on same tier
      if (Math.abs(r1.top - r2.top) < 20) {
        if (fromCenterX <= toCenterX) {
          x1 = r1.right - containerRect.left;
          x2 = r2.left - containerRect.left;
        } else {
          x1 = r1.left - containerRect.left;
          x2 = r2.right - containerRect.left;
        }
      } else if (fromCenterY < toCenterY) {
        y1 = r1.bottom - containerRect.top;
        y2 = r2.top - containerRect.top;
      } else {
        y1 = r1.top - containerRect.top;
        y2 = r2.bottom - containerRect.top;
      }

      nextArrows.push({
        x1,
        y1,
        x2,
        y2,
        isNew: Boolean(edge.isNew && !isBeforeMode),
        protocol: edge.protocol,
        key: `${edge.from}-${edge.to}-${idx}`,
      });
    });

    setArrowCoords(nextArrows);
  }, [edges, isBeforeMode]);

  useLayoutEffect(() => {
    recomputeArrows();
    if (typeof ResizeObserver === 'undefined' || !diagramRef.current) return;
    const observer = new ResizeObserver(() => recomputeArrows());
    observer.observe(diagramRef.current);
    return () => observer.disconnect();
  }, [recomputeArrows, modules.length, safeIndex, snapshotMode]);

  if (commits.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center text-[14px] text-[var(--gr-muted)]">
        No commits available to render architecture evolution.
      </div>
    );
  }

  const selectedModule =
    modules.find((m) => m.id === selectedModuleId) || modules[0] || null;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      {/* Top Timeline Scrubber + Before / After Toggle */}
      <section className="p-5 rounded-xl bg-[var(--gr-surface)] border border-[var(--gr-border)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-[12px] font-mono text-[var(--gr-muted)] tabular-nums">
              <span className="text-[var(--gr-accent-text)] font-medium">
                {activeCommit.shortSha}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Step {safeIndex + 1} of {commits.length}
              </span>
              {prevCommit && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    {isBeforeMode
                      ? `Before state (${prevCommit.shortSha})`
                      : `After state (vs ${prevCommit.shortSha})`}
                  </span>
                </>
              )}
            </div>
            <h1 className="text-[16px] font-semibold text-[var(--gr-text)]">
              {activeCommit.adr?.title || activeCommit.title}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Before / After Toggle */}
            <div
              role="group"
              aria-label="Commit architecture state"
              className="inline-flex items-center rounded-lg bg-[var(--gr-bg)] border border-[var(--gr-border)] p-0.5"
            >
              <button
                type="button"
                onClick={() => setSnapshotMode('before')}
                className={`h-7 px-3 rounded-md text-[12px] font-medium transition-colors duration-150 ease-out cursor-pointer whitespace-nowrap ${
                  snapshotMode === 'before'
                    ? 'bg-[var(--gr-surface)] text-[var(--gr-text)] shadow-xs'
                    : 'text-[var(--gr-muted)] hover:text-[var(--gr-text)]'
                }`}
              >
                Before
              </button>
              <button
                type="button"
                onClick={() => setSnapshotMode('after')}
                className={`h-7 px-3 rounded-md text-[12px] font-medium transition-colors duration-150 ease-out cursor-pointer whitespace-nowrap ${
                  snapshotMode === 'after'
                    ? 'bg-[var(--gr-surface)] text-[var(--gr-text)] shadow-xs'
                    : 'text-[var(--gr-muted)] hover:text-[var(--gr-text)]'
                }`}
              >
                After
              </button>
            </div>

            <button
              type="button"
              onClick={() => onInspectCommitCode(safeIndex)}
              className="h-8 px-3.5 rounded-lg bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] border border-[var(--gr-border)] text-[12px] font-medium text-[var(--gr-text)] flex items-center gap-1.5 transition-colors duration-150 ease-out cursor-pointer whitespace-nowrap"
            >
              <span>Open code diff</span>
              <ArrowRight className="w-3.5 h-3.5 text-[var(--gr-accent-text)]" />
            </button>
          </div>
        </div>

        {/* Commit Evolution Slider */}
        <div className="space-y-2 pt-1">
          <input
            type="range"
            min={0}
            max={Math.max(0, commits.length - 1)}
            value={safeIndex}
            onChange={(e) => {
              setSelectedModuleId(null);
              onSelectCommitIndex(Number(e.target.value));
            }}
            aria-label="Scrub architecture across commits"
            className="w-full accent-[#E0A458] cursor-pointer"
          />
          <div className="flex items-center justify-between text-[12px] font-mono text-[var(--gr-muted)] tabular-nums">
            <span>
              {commits[0]?.shortSha} ({commits[0]?.tag || 'Start'})
            </span>
            <span>
              {activeCommit.shortSha} · {(activeCommit.timestamp || '').split(' ')[0] || '—'}
            </span>
            <span>
              {commits[commits.length - 1]?.shortSha} (
              {commits[commits.length - 1]?.tag || 'Latest'})
            </span>
          </div>
        </div>
      </section>

      {/* Main Architecture Diagram + Selected Node Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 Cols: Layered Horizontal Diagram with SVG Data Flow Arrows */}
        <div className="lg:col-span-8 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--gr-muted)]">
            <span className="font-medium text-[var(--gr-text)] flex items-center gap-2">
              <Layers className="w-4 h-4 text-[var(--gr-accent-text)]" />
              <span>Layered topology</span>
            </span>
            <span>
              {isBeforeMode
                ? 'Showing architecture immediately before this commit'
                : 'Changed modules outlined in amber; unchanged modules muted'}
            </span>
          </div>

          {isBeforeMode && !prevCommit ? (
            <div className="p-12 rounded-xl bg-[var(--gr-surface)] border border-[var(--gr-border)] text-center space-y-2">
              <div className="text-[14px] font-medium text-[var(--gr-text)]">
                Empty repository before commit #1
              </div>
              <p className="text-[12px] text-[var(--gr-muted)] max-w-md mx-auto">
                {activeCommit.shortSha} introduces the initial architecture. Toggle back to “After” to inspect the first modules created here.
              </p>
            </div>
          ) : (
            <div
              ref={diagramRef}
              className="relative rounded-xl bg-[var(--gr-surface)] border border-[var(--gr-border)] p-5 space-y-6 overflow-hidden"
            >
              {/* SVG Overlay for Visible Data Flow Arrows */}
              {arrowCoords.length > 0 && (
                <svg
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full pointer-events-none z-10"
                >
                  <defs>
                    <marker
                      id="gr-arrow-muted"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--gr-border-strong)" />
                    </marker>
                    <marker
                      id="gr-arrow-accent"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#E0A458" />
                    </marker>
                  </defs>

                  {arrowCoords.map((arrow) => {
                    const midY = (arrow.y1 + arrow.y2) / 2;
                    const isHorizontal = Math.abs(arrow.y1 - arrow.y2) < 12;
                    const pathD = isHorizontal
                      ? `M ${arrow.x1} ${arrow.y1} L ${arrow.x2} ${arrow.y2}`
                      : `M ${arrow.x1} ${arrow.y1} C ${arrow.x1} ${midY}, ${arrow.x2} ${midY}, ${arrow.x2} ${arrow.y2}`;

                    return (
                      <path
                        key={arrow.key}
                        d={pathD}
                        fill="none"
                        stroke={arrow.isNew ? '#E0A458' : 'var(--gr-border-strong)'}
                        strokeWidth={arrow.isNew ? 1.75 : 1.25}
                        strokeDasharray={arrow.isNew ? undefined : '4 3'}
                        markerEnd={
                          arrow.isNew ? 'url(#gr-arrow-accent)' : 'url(#gr-arrow-muted)'
                        }
                      />
                    );
                  })}
                </svg>
              )}

              {/* Horizontal Layer Bands */}
              {TIERS.map((tier) => {
                const tierModules = modules.filter((m) => m.layer === tier.key);
                if (tierModules.length === 0) return null;

                return (
                  <div
                    key={tier.key}
                    className="relative z-20 space-y-2.5 pb-4 last:pb-0 border-b last:border-b-0 border-[var(--gr-border)]"
                  >
                    <div className="text-[12px] font-medium text-[var(--gr-muted)]">
                      {tier.label}
                    </div>

                    <div className="flex flex-wrap gap-4">
                      {tierModules.map((mod) => {
                        const isChanged =
                          !isBeforeMode &&
                          (mod.status === 'added' || mod.status === 'modified');
                        const isSelected = selectedModule?.id === mod.id;

                        return (
                          <button
                            key={mod.id}
                            ref={(el) => {
                              nodeRefs.current[mod.id] = el;
                            }}
                            type="button"
                            onClick={() => setSelectedModuleId(mod.id)}
                            className={`flex-1 min-w-[200px] text-left p-3.5 rounded-lg border transition-all duration-150 ease-out cursor-pointer ${
                              isSelected
                                ? 'bg-[var(--gr-surface-elevated)] border-[#E0A458]'
                                : isChanged
                                ? 'bg-[var(--gr-bg)] border-[#E0A458]/70 hover:border-[#E0A458]'
                                : 'bg-[var(--gr-bg)] border-[var(--gr-border)] opacity-65 hover:opacity-100'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <span className="text-[14px] font-semibold text-[var(--gr-text)] leading-snug">
                                {mod.name}
                              </span>
                              {!isBeforeMode && (mod.status === 'added' || mod.status === 'modified') ? (
                                <span className="text-[12px] font-mono text-[var(--gr-accent-text)] border border-[#E0A458]/50 bg-[var(--gr-accent-soft)] px-1.5 py-0.5 rounded shrink-0">
                                  {mod.status}
                                </span>
                              ) : (
                                <span className="text-[12px] font-mono text-[var(--gr-muted)] shrink-0">
                                  {isBeforeMode ? 'prior' : mod.status}
                                </span>
                              )}
                            </div>

                            <p className="text-[12px] text-[var(--gr-muted)] leading-relaxed">
                              {mod.description}
                            </p>

                            {mod.metrics && (
                              <div className="mt-2 text-[12px] font-mono text-[var(--gr-text)] tabular-nums">
                                {mod.metrics}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right 4 Cols: Selected Module & Un-truncated Connections List */}
        <aside className="lg:col-span-4 space-y-5">
          {selectedModule && (
            <div className="p-5 rounded-xl bg-[var(--gr-surface)] border border-[var(--gr-border)] space-y-3">
              <div className="text-[12px] text-[var(--gr-muted)] font-mono">
                {selectedModule.layer} · {isBeforeMode ? 'prior state' : selectedModule.status}
              </div>
              <h2 className="text-[16px] font-semibold text-[var(--gr-text)]">
                {selectedModule.name}
              </h2>
              <p className="text-[14px] text-[var(--gr-muted)] leading-relaxed">
                {selectedModule.description}
              </p>
              {selectedModule.metrics && (
                <div className="pt-2 border-t border-[var(--gr-border)] text-[12px] font-mono text-[var(--gr-accent-text)] tabular-nums">
                  Observed: {selectedModule.metrics}
                </div>
              )}
            </div>
          )}

          <div className="p-5 rounded-xl bg-[var(--gr-surface)] border border-[var(--gr-border)] space-y-3">
            <div className="text-[12px] font-semibold text-[var(--gr-text)]">
              Data flow &amp; connections
            </div>

            {edges.length === 0 ? (
              <p className="text-[12px] text-[var(--gr-muted)]">
                No inter-module edges recorded in this snapshot.
              </p>
            ) : (
              <div className="divide-y divide-[var(--gr-border)]">
                {edges.map((edge, idx) => {
                  const fromName =
                    modules.find((m) => m.id === edge.from)?.name || edge.from;
                  const toName = modules.find((m) => m.id === edge.to)?.name || edge.to;
                  const highlightEdge = edge.isNew && !isBeforeMode;

                  return (
                    <div
                      key={idx}
                      className={`py-3 first:pt-1 last:pb-1 text-[12px] ${
                        highlightEdge ? 'opacity-100' : 'opacity-80'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-1.5 text-[var(--gr-text)] font-medium leading-snug">
                        <span className="whitespace-normal break-words">{fromName}</span>
                        <ArrowRight
                          className={`w-3.5 h-3.5 shrink-0 ${
                            highlightEdge
                              ? 'text-[var(--gr-accent-text)]'
                              : 'text-[var(--gr-muted)]'
                          }`}
                        />
                        <span className="whitespace-normal break-words">{toName}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[12px] font-mono text-[var(--gr-muted)]">
                        <span className="whitespace-normal break-words">{edge.protocol}</span>
                        {highlightEdge && (
                          <span className="text-[var(--gr-accent-text)] font-medium shrink-0">
                            Updated
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
