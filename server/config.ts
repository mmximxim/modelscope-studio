import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, "data");
export const IMAGES_DIR = path.join(DATA_DIR, "images");
export const CONFIG_PATH = path.join(DATA_DIR, "config.json");
export const HISTORY_PATH = path.join(DATA_DIR, "history.json");
export const DIST_DIR = path.join(ROOT, "dist");

export type AppConfig = {
  token: string;
  defaultModel: string;
  defaultRatio: string;
  defaultQuality: "standard" | "high";
  updatedAt: string | null;
};

const DEFAULTS: AppConfig = {
  token: "",
  defaultModel: "Tongyi-MAI/Z-Image-Turbo",
  defaultRatio: "1:1",
  defaultQuality: "standard",
  updatedAt: null,
};

export function ensureDirs(): void {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

export function readConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeConfig(patch: Partial<AppConfig>): AppConfig {
  ensureDirs();
  const next: AppConfig = { ...readConfig(), ...patch, updatedAt: new Date().toISOString() };
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmp, CONFIG_PATH);
  return next;
}

export function resolveToken(): string {
  const fromEnv =
    process.env.MODELSCOPE_API_TOKEN ??
    process.env.MODELSCOPE_API_KEY ??
    process.env.MODELSCOPE_TOKEN ??
    "";
  return (readConfig().token || fromEnv).trim();
}

export function resolveAccessCode(): string {
  return (process.env.ACCESS_CODE ?? "").trim();
}

export function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 10) return `${token.slice(0, 2)}••••`;
  return `${token.slice(0, 5)}••••••${token.slice(-4)}`;
}
