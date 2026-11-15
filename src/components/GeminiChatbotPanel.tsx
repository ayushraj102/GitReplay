import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Loader2,
  Trash2,
  MessageSquare,
  AlertCircle,
  Cpu,
  User as UserIcon,
  Database,
  RefreshCw,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { GitCommit } from '../types/git';
import {
  ChatPersona,
  PersistedChatMessage,
  saveChatMessage,
  subscribeChatMessages,
  clearChatHistoryForCommit,
  getCloudAICacheEntry,
  saveCloudAICacheEntry,
} from '../firebase';
import { MarkdownRenderer } from './MarkdownRenderer';
import { fetchAIStream } from '../utils/streamClient';
import {
  PROMPT_VERSION,
  StoredChatMessage,
  normalizeQuestion,
  buildAICacheId,
  getCachedAIResponse,
  setCachedAIResponse,
  getLocalChatThread,
  saveLocalChatThread,
  clearLocalChatThread,
} from '../utils/idbCache';

interface GeminiChatbotPanelProps {
  user: User | null;
  repoId: string;
  repositoryName: string;
  commit: GitCommit;
  totalCommits: number;
}

const PERSONA_OPTIONS: Array<{
  id: ChatPersona;
  label: string;
  model: string;
  description: string;
}> = [
  {
    id: 'general',
    label: 'Timeline Explorer',
    model: 'gemini-4-hydrogen',
    description: 'General commit exploration and code evolution questions',
  },
  {
    id: 'architect',
    label: 'Deep Architect',
    model: 'gemini-4-carbon',
    description: 'Deep reasoning on concurrency, invariants, and trade-offs',
  },
  {
    id: 'mentor',
    label: 'Interactive Mentor',
    model: 'gemini-4-argon',
    description: 'Complex interactive refactoring walkthroughs and patterns',
  },
  {
    id: 'fast',
    label: 'Fast Explainer',
    model: 'gemini-3.1-flash-lite',
    description: 'Rapid, concise summaries of diffs and functions',
  },
];

function mergeMessages(
  localMsgs: StoredChatMessage[],
  cloudMsgs: PersistedChatMessage[],
  repoId: string,
  commitSha: string
): StoredChatMessage[] {
  const byId = new Map<string, StoredChatMessage>();
  for (const m of localMsgs) {
    byId.set(m.id, m);
  }
  for (const c of cloudMsgs) {
    const existing = byId.get(c.id);
    byId.set(c.id, {
      id: c.id,
      repoId,
      commitSha,
      role: c.role,
      persona: c.persona,
      modelUsed: c.modelUsed,
      text: c.text,
      createdAtMs: existing?.createdAtMs ?? c.createdAtMs,
      fromCache: existing?.fromCache,
      cacheQuestion: existing?.cacheQuestion,
    });
  }
  return Array.from(byId.values()).sort((a, b) => a.createdAtMs - b.createdAtMs);
}

