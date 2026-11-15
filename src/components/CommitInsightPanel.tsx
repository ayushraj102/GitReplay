import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Cpu,
  MessageSquare,
} from 'lucide-react';
import { GitCommit } from '../types/git';

interface CommitInsightPanelProps {
  commit: GitCommit;
  hasPrev: boolean;
  hasNext: boolean;
  draftNote: string;
  noteSavedToast: boolean;
  isSignedIn: boolean;
  onStepPrev: () => void;
  onStepNext: () => void;
  onChangeDraftNote: (val: string) => void;
  onSaveNote: (e: React.FormEvent) => void;
  onOpenAIAnalysis: () => void;
  onOpenAIChat: () => void;
}

export const CommitInsightPanel: React.FC<CommitInsightPanelProps> = ({
  commit,
  hasPrev,
  hasNext,
  draftNote,
  noteSavedToast,
  isSignedIn,
  onStepPrev,
  onStepNext,
  onChangeDraftNote,
  onSaveNote,
  onOpenAIAnalysis,
  onOpenAIChat,
}) => {
  // Only Problem and Decision open by default
  const [openProblem, setOpenProblem] = useState(true);
  const [openDecision, setOpenDecision] = useState(true);
  const [openTradeoffs, setOpenTradeoffs] = useState(false);
  const [openNotes, setOpenNotes] = useState(false);

  const oneLineSummary =
    (commit.message || '').split(/[.!?]\s/)[0]?.trim() || commit.message || commit.title;

  return (
    <div className="flex flex-col h-full bg-[var(--gr-surface)]/60">
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Section Kicker */}
        <div className="text-[12px] font-medium text-[var(--gr-accent-text)]">
          Why this change
        </div>

        {/* Fixed Header: Title > Author + Date + Category > 1-line Summary */}
        <div className="space-y-2.5 pb-5 border-b border-[var(--gr-border)]">
          <h1 className="text-[16px] font-semibold text-[var(--gr-text)] leading-snug text-balance">
            {commit.title}
          </h1>

          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--gr-muted)]">
            <span className="text-[var(--gr-text)] font-medium">{commit.author}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {(commit.timestamp || '').split(' ')[0] || '—'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{commit.category}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{commit.shortSha}</span>
          </div>

          <p className="text-[14px] text-[var(--gr-muted)] leading-relaxed pt-1">
            {oneLineSummary}
          </p>
        </div>

        {/* Collapsible Sections with Hairline Dividers */}
        <div className="divide-y divide-[var(--gr-border)]">
          {/* 1. Problem (open by default) */}
          <div className="py-4 first:pt-0">
            <button
              type="button"
              onClick={() => setOpenProblem((v) => !v)}
              aria-expanded={openProblem}
              className="w-full flex items-center justify-between text-left text-[12px] font-semibold text-[var(--gr-text)] hover:text-[var(--gr-accent-text)] transition-colors duration-150 ease-out cursor-pointer"
            >
              <span>Problem</span>
              {openProblem ? (
                <ChevronDown className="w-4 h-4 text-[var(--gr-muted)]" />
              ) : (
                <ChevronRight className="w-4 h-4 text-[var(--gr-muted)]" />
              )}
            </button>
            {openProblem && (
              <p className="mt-2.5 text-[14px] text-[var(--gr-muted)] leading-relaxed">
                {commit.adr?.problemStatement || 'No problem statement recorded for this commit.'}
              </p>
            )}
          </div>

          {/* 2. Decision (open by default) */}
          <div className="py-4">
            <button
              type="button"
              onClick={() => setOpenDecision((v) => !v)}
              aria-expanded={openDecision}
              className="w-full flex items-center justify-between text-left text-[12px] font-semibold text-[var(--gr-text)] hover:text-[var(--gr-accent-text)] transition-colors duration-150 ease-out cursor-pointer"
            >
              <span>Decision</span>
              {openDecision ? (
                <ChevronDown className="w-4 h-4 text-[var(--gr-muted)]" />
              ) : (
                <ChevronRight className="w-4 h-4 text-[var(--gr-muted)]" />
              )}
            </button>
            {openDecision && (
              <div className="mt-2.5 space-y-2.5">
                <p className="text-[14px] text-[var(--gr-text)] leading-relaxed">
                  {commit.adr?.decisionSummary || commit.message}
                </p>
                {commit.adr?.measurableOutcome && (
                  <div className="pl-3 border-l-2 border-[#E0A458] text-[12px] text-[var(--gr-muted)] font-mono tabular-nums py-0.5">
                    {commit.adr.measurableOutcome}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. Trade-offs (collapsed by default) */}
          <div className="py-4">
            <button
              type="button"
              onClick={() => setOpenTradeoffs((v) => !v)}
              aria-expanded={openTradeoffs}
              className="w-full flex items-center justify-between text-left text-[12px] font-semibold text-[var(--gr-text)] hover:text-[var(--gr-accent-text)] transition-colors duration-150 ease-out cursor-pointer"
            >
              <span>Trade-offs ({(commit.adr?.tradeoffs || []).length})</span>
              {openTradeoffs ? (
                <ChevronDown className="w-4 h-4 text-[var(--gr-muted)]" />
              ) : (
                <ChevronRight className="w-4 h-4 text-[var(--gr-muted)]" />
              )}
            </button>
            {openTradeoffs && (
              <ul className="mt-2.5 space-y-2">
                {(commit.adr?.tradeoffs || []).map((tradeoff, idx) => (
                  <li
                    key={idx}
                    className="text-[14px] text-[var(--gr-muted)] leading-relaxed pl-3 relative before:content-['·'] before:absolute before:left-0 before:text-[var(--gr-muted)]"
                  >
                    {tradeoff}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 4. Review Notes (collapsed by default) */}
          <div className="py-4">
            <button
              type="button"
              onClick={() => setOpenNotes((v) => !v)}
              aria-expanded={openNotes}
              className="w-full flex items-center justify-between text-left text-[12px] font-semibold text-[var(--gr-text)] hover:text-[var(--gr-accent-text)] transition-colors duration-150 ease-out cursor-pointer"
            >
              <span>Your notes{draftNote.trim() ? ' (saved)' : ''}</span>
              {openNotes ? (
                <ChevronDown className="w-4 h-4 text-[var(--gr-muted)]" />
              ) : (
                <ChevronRight className="w-4 h-4 text-[var(--gr-muted)]" />
              )}
            </button>
            {openNotes && (
              <form onSubmit={onSaveNote} className="mt-3 space-y-2.5">
                <textarea
                  rows={3}
                  value={draftNote}
                  onChange={(e) => onChangeDraftNote(e.target.value)}
                  placeholder="Write onboarding notes or questions about this commit..."
                  className="w-full p-3 rounded-lg bg-[var(--gr-bg)] border border-[var(--gr-border)] text-[12px] text-[var(--gr-text)] placeholder:text-[var(--gr-muted)] focus:outline-none focus:border-[#E0A458]"
                />
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-[var(--gr-muted)]">
                    {noteSavedToast
                      ? isSignedIn
                        ? 'Synced to cloud'
                        : 'Saved locally'
                      : isSignedIn
                      ? 'Synced via Google account'
                      : 'Stored locally'}
                  </span>
                  <button
                    type="submit"
                    className="h-7 px-3 rounded-md border border-[var(--gr-border-strong)] bg-[var(--gr-surface)] hover:bg-[var(--gr-surface-elevated)] text-[12px] font-medium text-[var(--gr-text)] cursor-pointer transition-colors duration-150 ease-out"
                  >
                    Save note
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Footer Actions: Secondary/Outline "Analyze with AI" + Text "Ask question" + Prev/Next Commit Navigation */}
      <div className="p-5 border-t border-[var(--gr-border)] bg-[var(--gr-surface)] space-y-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onOpenAIAnalysis}
            className="h-9 px-3.5 rounded-lg border border-[var(--gr-border-strong)] bg-transparent hover:bg-[var(--gr-surface-elevated)] text-[var(--gr-text)] text-[12px] font-medium inline-flex items-center gap-2 transition-colors duration-150 ease-out cursor-pointer whitespace-nowrap"
          >
            <Cpu className="w-3.5 h-3.5 text-[var(--gr-muted)]" />
            <span>Analyze with AI</span>
          </button>

          <button
            type="button"
            onClick={onOpenAIChat}
            title="Open multi-turn assistant"
            className="h-9 px-2 text-[12px] font-medium text-[var(--gr-accent-text)] hover:underline inline-flex items-center gap-1.5 transition-opacity duration-150 ease-out cursor-pointer whitespace-nowrap"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Ask question</span>
          </button>
        </div>

        <div className="pt-2 border-t border-[var(--gr-border)] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onStepPrev}
            disabled={!hasPrev}
            className="h-8 px-2.5 rounded-lg border border-[var(--gr-border)] bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] disabled:opacity-35 disabled:pointer-events-none text-[12px] font-medium text-[var(--gr-text)] inline-flex items-center gap-1 transition-colors duration-150 ease-out cursor-pointer whitespace-nowrap"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Prev commit</span>
          </button>

          <button
            type="button"
            onClick={onStepNext}
            disabled={!hasNext}
            className="h-8 px-2.5 rounded-lg border border-[var(--gr-border)] bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] disabled:opacity-35 disabled:pointer-events-none text-[12px] font-medium text-[var(--gr-text)] inline-flex items-center gap-1 transition-colors duration-150 ease-out cursor-pointer whitespace-nowrap"
          >
            <span>Next commit</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
