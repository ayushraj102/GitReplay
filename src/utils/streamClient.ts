import {
  buildApiUrl,
  extractReadableErrorMessage,
  isHtmlPayload,
  parseApiErrorResponse,
  STATIC_HOST_AI_HELP,
} from './apiConfig';

export interface StreamCallbacks {
  onChunk: (partialFullText: string) => void;
  onDone?: (meta: { modelUsed?: string; roleTitle?: string }) => void;
}

/**
 * Consumes a POST endpoint returning either text/event-stream SSE chunks or JSON fallback.
 */
export async function fetchAIStream(
  url: string,
  body: Record<string, unknown>,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<{ text: string; modelUsed?: string; roleTitle?: string }> {
  const response = await fetch(buildApiUrl(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ ...body, stream: true }),
  });

  if (!response.ok) {
    throw new Error(await parseApiErrorResponse(response));
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream') || !response.body) {
    const rawText = await response.text();
    if (isHtmlPayload(rawText, contentType)) {
      throw new Error(STATIC_HOST_AI_HELP);
    }
    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(extractReadableErrorMessage(rawText, response.status));
    }
    const fullText = data.reply || data.answer || '';
    callbacks.onChunk(fullText);
    callbacks.onDone?.({ modelUsed: data.modelUsed, roleTitle: data.roleTitle });
    return { text: fullText, modelUsed: data.modelUsed, roleTitle: data.roleTitle };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let finalMeta: { modelUsed?: string; roleTitle?: string } = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr) continue;
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.error) {
          throw new Error(extractReadableErrorMessage(String(parsed.error)));
        }
        if (typeof parsed.chunk === 'string') {
          fullText += parsed.chunk;
          callbacks.onChunk(fullText);
        }
        if (parsed.done) {
          finalMeta = { modelUsed: parsed.modelUsed, roleTitle: parsed.roleTitle };
        }
      } catch (err) {
        if (err instanceof Error && err.message !== 'Unexpected end of JSON input') {
          if (!jsonStr.startsWith('{')) continue;
          throw err;
        }
      }
    }
  }

  callbacks.onDone?.(finalMeta);
  return { text: fullText, ...finalMeta };
}
