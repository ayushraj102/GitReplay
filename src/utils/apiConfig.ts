export function getApiBaseUrl(): string {
  const raw = (import.meta as any)?.env?.VITE_API_BASE_URL;
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\/+$/, '');
}

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

const STATIC_HOST_AI_HELP =
  'AI analysis endpoints (/api/ai/*) require a running Node/Express backend. If you are viewing GitReplay on static hosting such as GitHub Pages, set VITE_API_BASE_URL to your deployed backend URL in repository variables and rebuild. All GitHub repo importing, timeline playback, diff inspection, IndexedDB caching, and Markdown/PDF exports work standalone.';

export function extractReadableErrorMessage(raw: string, status?: number): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return status ? `Server responded with status ${status}` : 'Unexpected server error.';
  }

  // Unwrap JSON error envelopes recursively (e.g. {"error":{"code":503,"message":"..."}})
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed?.error === 'string') {
        return extractReadableErrorMessage(parsed.error, status);
      }
      if (parsed?.error && typeof parsed.error === 'object') {
        if (typeof parsed.error.message === 'string') {
          return extractReadableErrorMessage(parsed.error.message, parsed.error.code || status);
        }
      }
      if (typeof parsed?.message === 'string') {
        return extractReadableErrorMessage(parsed.message, status);
      }
    } catch {
      // Fall back to trimmed string
    }
  }

  return trimmed;
}

export function isHtmlPayload(text: string, contentType = ''): boolean {
  const ct = contentType.toLowerCase();
  const sample = text.trimStart().slice(0, 128).toLowerCase();
  return ct.includes('text/html') || sample.startsWith('<!doctype') || sample.startsWith('<html');
}

export async function parseApiErrorResponse(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  const bodyText = await response.text().catch(() => '');

  if (
    isHtmlPayload(bodyText, contentType) ||
    response.status === 404 ||
    response.status === 405
  ) {
    return STATIC_HOST_AI_HELP;
  }

  return extractReadableErrorMessage(bodyText, response.status);
}

export { STATIC_HOST_AI_HELP };
