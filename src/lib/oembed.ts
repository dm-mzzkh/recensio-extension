interface OEmbedResponse {
  title: string;
  author_name: string;
  thumbnail_url: string;
}

export interface VideoMetadata {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
}

export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const shorts = u.pathname.match(/^\/shorts\/([^/]+)/);
      if (shorts) return shorts[1];
    }
    if (u.hostname === 'youtu.be') {
      return u.pathname.slice(1) || null;
    }
    return null;
  } catch {
    return null;
  }
}

const OEMBED_TIMEOUT_MS = 8000;

export async function fetchVideoMetadata(url: string): Promise<VideoMetadata | null> {
  const videoId = extractVideoId(url);
  if (!videoId) return null;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OEMBED_TIMEOUT_MS);
  try {
    const resp = await fetch(oembedUrl, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`oEmbed ${resp.status}`);
    const data = (await resp.json()) as OEmbedResponse;
    return {
      videoId,
      title: data.title,
      channel: data.author_name,
      thumbnail: data.thumbnail_url,
    };
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new Error(`oEmbed timeout after ${OEMBED_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
