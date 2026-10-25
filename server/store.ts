import fs from "node:fs";
import path from "node:path";
import { HISTORY_PATH, IMAGES_DIR, ensureDirs } from "./config.ts";

export type HistoryItem = {
  id: string;
  createdAt: string;
  model: string;
  modelName: string;
  prompt: string;
  negativePrompt: string;
  size: string;
  width: number;
  height: number;
  seed: number | null;
  steps: number | null;
  guidance: number | null;
  file: string;
  elapsedMs: number;
  favorite: boolean;
};

let cache: HistoryItem[] | null = null;

function load(): HistoryItem[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8")) as HistoryItem[];
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache;
}

function persist(): void {
  ensureDirs();
  const tmp = `${HISTORY_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(load(), null, 2), "utf8");
  fs.renameSync(tmp, HISTORY_PATH);
}

export function listHistory(limit = 200): HistoryItem[] {
  return load()
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

export function getHistory(id: string): HistoryItem | undefined {
  return load().find((item) => item.id === id);
}

export function addHistory(item: HistoryItem): HistoryItem {
  const items = load();
  items.push(item);
  persist();
  return item;
}

export function toggleFavorite(id: string): HistoryItem | undefined {
  const item = getHistory(id);
  if (!item) return undefined;
  item.favorite = !item.favorite;
  persist();
  return item;
}

export function deleteHistory(id: string): boolean {
  const items = load();
  const idx = items.findIndex((item) => item.id === id);
  if (idx < 0) return false;
  const [item] = items.splice(idx, 1);
  try {
    fs.unlinkSync(path.join(IMAGES_DIR, item.file));
  } catch {
    /* 文件可能已不存在 */
  }
  persist();
  return true;
}

export function countToday(): number {
  const prefix = new Date().toISOString().slice(0, 10);
  return load().filter((item) => item.createdAt.startsWith(prefix)).length;
}

export function saveImage(id: string, buffer: Buffer, ext: string): string {
  ensureDirs();
  const file = `${id}.${ext}`;
  fs.writeFileSync(path.join(IMAGES_DIR, file), buffer);
  return file;
}
