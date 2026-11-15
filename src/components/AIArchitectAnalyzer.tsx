import React, { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
  HelpCircle,
  Cpu,
  Send,
  RefreshCw,
  Database,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { GitCommit, AIAnalysisResult } from '../types/git';
import { MarkdownRenderer } from './MarkdownRenderer';
import { fetchAIStream } from '../utils/streamClient';
import {
  buildApiUrl,
  extractReadableErrorMessage,
  isHtmlPayload,
  parseApiErrorResponse,
  STATIC_HOST_AI_HELP,
} from '../utils/apiConfig';
import {
  PROMPT_VERSION,
  normalizeQuestion,
  buildAICacheId,
  getCachedAIResponse,
  setCachedAIResponse,
} from '../utils/idbCache';
import { getCloudAICacheEntry, saveCloudAICacheEntry } from '../firebase';

interface AIArchitectAnalyzerProps {
  user: User | null;
  repoId: string;
  commit: GitCommit;
  repositoryName: string;
  baseCommitShortSha?: string | null;
}

interface QAItem {
  q: string;
  a: string;
  fromCache?: boolean;
}

const ANALYSIS_MODEL = 'gemini-4-carbon';
const ASK_DIFF_MODEL = 'gemini-3.1-flash-lite';

function normalizeAnalysisPayload(raw: any): AIAnalysisResult {
  return {
    summary: raw?.summary || 'No summary generated.',
    architecturalIntent: raw?.architecturalIntent || '',
    impactScore: raw?.impactScore || 'Moderate',
    keyChanges: Array.isArray(raw?.keyChanges) ? raw.keyChanges : [],
    risksAndTradeoffs: Array.isArray(raw?.risksAndTradeoffs) ? raw.risksAndTradeoffs : [],
    suggestedQuestions: Array.isArray(raw?.suggestedQuestions) ? raw.suggestedQuestions : [],
    detectedPatterns: Array.isArray(raw?.detectedPatterns) ? raw.detectedPatterns : [],
  };
}

export const AIArchitectAnalyzer: React.FC<AIArchitectAnalyzerProps> = ({
  user,
  repoId,
  commit,
  repositoryName,
  baseCommitShortSha,
}) => {
  const [analysis, setAnalysis] = useState<AIAnalysisResult | null>(null);
  const [analysisFromCache, setAnalysisFromCache] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [userQuestion, setUserQuestion] = useState<string>('');
  const [isAsking, setIsAsking] = useState<boolean>(false);
  const [streamingAnswer, setStreamingAnswer] = useState<{ q: string; a: string } | null>(null);
  const [qaHistory, setQaHistory] = useState<QAItem[]>([]);

  const analyzeCurrentCommit = useCallback(
    async (force = false, signal?: AbortSignal) => {
      if (commit.diffLoading || (commit.diffLoaded === false && commit.files.length === 0)) {
        return;
      }

      setIsLoading(true);
      setError(null);

      const baseKey = baseCommitShortSha || '';
      const cacheId = buildAICacheId({
        repoId,
        commitSha: commit.sha,
        mode: 'analysis',
        model: ANALYSIS_MODEL,
        promptVersion: PROMPT_VERSION,
        question: baseKey,
      });

      try {
        if (!force) {
          const localHit = await getCachedAIResponse(cacheId);
          if (signal?.aborted) return;
          if (localHit?.analysisData) {
            setAnalysis(normalizeAnalysisPayload(localHit.analysisData));
            setAnalysisFromCache(true);
            setIsLoading(false);
            return;
          }

          if (user) {
            const cloudHit = await getCloudAICacheEntry(user.uid, cacheId).catch(() => null);
            if (signal?.aborted) return;
            if (cloudHit?.analysisData) {
              const normalized = normalizeAnalysisPayload(cloudHit.analysisData);
              await setCachedAIResponse({
                cacheId,
                repoId,
                commitSha: commit.sha,
                mode: 'analysis',
                model: ANALYSIS_MODEL,
                promptVersion: PROMPT_VERSION,
                normalizedQuestion: normalizeQuestion(baseKey),
                analysisData: normalized,
                updatedAtMs: Date.now(),
              });
              setAnalysis(normalized);
              setAnalysisFromCache(true);
              setIsLoading(false);
              return;
            }
          }
        }

        const res = await fetch(buildApiUrl('/api/ai/analyze-commit'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            commit,
            repositoryName,
            comparisonBaseShortSha: baseCommitShortSha,
          }),
        });

        if (!res.ok) {
          throw new Error(await parseApiErrorResponse(res));
        }

        const contentType = res.headers.get('content-type') || '';
        const rawBody = await res.text();
        if (isHtmlPayload(rawBody, contentType)) {
          throw new Error(STATIC_HOST_AI_HELP);
        }

        let data: any;
        try {
          data = JSON.parse(rawBody);
        } catch {
          throw new Error(extractReadableErrorMessage(rawBody, res.status));
        }

        if (!data?.analysis || typeof data.analysis !== 'object') {
          throw new Error('Unexpected analysis format returned from server.');
        }

        const normalized = normalizeAnalysisPayload(data.analysis);
        setAnalysis(normalized);
        setAnalysisFromCache(false);

        const normQ = normalizeQuestion(baseKey);
        await setCachedAIResponse({
          cacheId,
          repoId,
          commitSha: commit.sha,
          mode: 'analysis',
          model: ANALYSIS_MODEL,
          promptVersion: PROMPT_VERSION,
          normalizedQuestion: normQ,
          analysisData: normalized,
          updatedAtMs: Date.now(),
        });

        if (user) {
          saveCloudAICacheEntry(user.uid, {
            cacheId,
            repoId,
            commitSha: commit.sha,
            mode: 'analysis',
            model: ANALYSIS_MODEL,
            promptVersion: PROMPT_VERSION,
            normalizedQuestion: normQ,
            analysisData: normalized as unknown as Record<string, unknown>,
          }).catch((err) => console.error('Cloud AI cache save failed:', err));
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setError(err?.message || 'Unable to generate architectural analysis.');
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    },
    [repoId, commit, repositoryName, baseCommitShortSha, user]
  );

  useEffect(() => {
    const controller = new AbortController();
    setAnalysis(null);
    setAnalysisFromCache(false);
    setQaHistory([]);
    setStreamingAnswer(null);
    setUserQuestion('');
    analyzeCurrentCommit(false, controller.signal);
    return () => controller.abort();
  }, [commit.sha, commit.diffLoading, commit.diffLoaded, baseCommitShortSha, repoId]);

  const askDiffQuestion = async (q: string, force = false, replaceIndex?: number) => {
    if (!q || isAsking) return;

    setIsAsking(true);
    const cacheId = buildAICacheId({
      repoId,
      commitSha: commit.sha,
      mode: 'ask',
      model: ASK_DIFF_MODEL,
      promptVersion: PROMPT_VERSION,
      question: q,
    });
    const normQ = normalizeQuestion(q);

    try {
      if (!force) {
        const localHit = await getCachedAIResponse(cacheId);
        if (localHit?.responseText) {
          setQaHistory((prev) => [...prev, { q, a: localHit.responseText!, fromCache: true }]);
          return;
        }

        if (user) {
          const cloudHit = await getCloudAICacheEntry(user.uid, cacheId).catch(() => null);
          if (cloudHit?.responseText) {
            await setCachedAIResponse({
              cacheId,
              repoId,
              commitSha: commit.sha,
              mode: 'ask',
              model: ASK_DIFF_MODEL,
              promptVersion: PROMPT_VERSION,
              normalizedQuestion: normQ,
              responseText: cloudHit.responseText,
              updatedAtMs: Date.now(),
            });
            setQaHistory((prev) => [...prev, { q, a: cloudHit.responseText!, fromCache: true }]);
            return;
          }
        }
      }

      setStreamingAnswer({ q, a: '' });
      const result = await fetchAIStream(
        '/api/ai/ask-diff',
        { question: q, commit, repositoryName },
        {
          onChunk: (partialText) => {
            setStreamingAnswer({ q, a: partialText });
          },
        }
      );

      const finalAnswer = result.text || 'No answer generated.';
      await setCachedAIResponse({
        cacheId,
        repoId,
        commitSha: commit.sha,
        mode: 'ask',
        model: ASK_DIFF_MODEL,
        promptVersion: PROMPT_VERSION,
        normalizedQuestion: normQ,
        responseText: finalAnswer,
        updatedAtMs: Date.now(),
      });

      if (user) {
        saveCloudAICacheEntry(user.uid, {
          cacheId,
          repoId,
          commitSha: commit.sha,
          mode: 'ask',
          model: ASK_DIFF_MODEL,
          promptVersion: PROMPT_VERSION,
          normalizedQuestion: normQ,
          responseText: finalAnswer,
        }).catch((err) => console.error('Cloud AI cache save failed:', err));
      }

      setQaHistory((prev) => {
        if (typeof replaceIndex === 'number' && prev[replaceIndex]) {
          const next = [...prev];
          next[replaceIndex] = { q, a: finalAnswer, fromCache: false };
          return next;
        }
        return [...prev, { q, a: finalAnswer, fromCache: false }];
      });
    } catch (err: any) {
      const errorText = `Error: ${err?.message || 'Failed to generate answer.'}`;
      setQaHistory((prev) => {
        if (typeof replaceIndex === 'number' && prev[replaceIndex]) {
          const next = [...prev];
          next[replaceIndex] = { q, a: errorText, fromCache: false };
          return next;
        }
        return [...prev, { q, a: errorText, fromCache: false }];
      });
    } finally {
      setStreamingAnswer(null);
      setIsAsking(false);
    }
  };

  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = userQuestion.trim();
    if (!q || isAsking) return;
    setUserQuestion('');
    await askDiffQuestion(q, false);
  };

  const waitingForDiff =
    commit.diffLoading || (commit.diffLoaded === false && commit.files.length === 0);

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full bg-[var(--gr-bg)]">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[var(--gr-border)]">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-mono text-[var(--gr-accent-text)] tabular-nums">
            <Cpu className="w-4 h-4 shrink-0" />
            <span>Code Evolution &amp; Architecture Review</span>
            <span aria-hidden="true">·</span>
            <span>Commit {commit.shortSha}</span>
          </div>
          <h2 className="text-[16px] font-semibold text-[var(--gr-text)] tracking-tight mt-1">
            Automated Deep Architectural Analysis
          </h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {analysisFromCache && !isLoading && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--gr-surface)] border border-[var(--gr-border)] text-[11px] font-medium text-[var(--gr-muted)]">
              <Database className="w-3 h-3 text-[var(--gr-accent-text)]" />
              <span>Saved answer</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => analyzeCurrentCommit(true)}
            disabled={isLoading || waitingForDiff}
            className="h-8 px-3 flex items-center gap-1.5 bg-[var(--gr-surface)] hover:bg-[var(--gr-surface-elevated)] disabled:opacity-50 text-[var(--gr-text)] border border-[var(--gr-border)] rounded-lg text-[12px] font-medium transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>{isLoading ? 'Analyzing...' : 'Regenerate'}</span>
          </button>
        </div>
      </div>

      {/* Waiting for lazy diff */}
      {waitingForDiff && (
        <div className="p-12 text-center space-y-3">
          <Loader2 className="w-6 h-6 text-[var(--gr-accent-text)] animate-spin mx-auto" />
          <div className="text-[14px] font-medium text-[var(--gr-text)]">
            Fetching commit diff before analysis...
          </div>
          <p className="text-[12px] text-[var(--gr-muted)] max-w-md mx-auto">
            Loading changed files for {commit.shortSha} from GitHub.
          </p>
        </div>
      )}

      {/* Loading State */}
      {!waitingForDiff && isLoading && (
        <div className="p-12 text-center space-y-3">
          <Loader2 className="w-7 h-7 text-[var(--gr-accent-text)] animate-spin mx-auto" />
          <div className="text-[14px] font-medium text-[var(--gr-text)]">
            Analyzing commit changes &amp; diff semantics...
          </div>
          <p className="text-[12px] text-[var(--gr-muted)] max-w-md mx-auto">
            Extracting architectural intent, concurrency invariants, memory patterns, and
            potential production risks across {commit.files.length} changed files.
          </p>
        </div>
      )}

      {/* Error State */}
      {!waitingForDiff && error && !isLoading && (
        <div className="p-4 rounded-xl bg-[var(--gr-danger-bg)] border border-[var(--gr-danger-border)] text-[var(--gr-danger-text)] text-[12px] space-y-2">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="w-4 h-4" />
            <span>Analysis Failed</span>
          </div>
          <p>{error}</p>
          <button
            type="button"
            onClick={() => analyzeCurrentCommit(true)}
            className="px-3 py-1 border border-[var(--gr-danger-border)] hover:bg-[var(--gr-surface)] rounded-md text-[12px] cursor-pointer"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Analysis Content */}
      {!waitingForDiff && analysis && !isLoading && (
        <div className="space-y-6">
          <div className="space-y-2 pb-5 border-b border-[var(--gr-border)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[12px] font-semibold text-[var(--gr-text)]">
                Executive Summary
              </span>
              <span className="text-[12px] font-mono text-[var(--gr-accent-text)]">
                Impact: {analysis.impactScore}
              </span>
            </div>
            <MarkdownRenderer content={analysis.summary} />
          </div>

          <div className="space-y-2 pb-5 border-b border-[var(--gr-border)]">
            <div className="text-[12px] font-semibold text-[var(--gr-text)]">
              Architectural Intent &amp; Why This Matters
            </div>
            <MarkdownRenderer content={analysis.architecturalIntent} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-5 border-b border-[var(--gr-border)]">
            <div className="space-y-2.5">
              <div className="text-[12px] font-semibold text-[var(--gr-text)]">
                Key Technical Implementations
              </div>
              <ul className="space-y-2">
                {analysis.keyChanges.map((change, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-[12px] text-[var(--gr-muted)] leading-relaxed"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-[var(--gr-accent-text)] shrink-0 mt-1" />
                    <div className="min-w-0 flex-1">
                      <MarkdownRenderer content={change} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2.5">
              <div className="text-[12px] font-semibold text-[var(--gr-text)]">
                Detected Design Patterns
              </div>
              <div className="flex flex-wrap gap-2">
                {analysis.detectedPatterns.map((pat, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 rounded-md bg-[var(--gr-surface)] border border-[var(--gr-border)] text-[12px] font-mono text-[var(--gr-text)]"
                  >
                    {pat}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2.5 pb-5 border-b border-[var(--gr-border)]">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--gr-text)]">
              <AlertTriangle className="w-3.5 h-3.5 text-[var(--gr-accent-text)]" />
              <span>Latent Risks &amp; Trade-offs</span>
            </div>
            <ul className="space-y-2">
              {analysis.risksAndTradeoffs.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-[12px] text-[var(--gr-muted)] leading-relaxed"
                >
                  <span className="text-[var(--gr-accent-text)] font-bold shrink-0 mt-0.5">
                    ·
                  </span>
                  <div className="min-w-0 flex-1">
                    <MarkdownRenderer content={item} />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--gr-text)]">
              <Lightbulb className="w-3.5 h-3.5 text-[var(--gr-accent-text)]" />
              <span>Recommended Architectural Review Questions</span>
            </div>
            <ul className="space-y-2">
              {analysis.suggestedQuestions.map((q, i) => (
                <li
                  key={i}
                  className="flex items-start justify-between gap-3 text-[12px] text-[var(--gr-text)] bg-[var(--gr-surface)] p-3 rounded-lg border border-[var(--gr-border)] cursor-pointer hover:border-[var(--gr-border-strong)] transition-colors duration-150"
                  onClick={() => setUserQuestion(q)}
                >
                  <div className="flex items-start gap-2">
                    <HelpCircle className="w-3.5 h-3.5 text-[var(--gr-accent-text)] shrink-0 mt-0.5" />
                    <span>{q}</span>
                  </div>
                  <span className="text-[12px] text-[var(--gr-accent-text)] whitespace-nowrap shrink-0 hover:underline">
                    Ask →
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="p-5 rounded-xl bg-[var(--gr-surface)] border border-[var(--gr-border)] space-y-4">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--gr-text)]">
              <HelpCircle className="w-3.5 h-3.5 text-[var(--gr-accent-text)]" />
              <span>Ask About This Specific Commit</span>
            </div>

            {(qaHistory.length > 0 || streamingAnswer) && (
              <div className="space-y-3 pt-1">
                {qaHistory.map((item, idx) => (
                  <div key={idx} className="space-y-1.5 text-[12px]">
                    <div className="font-medium text-[var(--gr-text)] bg-[var(--gr-accent-soft)] p-2.5 rounded-lg border border-[#E0A458]/40">
                      Q: {item.q}
                    </div>
                    <div className="bg-[var(--gr-bg)] p-3.5 rounded-lg border border-[var(--gr-border)] space-y-2">
                      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-[var(--gr-border)]">
                        <div className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--gr-muted)]">
                          <span>{ASK_DIFF_MODEL}</span>
                          {item.fromCache && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--gr-surface)] border border-[var(--gr-border)] font-sans text-[var(--gr-muted)]">
                              <Database className="w-2.5 h-2.5 text-[var(--gr-accent-text)]" />
                              <span>Saved answer</span>
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => askDiffQuestion(item.q, true, idx)}
                          disabled={isAsking}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--gr-muted)] hover:text-[var(--gr-text)] disabled:opacity-40 cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Regenerate</span>
                        </button>
                      </div>
                      <MarkdownRenderer content={item.a} />
                    </div>
                  </div>
                ))}

                {streamingAnswer && (
                  <div className="space-y-1.5 text-[12px]">
                    <div className="font-medium text-[var(--gr-text)] bg-[var(--gr-accent-soft)] p-2.5 rounded-lg border border-[#E0A458]/40">
                      Q: {streamingAnswer.q}
                    </div>
                    <div className="bg-[var(--gr-bg)] p-3.5 rounded-lg border border-[var(--gr-border)]">
                      {streamingAnswer.a ? (
                        <MarkdownRenderer content={streamingAnswer.a} isStreaming />
                      ) : (
                        <div className="flex items-center gap-2 text-[12px] text-[var(--gr-muted)]">
                          <Loader2 className="w-3.5 h-3.5 text-[var(--gr-accent-text)] animate-spin" />
                          <span>Writing answer...</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <form onSubmit={handleAskQuestion} className="flex gap-2">
              <input
                type="text"
                value={userQuestion}
                onChange={(e) => setUserQuestion(e.target.value)}
                placeholder="Ask about race conditions, algorithmic complexity, memory implications..."
                className="flex-1 px-3.5 py-2 bg-[var(--gr-bg)] border border-[var(--gr-border)] rounded-lg text-[12px] text-[var(--gr-text)] placeholder:text-[var(--gr-muted)] focus:outline-none focus:border-[#E0A458]"
              />
              <button
                type="submit"
                disabled={isAsking || !userQuestion.trim()}
                className="px-4 py-2 bg-[#E0A458] hover:bg-[#E8B46E] disabled:opacity-40 text-[#141414] font-semibold rounded-lg text-[12px] flex items-center gap-1.5 transition-colors duration-150 cursor-pointer"
              >
                {isAsking ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>{isAsking ? 'Thinking...' : 'Ask'}</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
