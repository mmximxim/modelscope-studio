export type Ratio = { key: string; label: string; w: number; h: number };

export const RATIOS: Ratio[] = [
  { key: "1:1", label: "1:1", w: 1, h: 1 },
  { key: "3:4", label: "3:4", w: 3, h: 4 },
  { key: "4:3", label: "4:3", w: 4, h: 3 },
  { key: "9:16", label: "9:16", w: 9, h: 16 },
  { key: "16:9", label: "16:9", w: 16, h: 9 },
];

export type Quality = "standard" | "high";

const QUALITY_BASE: Record<Quality, number> = {
  standard: 1024,
  high: 1536,
};

function round8(n: number): number {
  return Math.max(64, Math.round(n / 8) * 8);
}

/** 按比例和清晰度计算尺寸，并把长边限制在模型上限内 */
export function computeSize(ratio: Ratio, quality: Quality, maxSide: number): string {
  const base = Math.min(QUALITY_BASE[quality], maxSide);
  const longSide = Math.max(ratio.w, ratio.h);
  let w = (base * ratio.w) / longSide;
  let h = (base * ratio.h) / longSide;
  w = Math.min(round8(w), maxSide);
  h = Math.min(round8(h), maxSide);
  return `${w}x${h}`;
}

export function ratioOf(key: string): Ratio {
  return RATIOS.find((r) => r.key === key) ?? RATIOS[0];
}

/** 从宽高反推最接近的预设比例 */
export function ratioFromSize(width: number, height: number): Ratio {
  const target = width / height;
  let best = RATIOS[0];
  let delta = Infinity;
  for (const r of RATIOS) {
    const d = Math.abs(r.w / r.h - target);
    if (d < delta) {
      delta = d;
      best = r;
    }
  }
  return best;
}
