export type VideoSource = 'youtube' | 'tiktok';

interface OEmbedResponse {
  title: string;
  author_name: string;
  thumbnail_url: string;
}

export interface VideoRef {
  videoId: string;
  source: VideoSource;
}

export interface VideoMetadata extends VideoRef {
  title: string;
  channel: string;
  thumbnail: string;
  url: string;
}

export function extractVideoRef(url: string): VideoRef | null {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('youtube.com')) {
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v');
        return id ? { videoId: id, source: 'youtube' } : null;
      }
      const shorts = u.pathname.match(/^\/shorts\/([^/]+)/);
      if (shorts) return { videoId: shorts[1], source: 'youtube' };
    }
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1);
      return id ? { videoId: id, source: 'youtube' } : null;
    }
    if (u.hostname === 'www.tiktok.com' || u.hostname === 'tiktok.com') {
      // /@channel/video/<numeric-id>
      const m = u.pathname.match(/^\/[^/]+\/video\/(\d+)/);
      if (m) return { videoId: m[1], source: 'tiktok' };
    }
    return null;
  } catch {
    return null;
  }
}

const OEMBED_TIMEOUT_MS = 8000;

function oembedEndpoint(source: VideoSource, watchUrl: string): string {
  if (source === 'tiktok') {
    return `https://www.tiktok.com/oembed?url=${encodeURIComponent(watchUrl)}`;
  }
  return `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
}

export async function fetchVideoMetadata(url: string): Promise<VideoMetadata | null> {
  const ref = extractVideoRef(url);
  if (!ref) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OEMBED_TIMEOUT_MS);
  try {
    const resp = await fetch(oembedEndpoint(ref.source, url), { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`oEmbed ${resp.status}`);
    const data = (await resp.json()) as OEmbedResponse;
    return {
      videoId: ref.videoId,
      source: ref.source,
      title: data.title,
      channel: data.author_name,
      thumbnail: data.thumbnail_url,
      url,
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

export function externalUrl(v: { videoId: string; source?: VideoSource; url?: string }): string {
  if (v.url) return v.url;
  if (v.source === 'tiktok') {
    // No channel-slug context available — use the canonical short form;
    // TikTok resolves video-id-only URLs by redirecting to the owning channel.
    return `https://www.tiktok.com/@/video/${v.videoId}`;
  }
  return `https://www.youtube.com/watch?v=${v.videoId}`;
}
