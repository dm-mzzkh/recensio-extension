import Dexie, { type Table } from 'dexie';

export interface Video {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationSec?: number;
  addedAt: number;
  updatedAt: number;
  rating?: number; // 1-10
  review?: string;
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

export interface Collection {
  id?: number;
  name: string;
  cover?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CollectionItem {
  id?: number;
  collectionId: number;
  videoId: string;
  position: number;
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

export class RecensioDB extends Dexie {
  videos!: Table<Video, string>;
  tags!: Table<Tag, number>;
  videoTags!: Table<VideoTag, number>;
  collections!: Table<Collection, number>;
  collectionItems!: Table<CollectionItem, number>;
  screenshots!: Table<Screenshot, number>;

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
  }
}

export const db = new RecensioDB();
