import Dexie, { type Table } from 'dexie';

export type VideoSource = 'youtube' | 'tiktok';

export interface Video {
  videoId: string;
  source: VideoSource;
  url?: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationSec?: number;
  addedAt: number;
  updatedAt: number;
  rating?: number; // 1-10
  review?: string;
  // Last time source-platform tags were pulled via yt-dlp. `undefined` means
  // we've never fetched, so the editor should kick off an initial fetch.
  systemTagsFetchedAt?: number;
}

export interface Tag {
  id?: number;
  name: string;
  createdAt: number;
}

export interface VideoTag {
  id?: number;
  videoId: string;
  tagId: number;
}

export interface Screenshot {
  id?: number;
  videoId: string;
  blob: Blob;
  width: number;
  height: number;
  timeSec: number;
  createdAt: number;
}

// Tags coming from the source platform (YouTube `.tags[]`, TikTok hashtags
// parsed from description). Read-only in the UI — distinct from user-managed
// `tags`/`videoTags` so promoting / filtering stays explicit.
export interface SystemTag {
  id?: number;
  videoId: string;
  name: string;
  createdAt: number;
}

export type ClipStatus = 'pending' | 'ready' | 'error';

export interface Clip {
  id?: number;
  videoId: string;
  startSec: number;
  endSec: number;
  title?: string;
  note?: string;
  blob?: Blob;
  mimeType?: string;
  width?: number;
  height?: number;
  status?: ClipStatus;
  errorMsg?: string;
  stage?: string;
  createdAt: number;
  updatedAt: number;
}

export class RecensioDB extends Dexie {
  videos!: Table<Video, string>;
  tags!: Table<Tag, number>;
  videoTags!: Table<VideoTag, number>;
  screenshots!: Table<Screenshot, number>;
  clips!: Table<Clip, number>;
  systemTags!: Table<SystemTag, number>;

  constructor() {
    super('recensio');
    this.version(1).stores({
      videos: 'videoId, addedAt, rating',
      tags: '++id, &name',
      videoTags: '++id, [videoId+tagId], videoId, tagId',
      collections: '++id, name, createdAt',
      collectionItems: '++id, [collectionId+videoId], collectionId, videoId, position',
    });
    this.version(2).stores({
      screenshots: '++id, videoId, createdAt, [videoId+createdAt]',
    });
    this.version(3).stores({
      clips: '++id, videoId, startSec, createdAt, [videoId+startSec]',
    });
    // v4 adds blob/mimeType/width/height fields. Indices unchanged.
    this.version(4).stores({
      clips: '++id, videoId, startSec, createdAt, [videoId+startSec]',
    });
    // v5 adds status/errorMsg/stage fields and indexes status. Existing
    // rows will have status===undefined; editor treats absence as "ready
    // if blob, otherwise pending".
    this.version(5).stores({
      clips: '++id, videoId, startSec, createdAt, status, [videoId+startSec]',
    });
    // v6 drops collections/collectionItems — feature was never wired to UI.
    this.version(6).stores({
      collections: null,
      collectionItems: null,
    });
    // v7 introduces multi-source videos (YouTube + TikTok). No new index;
    // backfill existing rows as YouTube and reconstruct their canonical URL
    // so externalUrl() returns the right link.
    this.version(7).upgrade(async (tx) => {
      await tx
        .table('videos')
        .toCollection()
        .modify((v: Video) => {
          if (!v.source) v.source = 'youtube';
          if (!v.url) v.url = `https://www.youtube.com/watch?v=${v.videoId}`;
        });
    });
    // v8 adds systemTags: read-only tags fetched from the source platform
    // (YouTube `.tags[]`, TikTok hashtags from description) via yt-dlp.
    // No backfill — existing videos will be marked "never fetched" and the
    // editor will pull them on next open.
    this.version(8).stores({
      systemTags: '++id, videoId, [videoId+name]',
    });
  }
}

export const db = new RecensioDB();
