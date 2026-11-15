import React, { useState, useEffect } from 'react';
import {
  X,
  GitBranch,
  Terminal,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Tag,
} from 'lucide-react';
import { GitRepository } from '../types/git';
import { parseRawGitLog } from '../utils/gitEngine';
import { SAMPLE_RAW_GIT_LOG } from '../data/repositories';
import {
  parseGitHubSlug,
  fetchGitHubCommitPage,
  getGitHubToken,
  setGitHubToken,
  subscribeRateLimit,
  RateLimitInfo,
  formatRetryTime,
} from '../utils/githubApi';

interface ImportGitModalProps {
  isOpen: boolean;
  initialTab?: 'github' | 'raw';
  onClose: () => void;
  onImportRepository: (repo: GitRepository) => void;
}

export const ImportGitModal: React.FC<ImportGitModalProps> = ({
  isOpen,
  initialTab = 'github',
  onClose,
  onImportRepository,
}) => {
  const [activeTab, setActiveTab] = useState<'github' | 'raw'>(initialTab);
  const [githubRepoSlug, setGithubRepoSlug] = useState('vitejs/vite');
  const [commitCount, setCommitCount] = useState<number>(30);

  // Optional filters & token
  const [filtersOpen, setFiltersOpen] = useState<boolean>(false);
  const [filterPath, setFilterPath] = useState<string>('');
  const [sinceDate, setSinceDate] = useState<string>('');
  const [untilDate, setUntilDate] = useState<string>('');
  const [tagFrom, setTagFrom] = useState<string>('');
  const [tagTo, setTagTo] = useState<string>('');
  const [milestonesOnly, setMilestonesOnly] = useState<boolean>(false);
  const [githubTokenInput, setGithubTokenInput] = useState<string>(() => getGitHubToken());

  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [rawLogInput, setRawLogInput] = useState(SAMPLE_RAW_GIT_LOG);
  const [customRepoName, setCustomRepoName] = useState('acme-corp/db-connection-pool');

  useEffect(() => {
    return subscribeRateLimit(setRateLimit);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setErrorMsg(null);
      setGithubTokenInput(getGitHubToken());
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const handleCommitCountChange = (val: number) => {
    if (Number.isNaN(val)) {
      setCommitCount(1);
      return;
    }
    setCommitCount(Math.max(1, Math.min(200, Math.round(val))));
  };

  const handleFetchGitHub = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const parsed = parseGitHubSlug(githubRepoSlug);
    if (!parsed) {
      setErrorMsg(
        'Enter a valid GitHub URL (e.g. https://github.com/facebook/react) or slug (owner/repo).'
      );
      return;
    }

    // Persist local token right before making direct api.github.com calls
    setGitHubToken(githubTokenInput);

    setIsLoading(true);
    try {
      const result = await fetchGitHubCommitPage({
        owner: parsed.owner,
        repo: parsed.repo,
        targetCount: commitCount,
        page: 1,
        filterPath,
        since: sinceDate,
        until: untilDate,
        tagFrom,
        tagTo,
        milestonesOnly,
      });

      onImportRepository({
        id: `gh-${parsed.owner}-${parsed.repo}-${Date.now()}`,
        owner: parsed.owner,
        name: parsed.repo,
        description: result.description,
        defaultBranch: result.defaultBranch,
        primaryLanguage: result.primaryLanguage,
        commits: result.commits,
        githubMeta: result.githubMeta,
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to fetch GitHub repository.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleParseRawLog = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawLogInput.trim()) {
      setErrorMsg('Paste a valid `git log -p` output first.');
      return;
    }
    const parsedRepo = parseRawGitLog(
      rawLogInput,
      customRepoName.trim() || 'local/custom-replay'
    );
    if (parsedRepo.commits.length === 0) {
      setErrorMsg('No commits could be parsed from the provided git log.');
      return;
    }
    onImportRepository(parsedRepo);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-git-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-[var(--gr-surface)] border border-[var(--gr-border)] rounded-xl overflow-hidden shadow-xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--gr-border)] shrink-0">
          <div>
            <h2
              id="import-git-modal-title"
              className="text-[16px] font-semibold text-[var(--gr-text)]"
            >
              Import Git Commit History into Timeline
            </h2>
            {rateLimit && (
              <div className="text-[11px] font-mono text-[var(--gr-muted)] mt-0.5 tabular-nums">
                GitHub API limit: {rateLimit.remaining} / {rateLimit.limit} remaining
                {rateLimit.remaining === 0
                  ? ` · resets at ${formatRetryTime(rateLimit.resetAtMs)}`
                  : ''}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-[var(--gr-muted)] hover:text-[var(--gr-text)] rounded-lg cursor-pointer transition-colors duration-150"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="px-6 pt-4 flex items-center gap-2 border-b border-[var(--gr-border)] pb-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTab('github');
              setErrorMsg(null);
            }}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors duration-150 ${
              activeTab === 'github'
                ? 'bg-[#E0A458] text-[#141414] font-semibold'
                : 'bg-[var(--gr-bg)] text-[var(--gr-muted)] hover:text-[var(--gr-text)] border border-[var(--gr-border)]'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Fetch GitHub Repo</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('raw');
              setErrorMsg(null);
            }}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors duration-150 ${
              activeTab === 'raw'
                ? 'bg-[#E0A458] text-[#141414] font-semibold'
                : 'bg-[var(--gr-bg)] text-[var(--gr-muted)] hover:text-[var(--gr-text)] border border-[var(--gr-border)]'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Paste Raw git log -p</span>
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 overflow-y-auto">
          {errorMsg && (
            <div className="mb-4 p-3 rounded-lg bg-[var(--gr-danger-bg)] border border-[var(--gr-danger-border)] flex items-start gap-2 text-[12px] text-[var(--gr-danger-text)]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {activeTab === 'github' ? (
            <form onSubmit={handleFetchGitHub} className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-[var(--gr-text)] mb-1.5">
                  GitHub Repository Link or Slug
                </label>
                <input
                  type="text"
                  value={githubRepoSlug}
                  onChange={(e) => setGithubRepoSlug(e.target.value)}
                  placeholder="https://github.com/facebook/react or vitejs/vite"
                  className="w-full px-3.5 py-2 bg-[var(--gr-bg)] border border-[var(--gr-border)] rounded-lg text-[14px] font-mono text-[var(--gr-text)] focus:outline-none focus:border-[#E0A458]"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[var(--gr-muted)]">
                  <span>Quick presets:</span>
                  {[
                    'https://github.com/vitejs/vite',
                    'https://github.com/tailwindlabs/tailwindcss',
                    'https://github.com/pmndrs/zustand',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setGithubRepoSlug(preset)}
                      className="text-[var(--gr-accent-text)] hover:underline font-mono cursor-pointer"
                    >
                      {preset.replace('https://github.com/', '')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Commit Count Slider + Number Input up to 200 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor="commit-count-number"
                    className="text-[12px] font-medium text-[var(--gr-text)]"
                  >
                    Commits to Fetch Initially (up to 200; diffs load lazily)
                  </label>
                  <input
                    id="commit-count-number"
                    type="number"
                    min={1}
                    max={200}
                    value={commitCount}
                    onChange={(e) => handleCommitCountChange(Number(e.target.value))}
                    className="w-20 px-2.5 py-1 bg-[var(--gr-bg)] border border-[var(--gr-border)] rounded-lg text-[12px] font-mono text-right text-[var(--gr-text)] focus:outline-none focus:border-[#E0A458] tabular-nums"
                  />
                </div>
                <input
                  type="range"
                  min={1}
                  max={200}
                  value={commitCount}
                  onChange={(e) => handleCommitCountChange(Number(e.target.value))}
                  aria-label="Commits to fetch initially"
                  className="w-full accent-[#E0A458] cursor-pointer"
                />
                <div className="flex items-center justify-between text-[11px] font-mono text-[var(--gr-muted)] tabular-nums">
                  <span>1</span>
                  <span>50</span>
                  <span>100</span>
                  <span>150</span>
                  <span>200</span>
                </div>
              </div>

              {/* Milestones only quick toggle */}
              <label className="flex items-center justify-between p-3 rounded-lg bg-[var(--gr-bg)] border border-[var(--gr-border)] cursor-pointer">
                <span className="flex items-center gap-2 text-[12px] font-medium text-[var(--gr-text)]">
                  <Tag className="w-3.5 h-3.5 text-[var(--gr-accent-text)]" />
                  <span>Milestones only (tags / releases)</span>
                </span>
                <input
                  type="checkbox"
                  checked={milestonesOnly}
                  onChange={(e) => setMilestonesOnly(e.target.checked)}
                  className="w-4 h-4 accent-[#E0A458] cursor-pointer"
                />
              </label>

              {/* Collapsible Optional Filters & Local GitHub Token */}
              <div className="rounded-lg border border-[var(--gr-border)] bg-[var(--gr-bg)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setFiltersOpen((v) => !v)}
                  aria-expanded={filtersOpen}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between text-[12px] font-medium text-[var(--gr-text)] hover:bg-[var(--gr-surface-elevated)]/50 cursor-pointer transition-colors duration-150"
                >
                  <span>Optional filters &amp; GitHub token</span>
                  {filtersOpen ? (
                    <ChevronDown className="w-4 h-4 text-[var(--gr-muted)]" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-[var(--gr-muted)]" />
                  )}
                </button>

                {filtersOpen && (
                  <div className="p-3.5 border-t border-[var(--gr-border)] space-y-3">
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--gr-muted)] mb-1">
                        Folder or file path filter (optional, e.g. packages/vite/ or lib/)
                      </label>
                      <input
                        type="text"
                        value={filterPath}
                        onChange={(e) => setFilterPath(e.target.value)}
                        placeholder="src/ or lib/"
                        className="w-full px-3 py-1.5 bg-[var(--gr-surface)] border border-[var(--gr-border)] rounded-lg text-[12px] font-mono text-[var(--gr-text)] focus:outline-none focus:border-[#E0A458]"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--gr-muted)] mb-1">
                          Date range: Since
                        </label>
                        <input
                          type="date"
                          value={sinceDate}
                          onChange={(e) => setSinceDate(e.target.value)}
                          className="w-full px-3 py-1.5 bg-[var(--gr-surface)] border border-[var(--gr-border)] rounded-lg text-[12px] font-mono text-[var(--gr-text)] focus:outline-none focus:border-[#E0A458]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--gr-muted)] mb-1">
                          Date range: Until
                        </label>
                        <input
                          type="date"
                          value={untilDate}
                          onChange={(e) => setUntilDate(e.target.value)}
                          className="w-full px-3 py-1.5 bg-[var(--gr-surface)] border border-[var(--gr-border)] rounded-lg text-[12px] font-mono text-[var(--gr-text)] focus:outline-none focus:border-[#E0A458]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--gr-muted)] mb-1">
                          From tag / release (optional)
                        </label>
                        <input
                          type="text"
                          value={tagFrom}
                          onChange={(e) => setTagFrom(e.target.value)}
                          placeholder="e.g. v5.0.0"
                          className="w-full px-3 py-1.5 bg-[var(--gr-surface)] border border-[var(--gr-border)] rounded-lg text-[12px] font-mono text-[var(--gr-text)] focus:outline-none focus:border-[#E0A458]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--gr-muted)] mb-1">
                          To tag / release (optional)
                        </label>
                        <input
                          type="text"
                          value={tagTo}
                          onChange={(e) => setTagTo(e.target.value)}
                          placeholder="e.g. v5.1.0"
                          className="w-full px-3 py-1.5 bg-[var(--gr-surface)] border border-[var(--gr-border)] rounded-lg text-[12px] font-mono text-[var(--gr-text)] focus:outline-none focus:border-[#E0A458]"
                        />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-[var(--gr-border)]">
                      <label className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--gr-muted)] mb-1">
                        <KeyRound className="w-3 h-3 text-[var(--gr-accent-text)]" />
                        <span>GitHub personal access token (optional)</span>
                      </label>
                      <input
                        type="password"
                        value={githubTokenInput}
                        onChange={(e) => setGithubTokenInput(e.target.value)}
                        placeholder="ghp_... or github_pat_..."
                        autoComplete="off"
                        className="w-full px-3 py-1.5 bg-[var(--gr-surface)] border border-[var(--gr-border)] rounded-lg text-[12px] font-mono text-[var(--gr-text)] focus:outline-none focus:border-[#E0A458]"
                      />
                      <p className="text-[11px] text-[var(--gr-muted)] mt-1">
                        Stored locally in your browser and sent only to api.github.com to raise
                        rate limits and access private repos.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-[12px] font-medium text-[var(--gr-muted)] hover:text-[var(--gr-text)] cursor-pointer transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-4 py-2 bg-[#E0A458] hover:bg-[#E8B46E] disabled:opacity-50 text-[#141414] font-semibold rounded-lg text-[12px] flex items-center gap-2 cursor-pointer transition-colors duration-150"
                >
                  {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isLoading ? 'Fetching Commit List...' : 'Build Playable Timeline'}</span>
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleParseRawLog} className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-[var(--gr-text)] mb-1.5">
                  Repository Identifier
                </label>
                <input
                  type="text"
                  value={customRepoName}
                  onChange={(e) => setCustomRepoName(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[var(--gr-bg)] border border-[var(--gr-border)] rounded-lg text-[14px] font-mono text-[var(--gr-text)] focus:outline-none focus:border-[#E0A458]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-[var(--gr-text)] mb-1.5">
                  Raw `git log -p` Output
                </label>
                <textarea
                  rows={9}
                  value={rawLogInput}
                  onChange={(e) => setRawLogInput(e.target.value)}
                  className="w-full p-3 bg-[var(--gr-bg)] border border-[var(--gr-border)] rounded-lg text-[12px] font-mono text-[var(--gr-text)] focus:outline-none focus:border-[#E0A458]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-[12px] font-medium text-[var(--gr-muted)] hover:text-[var(--gr-text)] cursor-pointer transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#E0A458] hover:bg-[#E8B46E] text-[#141414] font-semibold rounded-lg text-[12px] cursor-pointer transition-colors duration-150"
                >
                  Parse &amp; Replay Git Log
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
