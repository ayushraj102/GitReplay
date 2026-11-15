import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  GitBranch,
  Download,
  Check,
  Plus,
  Terminal,
  Trash2,
  LogIn,
  LogOut,
  User as UserIcon,
  FileText,
  FileCode,
  Sun,
  Moon,
  Settings,
  Database,
  KeyRound,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { GitRepository } from '../types/git';
import {
  countCachedAIResponses,
  clearAllAICache,
  countCachedCommitDiffs,
  clearCommitDiffCache,
} from '../utils/idbCache';
import { clearCloudAICache } from '../firebase';
import {
  getGitHubToken,
  setGitHubToken,
  subscribeRateLimit,
  RateLimitInfo,
  formatRetryTime,
} from '../utils/githubApi';

export type MainTab = 'overview' | 'timeline' | 'architecture';
export type ThemeMode = 'dark' | 'light';

interface TopBarProps {
  repositories: GitRepository[];
  activeRepo: GitRepository;
  activeTab: MainTab;
  theme: ThemeMode;
  user: User | null;
  exportedBanner: boolean;
  isCustomRepo: (id: string) => boolean;
  onSelectRepo: (repoId: string) => void;
  onDeleteRepo: (repoId: string) => void;
  onSelectTab: (tab: MainTab) => void;
  onToggleTheme: () => void;
  onOpenImportModal: (mode: 'github' | 'raw') => void;
  onExportMarkdown: () => void;
  onExportPdf: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  repositories,
  activeRepo,
  activeTab,
  theme,
  user,
  exportedBanner,
  isCustomRepo,
  onSelectRepo,
  onDeleteRepo,
  onSelectTab,
  onToggleTheme,
  onOpenImportModal,
  onExportMarkdown,
  onExportPdf,
  onSignIn,
  onSignOut,
}) => {
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [savedAnswersCount, setSavedAnswersCount] = useState<number>(0);
  const [cachedDiffsCount, setCachedDiffsCount] = useState<number>(0);
  const [isClearingCache, setIsClearingCache] = useState<boolean>(false);
  const [cacheClearedToast, setCacheClearedToast] = useState<boolean>(false);
  const [githubTokenInput, setGithubTokenInput] = useState<string>(() => getGitHubToken());
  const [tokenSavedToast, setTokenSavedToast] = useState<boolean>(false);
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);

  const repoMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  const refreshCacheCounts = async () => {
    const [aiCount, diffCount] = await Promise.all([
      countCachedAIResponses(),
      countCachedCommitDiffs(),
    ]);
    setSavedAnswersCount(aiCount);
    setCachedDiffsCount(diffCount);
  };

  useEffect(() => {
    refreshCacheCounts();
    const onCacheUpdated = () => {
      refreshCacheCounts();
    };
    window.addEventListener('gitreplay-cache-updated', onCacheUpdated);
    const unsubRate = subscribeRateLimit(setRateLimit);
    return () => {
      window.removeEventListener('gitreplay-cache-updated', onCacheUpdated);
      unsubRate();
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (repoMenuRef.current && !repoMenuRef.current.contains(e.target as Node)) {
        setRepoMenuOpen(false);
      }
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false);
      }
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) {
        setSettingsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleClearAICache = async () => {
    if (isClearingCache) return;
    setIsClearingCache(true);
    try {
      await Promise.all([clearAllAICache(), clearCommitDiffCache()]);
      if (user) {
        await clearCloudAICache(user.uid).catch((err) =>
          console.error('Failed to clear cloud AI cache:', err)
        );
      }
      await refreshCacheCounts();
      setCacheClearedToast(true);
      setTimeout(() => setCacheClearedToast(false), 2000);
    } finally {
      setIsClearingCache(false);
    }
  };

  const handleSaveToken = (e: React.FormEvent) => {
    e.preventDefault();
    setGitHubToken(githubTokenInput);
    setTokenSavedToast(true);
    setTimeout(() => setTokenSavedToast(false), 1800);
  };

  return (
    <header className="relative h-14 px-6 border-b border-[var(--gr-border)] bg-[var(--gr-surface)] flex items-center justify-between gap-6 select-none">
      {/* Left: Brand Wordmark + Single Repo Selector Dropdown */}
      <div className="flex items-center gap-3.5 min-w-0">
        <button
          type="button"
          onClick={() => onSelectTab('overview')}
          className="text-[16px] font-semibold tracking-tight text-[var(--gr-text)] whitespace-nowrap shrink-0 cursor-pointer transition-opacity duration-150 ease-out hover:opacity-80"
        >
          GitReplay
        </button>

        <span className="text-[var(--gr-border-strong)]" aria-hidden="true">
          /
        </span>

        <div className="relative" ref={repoMenuRef}>
          <button
            type="button"
            onClick={() => setRepoMenuOpen((o) => !o)}
            aria-expanded={repoMenuOpen}
            className="h-8 px-3 rounded-lg bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] border border-[var(--gr-border)] text-[12px] font-mono text-[var(--gr-text)] flex items-center gap-2 transition-colors duration-150 ease-out cursor-pointer whitespace-nowrap max-w-[260px]"
          >
            <GitBranch className="w-3.5 h-3.5 text-[var(--gr-accent-text)] shrink-0" />
            <span className="truncate">
              {activeRepo.owner}/{activeRepo.name}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-[var(--gr-muted)] shrink-0" />
          </button>

          {repoMenuOpen && (
            <div className="absolute left-0 mt-2 w-80 rounded-xl bg-[var(--gr-surface)] border border-[var(--gr-border)] shadow-lg py-2 z-50">
              <div className="px-3 py-1.5 text-[12px] font-medium text-[var(--gr-muted)]">
                Repositories
              </div>

              <div className="max-h-60 overflow-y-auto px-1.5 space-y-0.5">
                {repositories.map((repo) => {
                  const isCurrent = repo.id === activeRepo.id;
                  const custom = isCustomRepo(repo.id);
                  return (
                    <div
                      key={repo.id}
                      className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-[12px] transition-colors duration-150 ease-out ${
                        isCurrent
                          ? 'bg-[var(--gr-accent-soft)] text-[var(--gr-accent-text)] font-medium'
                          : 'text-[var(--gr-text)] hover:bg-[var(--gr-surface-elevated)]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectRepo(repo.id);
                          setRepoMenuOpen(false);
                        }}
                        className="flex-1 text-left font-mono truncate cursor-pointer"
                      >
                        {repo.owner}/{repo.name}
                      </button>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        <span className="text-[12px] font-mono text-[var(--gr-muted)] tabular-nums">
                          {repo.commits.length}
                        </span>
                        {custom && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteRepo(repo.id);
                            }}
                            title="Remove saved repository"
                            aria-label={`Remove ${repo.owner}/${repo.name}`}
                            className="p-1 text-[var(--gr-muted)] hover:text-[var(--gr-danger-text)] cursor-pointer transition-colors duration-150"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="my-2 border-t border-[var(--gr-border)]" />

              <div className="px-1.5 space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setRepoMenuOpen(false);
                    onOpenImportModal('github');
                  }}
                  className="w-full px-2.5 py-2 rounded-lg text-left text-[12px] text-[var(--gr-text)] hover:bg-[var(--gr-surface-elevated)] flex items-center gap-2 transition-colors duration-150 ease-out cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-[var(--gr-accent-text)]" />
                  <span>Load public GitHub link</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRepoMenuOpen(false);
                    onOpenImportModal('raw');
                  }}
                  className="w-full px-2.5 py-2 rounded-lg text-left text-[12px] text-[var(--gr-muted)] hover:text-[var(--gr-text)] hover:bg-[var(--gr-surface-elevated)] flex items-center gap-2 transition-colors duration-150 ease-out cursor-pointer"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Import git log</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Center: Strictly 3 Primary Tabs */}
      <nav
        aria-label="Primary navigation"
        className="hidden md:flex items-center h-full gap-8 text-[14px] font-medium"
      >
        {(
          [
            { id: 'overview', label: 'Overview' },
            { id: 'timeline', label: 'Timeline' },
            { id: 'architecture', label: 'Architecture' },
          ] as const
        ).map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`relative h-full flex items-center whitespace-nowrap shrink-0 transition-colors duration-150 ease-out cursor-pointer ${
                isActive
                  ? 'text-[var(--gr-text)] font-semibold'
                  : 'text-[var(--gr-muted)] hover:text-[var(--gr-text)]'
              }`}
            >
              <span>{tab.label}</span>
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#E0A458]" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Right: Theme Toggle + Settings + Export Dropdown + Account */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          type="button"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="h-8 w-8 rounded-lg bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] border border-[var(--gr-border)] text-[var(--gr-muted)] hover:text-[var(--gr-text)] flex items-center justify-center transition-colors duration-150 ease-out shrink-0 cursor-pointer"
        >
          {theme === 'dark' ? (
            <Sun className="w-3.5 h-3.5" />
          ) : (
            <Moon className="w-3.5 h-3.5" />
          )}
        </button>

        <div className="relative" ref={settingsMenuRef}>
          <button
            type="button"
            onClick={() => {
              const next = !settingsMenuOpen;
              setSettingsMenuOpen(next);
              if (next) refreshCacheCounts();
            }}
            aria-expanded={settingsMenuOpen}
            aria-label="Cache and workspace settings"
            title="Cache & settings"
            className="h-8 w-8 rounded-lg bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] border border-[var(--gr-border)] text-[var(--gr-muted)] hover:text-[var(--gr-text)] flex items-center justify-center transition-colors duration-150 ease-out shrink-0 cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          {settingsMenuOpen && (
            <div className="absolute right-0 mt-2 w-80 rounded-xl bg-[var(--gr-surface)] border border-[var(--gr-border)] shadow-lg p-3.5 z-50 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-[var(--gr-text)]">
                  Workspace &amp; Cache
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--gr-muted)] tabular-nums">
                  <Database className="w-3 h-3 text-[var(--gr-accent-text)]" />
                  <span>Saved answers: {savedAnswersCount}</span>
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono text-[var(--gr-muted)] tabular-nums">
                <span>Cached commit diffs: {cachedDiffsCount}</span>
                {rateLimit && (
                  <span>
                    API: {rateLimit.remaining}/{rateLimit.limit}
                  </span>
                )}
              </div>

              {rateLimit && rateLimit.remaining === 0 && (
                <div className="p-2 rounded-lg bg-[var(--gr-danger-bg)] border border-[var(--gr-danger-border)] text-[11px] text-[var(--gr-danger-text)]">
                  GitHub API limited. Resets at {formatRetryTime(rateLimit.resetAtMs)}.
                </div>
              )}

              <p className="text-[11px] text-[var(--gr-muted)] leading-relaxed">
                AI responses, per-commit threads, and fetched diffs are stored in IndexedDB
                {user ? ' with cloud AI sync' : ''}.
              </p>

              <form
                onSubmit={handleSaveToken}
                className="pt-2 border-t border-[var(--gr-border)] space-y-1.5"
              >
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--gr-text)]">
                  <KeyRound className="w-3 h-3 text-[var(--gr-accent-text)]" />
                  <span>GitHub token (local only)</span>
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="password"
                    value={githubTokenInput}
                    onChange={(e) => setGithubTokenInput(e.target.value)}
                    placeholder="ghp_... (optional)"
                    autoComplete="off"
                    className="flex-1 px-2.5 py-1 bg-[var(--gr-bg)] border border-[var(--gr-border)] rounded-lg text-[11px] font-mono text-[var(--gr-text)] focus:outline-none focus:border-[#E0A458]"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1 rounded-lg bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] border border-[var(--gr-border)] text-[11px] font-medium text-[var(--gr-text)] cursor-pointer whitespace-nowrap"
                  >
                    {tokenSavedToast ? 'Saved' : 'Save'}
                  </button>
                </div>
                <div className="text-[10px] text-[var(--gr-muted)]">
                  Sent only to api.github.com. Raises rate limits &amp; enables private repos.
                </div>
              </form>

              <div className="pt-2 border-t border-[var(--gr-border)] flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleClearAICache}
                  disabled={isClearingCache}
                  className="w-full h-8 px-3 rounded-lg bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] disabled:opacity-50 border border-[var(--gr-border)] text-[12px] font-medium text-[var(--gr-text)] flex items-center justify-center gap-1.5 transition-colors duration-150 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-[var(--gr-muted)]" />
                  <span>
                    {cacheClearedToast
                      ? 'Cache cleared'
                      : isClearingCache
                      ? 'Clearing...'
                      : 'Clear cache'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="relative" ref={exportMenuRef}>
          <button
            type="button"
            onClick={() => setExportMenuOpen((o) => !o)}
            aria-expanded={exportMenuOpen}
            className="h-8 px-3 rounded-lg bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] border border-[var(--gr-border)] text-[12px] font-medium text-[var(--gr-text)] flex items-center gap-1.5 transition-colors duration-150 ease-out whitespace-nowrap shrink-0 cursor-pointer"
          >
            {exportedBanner ? (
              <>
                <Check className="w-3.5 h-3.5 text-[var(--gr-accent-text)]" />
                <span>Exported</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5 text-[var(--gr-muted)]" />
                <span>Export</span>
                <ChevronDown className="w-3 h-3 text-[var(--gr-muted)]" />
              </>
            )}
          </button>

          {exportMenuOpen && (
            <div className="absolute right-0 mt-2 w-64 rounded-xl bg-[var(--gr-surface)] border border-[var(--gr-border)] shadow-lg py-1.5 z-50">
              <div className="px-3 py-1.5 text-[12px] font-medium text-[var(--gr-muted)]">
                Onboarding Report
              </div>
              <button
                type="button"
                onClick={() => {
                  setExportMenuOpen(false);
                  onExportPdf();
                }}
                className="w-full px-3 py-2 text-left hover:bg-[var(--gr-surface-elevated)] flex items-start gap-2.5 transition-colors duration-150 ease-out cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-[var(--gr-accent-text)] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-[var(--gr-text)]">
                    Summary report (.pdf)
                  </div>
                  <div className="text-[12px] text-[var(--gr-muted)]">
                    Condensed stats, architecture &amp; milestones
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setExportMenuOpen(false);
                  onExportMarkdown();
                }}
                className="w-full px-3 py-2 text-left hover:bg-[var(--gr-surface-elevated)] flex items-start gap-2.5 transition-colors duration-150 ease-out cursor-pointer"
              >
                <FileCode className="w-3.5 h-3.5 text-[var(--gr-muted)] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-[var(--gr-text)]">
                    Full timeline (.md)
                  </div>
                  <div className="text-[12px] text-[var(--gr-muted)]">
                    Complete Markdown log &amp; review notes
                  </div>
                </div>
              </button>
            </div>
          )}
        </div>

        <div className="relative" ref={accountMenuRef}>
          {user ? (
            <button
              type="button"
              onClick={() => setAccountMenuOpen((o) => !o)}
              aria-expanded={accountMenuOpen}
              className="h-8 px-2.5 rounded-lg bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] border border-[var(--gr-border)] text-[12px] text-[var(--gr-text)] flex items-center gap-2 transition-colors duration-150 ease-out cursor-pointer whitespace-nowrap shrink-0"
            >
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'Account'}
                  referrerPolicy="no-referrer"
                  className="w-4 h-4 rounded-full object-cover"
                />
              ) : (
                <UserIcon className="w-3.5 h-3.5 text-[var(--gr-muted)]" />
              )}
              <span className="hidden sm:inline max-w-[100px] truncate">
                {user.displayName?.split(' ')[0] || 'Account'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="h-8 px-3 rounded-lg bg-transparent hover:bg-[var(--gr-surface-elevated)] border border-[var(--gr-border)] text-[12px] font-medium text-[var(--gr-text)] flex items-center gap-1.5 transition-colors duration-150 ease-out cursor-pointer whitespace-nowrap shrink-0"
            >
              <LogIn className="w-3.5 h-3.5 text-[var(--gr-muted)]" />
              <span>Sign in</span>
            </button>
          )}

          {accountMenuOpen && user && (
            <div className="absolute right-0 mt-2 w-64 rounded-xl bg-[var(--gr-surface)] border border-[var(--gr-border)] shadow-lg p-3 z-50 space-y-3">
              <div className="space-y-0.5">
                <div className="text-[12px] font-medium text-[var(--gr-text)] truncate">
                  {user.displayName || 'Developer'}
                </div>
                {user.email && (
                  <div className="text-[12px] text-[var(--gr-muted)] truncate">{user.email}</div>
                )}
                <div className="text-[12px] text-[var(--gr-accent-text)] pt-1">
                  Cloud sync active (notes, repos, chat)
                </div>
              </div>
              <div className="border-t border-[var(--gr-border)] pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    onSignOut();
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg text-left text-[12px] text-[var(--gr-text)] hover:bg-[var(--gr-surface-elevated)] flex items-center gap-2 cursor-pointer transition-colors duration-150 ease-out"
                >
                  <LogOut className="w-3.5 h-3.5 text-[var(--gr-muted)]" />
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
