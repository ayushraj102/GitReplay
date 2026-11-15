import React, { useMemo } from 'react';
import { ArrowRight, ArrowDown, Play } from 'lucide-react';
import { GitRepository, ArchitectureModule } from '../types/git';

interface OverviewTabProps {
  repository: GitRepository;
  isLoading?: boolean;
  onStartGuidedTour: () => void;
  onSelectCommitIndex: (index: number) => void;
  onOpenArchitecture: () => void;
}

const MINI_TIERS: Array<{ key: ArchitectureModule['layer']; label: string }> = [
  { key: 'client', label: 'Query / Client' },
  { key: 'edge', label: 'Transport / Edge' },
  { key: 'core', label: 'Execution / Core' },
  { key: 'storage', label: 'Storage' },
];

export const OverviewTab: React.FC<OverviewTabProps> = ({
  repository,
  isLoading = false,
  onStartGuidedTour,
  onSelectCommitIndex,
  onOpenArchitecture,
}) => {
  const commits = repository.commits;

  const stats = useMemo(() => {
    const authors = new Set(commits.map((c) => c.author));
    const firstDate = commits[0]?.timestamp?.split(' ')[0] || '—';
    const lastDate = commits[commits.length - 1]?.timestamp?.split(' ')[0] || '—';
    const tagged = [...commits].reverse().find((c) => c.tag);
    const currentVersion =
      tagged?.tag || commits[commits.length - 1]?.shortSha || 'HEAD';

    return {
      commitCount: commits.length,
      contributorCount: authors.size,
      dateRange: firstDate === lastDate ? firstDate : `${firstDate} — ${lastDate}`,
      currentVersion,
    };
  }, [commits]);

  const milestones = useMemo(() => {
    const flagged = commits
      .map((commit, index) => ({ commit, index }))
      .filter(({ commit }) => commit.isArchitecturalMilestone);

    if (flagged.length >= 3) {
      return flagged.slice(0, 4);
    }

    const indices = Array.from(
      new Set([0, Math.floor(commits.length / 2), Math.max(0, commits.length - 1)])
    ).slice(0, 3);
    return indices
      .map((idx) => ({ commit: commits[idx], index: idx }))
      .filter((x) => Boolean(x.commit));
  }, [commits]);

  const latestCommit = commits[commits.length - 1];
  const latestModules = latestCommit?.adr?.modules || [];
  const activeTiers = MINI_TIERS.filter((tier) =>
    latestModules.some((m) => m.layer === tier.key)
  );

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12 space-y-8 animate-pulse">
        <div className="space-y-4 pb-8 border-b border-[var(--gr-border)]">
          <div className="h-4 w-48 bg-[var(--gr-surface-elevated)] rounded" />
          <div className="h-8 w-72 bg-[var(--gr-surface-elevated)] rounded-lg" />
          <div className="h-4 w-full max-w-xl bg-[var(--gr-surface-elevated)] rounded" />
          <div className="h-10 w-44 bg-[var(--gr-surface-elevated)] rounded-lg" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-7 h-56 bg-[var(--gr-surface)] rounded-xl border border-[var(--gr-border)]" />
          <div className="lg:col-span-5 h-56 bg-[var(--gr-surface)] rounded-xl border border-[var(--gr-border)]" />
        </div>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center space-y-3">
        <h2 className="text-[20px] font-semibold text-[var(--gr-text)]">
          No commits loaded yet
        </h2>
        <p className="text-[14px] text-[var(--gr-muted)]">
          Select a repository from the top bar dropdown or load a public GitHub link to start exploring code evolution.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-10">
      {/* Top Hero: Identity + Description + Primary CTA + Single Inline Row of Muted Stats */}
      <section className="space-y-5 pb-8 border-b border-[var(--gr-border)]">
        <div className="flex flex-wrap items-center gap-2 text-[12px] font-mono text-[var(--gr-muted)]">
          <span>{repository.owner}</span>
          <span aria-hidden="true">/</span>
          <span>{repository.defaultBranch}</span>
          <span aria-hidden="true">·</span>
          <span>{repository.primaryLanguage}</span>
        </div>

        <div className="space-y-3 max-w-3xl">
          <h1 className="text-[28px] font-semibold tracking-tight text-[var(--gr-text)] leading-tight text-balance">
            {repository.name}
          </h1>
          <p className="text-[16px] text-[var(--gr-muted)] leading-relaxed">
            {repository.description}
          </p>
        </div>

        {/* Strongest Primary Element Directly Under Title & Description */}
        <div className="pt-1 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={onStartGuidedTour}
            className="h-10 px-5 rounded-lg bg-[#E0A458] hover:bg-[#E8B46E] text-[#141414] text-[14px] font-semibold inline-flex items-center gap-2 transition-colors duration-150 ease-out whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Start guided tour</span>
          </button>

          <span className="text-[12px] text-[var(--gr-muted)]">
            Replay {commits.length} commits from initial implementation to {stats.currentVersion}
          </span>
        </div>

        {/* Single Inline Row of Muted Stats */}
        <dl className="pt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-[var(--gr-muted)] tabular-nums">
          <div className="flex items-center gap-1.5">
            <dt>Commits</dt>
            <dd className="font-mono font-medium text-[var(--gr-text)]">{stats.commitCount}</dd>
          </div>
          <span className="text-[var(--gr-border-strong)]" aria-hidden="true">
            ·
          </span>
          <div className="flex items-center gap-1.5">
            <dt>Contributors</dt>
            <dd className="font-mono font-medium text-[var(--gr-text)]">
              {stats.contributorCount}
            </dd>
          </div>
          <span className="text-[var(--gr-border-strong)]" aria-hidden="true">
            ·
          </span>
          <div className="flex items-center gap-1.5">
            <dt>Timeline</dt>
            <dd className="font-mono text-[var(--gr-text)]">{stats.dateRange}</dd>
          </div>
          <span className="text-[var(--gr-border-strong)]" aria-hidden="true">
            ·
          </span>
          <div className="flex items-center gap-1.5">
            <dt>Version</dt>
            <dd className="font-mono font-medium text-[var(--gr-accent-text)]">
              {stats.currentVersion}
            </dd>
          </div>
        </dl>
      </section>

      {/* Two-Column Editorial Section: Vertical Mini-Timeline Milestones + Simplified Layer Diagram */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* Key Milestones Vertical Mini-Timeline (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          <div className="flex items-baseline justify-between border-b border-[var(--gr-border)] pb-3">
            <h2 className="text-[16px] font-semibold text-[var(--gr-text)]">
              Key milestones
            </h2>
            <span className="text-[12px] text-[var(--gr-muted)] tabular-nums">
              {milestones.length} architectural shifts
            </span>
          </div>

          <div className="relative pl-6 space-y-6">
            {/* Vertical Connecting Line */}
            {milestones.length > 1 && (
              <div
                aria-hidden="true"
                className="absolute left-[7px] top-2 bottom-3 w-px bg-[var(--gr-border-strong)]"
              />
            )}

            {milestones.map(({ commit, index }, mIdx) => {
              const isLatestMilestone = mIdx === milestones.length - 1;
              return (
                <button
                  key={commit.sha}
                  type="button"
                  onClick={() => onSelectCommitIndex(index)}
                  className="relative w-full text-left group flex items-start justify-between gap-4 cursor-pointer rounded-lg py-1 transition-colors duration-150 ease-out"
                >
                  {/* Node Dot on Vertical Line */}
                  <span
                    aria-hidden="true"
                    className={`absolute -left-6 top-2 w-3.5 h-3.5 rounded-full border-2 transition-colors duration-150 ease-out ${
                      isLatestMilestone
                        ? 'bg-[#E0A458] border-[#E0A458]'
                        : 'bg-[var(--gr-bg)] border-[var(--gr-border-strong)] group-hover:border-[#E0A458]'
                    }`}
                  />

                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--gr-muted)] tabular-nums">
                      <span className="font-mono text-[var(--gr-accent-text)] font-medium">
                        {commit.shortSha}
                      </span>
                      {commit.tag && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono font-medium text-[var(--gr-text)]">
                            {commit.tag}
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>Step {index + 1}</span>
                      <span aria-hidden="true">·</span>
                      <span>{commit.category}</span>
                    </div>

                    <div className="text-[14px] font-medium text-[var(--gr-text)] group-hover:text-[var(--gr-accent-text)] transition-colors duration-150 ease-out">
                      {commit.title}
                    </div>

                    <p className="text-[12px] text-[var(--gr-muted)] leading-relaxed line-clamp-1">
                      {commit.adr?.decisionSummary || commit.message}
                    </p>
                  </div>

                  <ArrowRight className="w-4 h-4 text-[var(--gr-muted)] group-hover:text-[var(--gr-accent-text)] group-hover:translate-x-0.5 shrink-0 mt-1 transition-all duration-150 ease-out" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Simplified Current Architecture Diagram (5 cols) */}
        <div className="lg:col-span-5 space-y-5">
          <div className="flex items-baseline justify-between border-b border-[var(--gr-border)] pb-3">
            <h2 className="text-[16px] font-semibold text-[var(--gr-text)]">
              Current architecture
            </h2>
            <span className="text-[12px] font-mono text-[var(--gr-muted)] tabular-nums">
              {latestModules.length} modules
            </span>
          </div>

          <div className="rounded-xl bg-[var(--gr-surface)] border border-[var(--gr-border)] p-4 space-y-2">
            {activeTiers.length === 0 ? (
              <p className="text-[12px] text-[var(--gr-muted)] py-4 text-center">
                No module topology recorded on latest commit.
              </p>
            ) : (
              activeTiers.map((tier, tierIdx) => {
                const tierMods = latestModules.filter((m) => m.layer === tier.key);
                return (
                  <React.Fragment key={tier.key}>
                    <div className="space-y-1.5">
                      <div className="text-[12px] font-medium text-[var(--gr-muted)]">
                        {tier.label}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {tierMods.map((mod) => {
                          const isHighlighted =
                            mod.status === 'added' || mod.status === 'modified';
                          return (
                            <div
                              key={mod.id}
                              className={`flex-1 min-w-[130px] px-3 py-2 rounded-lg border text-left transition-colors duration-150 ${
                                isHighlighted
                                  ? 'bg-[var(--gr-accent-soft)] border-[#E0A458]/60'
                                  : 'bg-[var(--gr-bg)] border-[var(--gr-border)]'
                              }`}
                            >
                              <div className="text-[12px] font-semibold text-[var(--gr-text)] leading-snug">
                                {mod.name}
                              </div>
                              {mod.metrics && (
                                <div className="text-[12px] font-mono text-[var(--gr-muted)] mt-0.5 tabular-nums">
                                  {mod.metrics}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {tierIdx < activeTiers.length - 1 && (
                      <div
                        aria-hidden="true"
                        className="flex justify-center py-0.5 text-[var(--gr-muted)]"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </div>

          <button
            type="button"
            onClick={onOpenArchitecture}
            className="text-[12px] font-medium text-[var(--gr-accent-text)] hover:underline inline-flex items-center gap-1.5 cursor-pointer transition-opacity duration-150"
          >
            <span>Inspect interactive architecture diagram</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>
    </div>
  );
};