export const GeminiChatbotPanel: React.FC<GeminiChatbotPanelProps> = ({
  user,
  repoId,
  repositoryName,
  commit,
  totalCommits,
}) => {
  const [persona, setPersona] = useState<ChatPersona>('general');
  const [messages, setMessages] = useState<StoredChatMessage[]>([]);
  const [streamingReply, setStreamingReply] = useState<{
    text: string;
    modelUsed: string;
  } | null>(null);
  const [inputText, setInputText] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    setErrorMsg(null);
    setStreamingReply(null);

    getLocalChatThread(repoId, commit.sha).then((localThread) => {
      if (active) {
        setMessages(localThread);
      }
    });

    if (!user) {
      return () => {
        active = false;
      };
    }

    const unsubscribe = subscribeChatMessages(
      user.uid,
      repoId,
      commit.sha,
      async (cloudMessages) => {
        if (!active) return;
        const localThread = await getLocalChatThread(repoId, commit.sha);
        if (!active) return;
        const merged = mergeMessages(localThread, cloudMessages, repoId, commit.sha);
        setMessages(merged);
        if (cloudMessages.length > 0) {
          saveLocalChatThread(repoId, commit.sha, merged).catch(() => {});
        }
      },
      (err) => {
        if (active) setErrorMsg(err.message);
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [user, repoId, commit.sha]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingReply?.text, isSending]);

  const activePersonaOption =
    PERSONA_OPTIONS.find((p) => p.id === persona) || PERSONA_OPTIONS[0];

  const handleSendMessage = async (textOverride?: string) => {
    const text = (textOverride ?? inputText).trim();
    if (!text || isSending) return;

    setErrorMsg(null);
    if (!textOverride) {
      setInputText('');
    }

    const userMsgId = `msg_u_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const userMsg: StoredChatMessage = {
      id: userMsgId,
      repoId,
      commitSha: commit.sha,
      role: 'user',
      persona,
      modelUsed: activePersonaOption.model,
      text,
      createdAtMs: Date.now(),
    };

    const historyWithUser = [...messages, userMsg];
    setMessages(historyWithUser);
    saveLocalChatThread(repoId, commit.sha, historyWithUser).catch(() => {});
    setIsSending(true);

    const cacheId = buildAICacheId({
      repoId,
      commitSha: commit.sha,
      mode: 'ask',
      model: activePersonaOption.model,
      promptVersion: PROMPT_VERSION,
      question: text,
    });
    const normQ = normalizeQuestion(text);

    try {
      if (user) {
        saveChatMessage(user.uid, {
          id: userMsg.id,
          repoId: userMsg.repoId,
          role: userMsg.role,
          persona: userMsg.persona,
          modelUsed: userMsg.modelUsed,
          commitSha: commit.sha,
          text: userMsg.text,
        }).catch((err) => console.error('Save user msg failed:', err));
      }

      // Check IndexedDB & Cloud AI cache before streaming
      let cachedAnswer: string | undefined;
      const localHit = await getCachedAIResponse(cacheId);
      if (localHit?.responseText) {
        cachedAnswer = localHit.responseText;
      } else if (user) {
        const cloudHit = await getCloudAICacheEntry(user.uid, cacheId).catch(() => null);
        if (cloudHit?.responseText) {
          cachedAnswer = cloudHit.responseText;
          await setCachedAIResponse({
            cacheId,
            repoId,
            commitSha: commit.sha,
            mode: 'ask',
            model: activePersonaOption.model,
            promptVersion: PROMPT_VERSION,
            normalizedQuestion: normQ,
            responseText: cloudHit.responseText,
            updatedAtMs: Date.now(),
          });
        }
      }

      if (cachedAnswer) {
        const cachedMsg: StoredChatMessage = {
          id: `msg_m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          repoId,
          commitSha: commit.sha,
          role: 'model',
          persona,
          modelUsed: activePersonaOption.model,
          text: cachedAnswer,
          createdAtMs: Date.now() + 1,
          fromCache: true,
          cacheQuestion: text,
        };
        const updatedThread = [...historyWithUser, cachedMsg];
        setMessages(updatedThread);
        await saveLocalChatThread(repoId, commit.sha, updatedThread);
        if (user) {
          await saveChatMessage(user.uid, {
            id: cachedMsg.id,
            repoId: cachedMsg.repoId,
            role: cachedMsg.role,
            persona: cachedMsg.persona,
            modelUsed: cachedMsg.modelUsed,
            commitSha: commit.sha,
            text: cachedMsg.text,
          });
        }
        return;
      }

      setStreamingReply({ text: '', modelUsed: activePersonaOption.model });

      const result = await fetchAIStream(
        '/api/ai/chat',
        {
          message: text,
          history: messages.map((m) => ({ role: m.role, text: m.text })),
          persona,
          commit,
          repositoryName,
          totalCommits,
        },
        {
          onChunk: (partialText) => {
            setStreamingReply({
              text: partialText,
              modelUsed: activePersonaOption.model,
            });
          },
        }
      );

      const finalText = result.text || 'No response returned.';
      const modelUsed = result.modelUsed || activePersonaOption.model;

      const modelMsg: StoredChatMessage = {
        id: `msg_m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        repoId,
        commitSha: commit.sha,
        role: 'model',
        persona,
        modelUsed,
        text: finalText,
        createdAtMs: Date.now() + 1,
        fromCache: false,
        cacheQuestion: text,
      };

      setStreamingReply(null);

      await setCachedAIResponse({
        cacheId,
        repoId,
        commitSha: commit.sha,
        mode: 'ask',
        model: activePersonaOption.model,
        promptVersion: PROMPT_VERSION,
        normalizedQuestion: normQ,
        responseText: finalText,
        updatedAtMs: Date.now(),
      });

      const updatedThread = [...historyWithUser, modelMsg];
      setMessages(updatedThread);
      await saveLocalChatThread(repoId, commit.sha, updatedThread);

      if (user) {
        saveCloudAICacheEntry(user.uid, {
          cacheId,
          repoId,
          commitSha: commit.sha,
          mode: 'ask',
          model: activePersonaOption.model,
          promptVersion: PROMPT_VERSION,
          normalizedQuestion: normQ,
          responseText: finalText,
        }).catch((err) => console.error('Cloud AI cache save failed:', err));

        await saveChatMessage(user.uid, {
          id: modelMsg.id,
          repoId: modelMsg.repoId,
          role: modelMsg.role,
          persona: modelMsg.persona,
          modelUsed: modelMsg.modelUsed,
          commitSha: commit.sha,
          text: modelMsg.text,
        });
      }
    } catch (err: any) {
      setStreamingReply(null);
      setErrorMsg(err?.message || 'Failed to send message.');
    } finally {
      setIsSending(false);
    }
  };

  const handleRegenerateMessage = async (msgIndex: number) => {
    if (isSending) return;
    const targetMsg = messages[msgIndex];
    if (!targetMsg || targetMsg.role !== 'model') return;

    // Locate the preceding user question
    let questionText = targetMsg.cacheQuestion || '';
    if (!questionText) {
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          questionText = messages[i].text;
          break;
        }
      }
    }
    if (!questionText) return;

    setErrorMsg(null);
    setIsSending(true);
    const targetPersona = PERSONA_OPTIONS.find((p) => p.id === targetMsg.persona) || activePersonaOption;
    setStreamingReply({ text: '', modelUsed: targetPersona.model });

    const priorHistory = messages
      .slice(0, Math.max(0, msgIndex - 1))
      .map((m) => ({ role: m.role, text: m.text }));

    try {
      const result = await fetchAIStream(
        '/api/ai/chat',
        {
          message: questionText,
          history: priorHistory,
          persona: targetPersona.id,
          commit,
          repositoryName,
          totalCommits,
        },
        {
          onChunk: (partialText) => {
            setStreamingReply({
              text: partialText,
              modelUsed: targetPersona.model,
            });
          },
        }
      );

      const finalText = result.text || 'No response returned.';
      const cacheId = buildAICacheId({
        repoId,
        commitSha: commit.sha,
        mode: 'ask',
        model: targetPersona.model,
        promptVersion: PROMPT_VERSION,
        question: questionText,
      });
      const normQ = normalizeQuestion(questionText);

      await setCachedAIResponse({
        cacheId,
        repoId,
        commitSha: commit.sha,
        mode: 'ask',
        model: targetPersona.model,
        promptVersion: PROMPT_VERSION,
        normalizedQuestion: normQ,
        responseText: finalText,
        updatedAtMs: Date.now(),
      });

      const updatedMsg: StoredChatMessage = {
        ...targetMsg,
        text: finalText,
        modelUsed: result.modelUsed || targetPersona.model,
        fromCache: false,
        cacheQuestion: questionText,
      };
      const updatedThread = messages.map((m, idx) => (idx === msgIndex ? updatedMsg : m));
      setMessages(updatedThread);
      await saveLocalChatThread(repoId, commit.sha, updatedThread);

      if (user) {
        saveCloudAICacheEntry(user.uid, {
          cacheId,
          repoId,
          commitSha: commit.sha,
          mode: 'ask',
          model: targetPersona.model,
          promptVersion: PROMPT_VERSION,
          normalizedQuestion: normQ,
          responseText: finalText,
        }).catch((err) => console.error('Cloud AI cache overwrite failed:', err));

        await saveChatMessage(user.uid, {
          id: updatedMsg.id,
          repoId: updatedMsg.repoId,
          role: updatedMsg.role,
          persona: updatedMsg.persona,
          modelUsed: updatedMsg.modelUsed,
          commitSha: commit.sha,
          text: updatedMsg.text,
        });
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to regenerate response.');
    } finally {
      setStreamingReply(null);
      setIsSending(false);
    }
  };

  const handleClearThread = async () => {
    setErrorMsg(null);
    await clearLocalChatThread(repoId, commit.sha);
    setMessages([]);
    if (user) {
      try {
        await clearChatHistoryForCommit(user.uid, repoId, commit.sha);
      } catch (err: any) {
        setErrorMsg(err?.message || 'Unable to clear cloud chat history.');
      }
    }
  };

  const starterPrompts = [
    `Explain why commit ${commit.shortSha} was needed and what architectural problem it solves.`,
    `What concurrency, performance, or backward-compatibility risks exist in ${commit.shortSha}?`,
    `Suggest how this module could evolve in the next architectural iteration.`,
  ];

  return (
    <div className="flex flex-col h-full bg-[var(--gr-bg)]">
      {/* Role & Model Selector Header */}
      <div className="px-5 py-3.5 bg-[var(--gr-surface)] border-b border-[var(--gr-border)] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-mono text-[var(--gr-accent-text)] tabular-nums">
              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
              <span>Multi-Turn Architecture Assistant</span>
              <span aria-hidden="true">·</span>
              <span>Commit {commit.shortSha}</span>
            </div>
            <p className="text-[12px] text-[var(--gr-muted)] mt-0.5">
              {activePersonaOption.description}
              {user
                ? ' · Saved locally & synced to cloud'
                : ' · Thread saved locally per commit'}
            </p>
          </div>

          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClearThread}
              className="h-8 px-3 flex items-center gap-1.5 bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] text-[var(--gr-text)] border border-[var(--gr-border)] rounded-lg text-[12px] font-medium transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 text-[var(--gr-muted)]" />
              <span>Clear Thread</span>
            </button>
          )}
        </div>

        {/* Role / Model Segmented Control */}
        <div
          role="group"
          aria-label="Select Assistant Role"
          className="flex flex-wrap items-center gap-1.5"
        >
          {PERSONA_OPTIONS.map((opt) => {
            const active = opt.id === persona;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPersona(opt.id)}
                className={`px-3 py-1.5 rounded-lg text-[12px] transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer border flex items-center gap-1.5 ${
                  active
                    ? 'bg-[var(--gr-accent-soft)] text-[var(--gr-accent-text)] border-[#E0A458] font-semibold'
                    : 'bg-[var(--gr-bg)] text-[var(--gr-muted)] border-[var(--gr-border)] hover:text-[var(--gr-text)]'
                }`}
              >
                <span>{opt.label}</span>
                <span className="opacity-40" aria-hidden="true">
                  ·
                </span>
                <span className="font-mono text-[12px] opacity-80">{opt.model}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable Conversation Thread */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.length === 0 && !streamingReply ? (
          <div className="max-w-2xl mx-auto py-10 space-y-6">
            <div className="space-y-2 text-center">
              <Cpu className="w-7 h-7 text-[var(--gr-accent-text)] mx-auto" />
              <h3 className="text-[16px] font-semibold text-[var(--gr-text)]">
                Discuss {repositoryName} at Commit {commit.shortSha}
              </h3>
              <p className="text-[12px] text-[var(--gr-muted)] leading-relaxed max-w-lg mx-auto">
                Ask multi-turn follow-up questions about code changes, architectural decisions, or
                refactoring trade-offs. Threads are saved automatically per commit.
              </p>
            </div>

            <div className="space-y-2">
              <div className="text-[12px] font-medium text-[var(--gr-muted)]">
                Suggested prompts for {commit.shortSha}
              </div>
              {starterPrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSendMessage(prompt)}
                  className="w-full text-left p-3 rounded-lg bg-[var(--gr-surface)] hover:bg-[var(--gr-surface-elevated)] border border-[var(--gr-border)] text-[12px] text-[var(--gr-text)] transition-colors duration-150 cursor-pointer"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isUser = msg.role === 'user';
            const personaInfo = PERSONA_OPTIONS.find((p) => p.id === msg.persona);
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-3xl w-full rounded-xl p-4 border ${
                    isUser
                      ? 'bg-[var(--gr-accent-soft)] border-[#E0A458]/50 text-[var(--gr-text)]'
                      : 'bg-[var(--gr-surface)] border-[var(--gr-border)] text-[var(--gr-text)]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-[12px] font-mono text-[var(--gr-muted)] tabular-nums">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {isUser ? (
                        <UserIcon className="w-3.5 h-3.5 text-[var(--gr-accent-text)]" />
                      ) : (
                        <Cpu className="w-3.5 h-3.5 text-[var(--gr-muted)]" />
                      )}
                      <span className="font-semibold text-[var(--gr-text)] font-sans">
                        {isUser
                          ? user?.displayName || 'Developer'
                          : personaInfo?.label || 'Assistant'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{msg.modelUsed}</span>
                      {msg.fromCache && !isUser && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--gr-bg)] border border-[var(--gr-border)] font-sans text-[11px] text-[var(--gr-muted)]">
                          <Database className="w-2.5 h-2.5 text-[var(--gr-accent-text)]" />
                          <span>Saved answer</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      {!isUser && (
                        <button
                          type="button"
                          onClick={() => handleRegenerateMessage(idx)}
                          disabled={isSending}
                          className="inline-flex items-center gap-1 font-sans text-[11px] font-medium text-[var(--gr-muted)] hover:text-[var(--gr-text)] disabled:opacity-40 cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Regenerate</span>
                        </button>
                      )}
                      <span>
                        {new Date(msg.createdAtMs).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>

                  {isUser ? (
                    <div className="text-[14px] leading-relaxed whitespace-pre-wrap font-sans max-w-[70ch]">
                      {msg.text}
                    </div>
                  ) : (
                    <MarkdownRenderer content={msg.text} />
                  )}
                </div>
              </div>
            );
          })
        )}

        {streamingReply && (
          <div className="flex flex-col items-start">
            <div className="max-w-3xl w-full rounded-xl p-4 border bg-[var(--gr-surface)] border-[var(--gr-border)] text-[var(--gr-text)]">
              <div className="flex items-center gap-1.5 mb-2 text-[12px] font-mono text-[var(--gr-muted)]">
                <Loader2 className="w-3.5 h-3.5 text-[var(--gr-accent-text)] animate-spin" />
                <span className="font-semibold text-[var(--gr-text)] font-sans">
                  {activePersonaOption.label}
                </span>
                <span aria-hidden="true">·</span>
                <span>{streamingReply.modelUsed}</span>
              </div>
              {streamingReply.text ? (
                <MarkdownRenderer content={streamingReply.text} isStreaming />
              ) : (
                <div className="text-[12px] text-[var(--gr-muted)]">
                  Thinking and streaming response...
                </div>
              )}
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 rounded-lg bg-[var(--gr-danger-bg)] border border-[var(--gr-danger-border)] flex items-center gap-2 text-[12px] text-[var(--gr-danger-text)]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div ref={scrollEndRef} />
      </div>

      {/* Message Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage();
        }}
        className="p-4 bg-[var(--gr-surface)] border-t border-[var(--gr-border)] flex items-center gap-3"
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={`Ask ${activePersonaOption.label} about commit ${commit.shortSha} or repository evolution...`}
          className="flex-1 px-3.5 py-2.5 bg-[var(--gr-bg)] border border-[var(--gr-border)] rounded-lg text-[12px] text-[var(--gr-text)] placeholder:text-[var(--gr-muted)] focus:outline-none focus:border-[#E0A458]"
        />
        <button
          type="submit"
          disabled={isSending || !inputText.trim()}
          className="h-9 px-4 bg-[#E0A458] hover:bg-[#E8B46E] disabled:opacity-40 text-[#141414] font-semibold rounded-lg text-[12px] flex items-center gap-1.5 transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer"
        >
          {isSending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          <span>Send</span>
        </button>
      </form>
    </div>
  );
};
