export type ModelInfo = {
  id: string;
  name: string;
  tag: string;
  description: string;
  steps: number;
  guidance: number | null;
  maxSide: number;
  curated?: boolean;
  downloads?: number;
  /** 编辑 / 图生图能力：maxImages 最多参考图数，required 是否必须垫图 */
  edit?: { maxImages: number; required: boolean };
  /** 每次调用的魔方档位（官方：轻量 0.5 / 标准 1 / 重型 2） */
  cost?: number;
  /** 该模型的提示词写法要点（喂给提示词助手） */
  guide?: string;
};

export const CURATED_MODELS: ModelInfo[] = [
  {
    id: "Tongyi-MAI/Z-Image-Turbo",
    name: "Z-Image Turbo",
    tag: "极速",
    description: "8–9 步出图，中文与写实人像表现好，日常首选",
    steps: 9,
    guidance: null,
    maxSide: 2048,
    cost: 0.5,
    guide: "宜用短小精悍的中文自然句（30–80 字），主体+场景+风格直给，堆砌形容词反而有害；写实人像、静物、日常摄影极强，简单中文文字可渲染但复杂排版不稳；基本不需要负向词。",
    curated: true,
  },
  {
    id: "Qwen/Qwen-Image-2.1",
    name: "Qwen Image 2.1",
    tag: "旗舰",
    description: "Qwen 系列旗舰本体，质量上限最高，可文生图也可垫图重绘",
    steps: 25,
    guidance: 4.0,
    maxSide: 1664,
    cost: 1,
    guide: "适合细节丰富的中文自然长句，按「主体→场景→光影→风格→画质」分层描述；画面中要出现文字时用「」写明原文（如：招牌上写着「开业大吉」）；构图控制与中文渲染是强项。",
    curated: true,
    edit: { maxImages: 3, required: false },
  },
  {
    id: "Qwen/Qwen-Image-2.1-Turbo",
    name: "Qwen Image 2.1 Turbo",
    tag: "均衡",
    description: "2.1 快速版，8 步出图，可文生图也可垫图重绘",
    steps: 8,
    guidance: 1.0,
    maxSide: 2048,
    cost: 0.5,
    guide: "写法同 Qwen-Image-2.1；8 步快速出图适合反复试稿；垫图时提示词写「要改什么」，不要复述整张图。",
    curated: true,
    edit: { maxImages: 4, required: false },
  },
  {
    id: "Qwen/Qwen-Image-2512",
    name: "Qwen Image 2512",
    tag: "中文海报",
    description: "中文文字渲染强，构图稳定，适合海报与知识配图",
    steps: 50,
    guidance: 4.0,
    maxSide: 2048,
    cost: 1,
    guide: "与 Qwen-Image 家族同写法：中文长句分层描述；做海报先定版式（左右分栏、居中标题等）再写内容；高分辨率下细节更稳。",
    curated: true,
  },
  {
    id: "Qwen/Qwen-Image-Edit-2511",
    name: "Qwen Edit 2511",
    tag: "编辑·最新",
    description: "Qwen 图像编辑最新版，1–3 张参考图组合编辑，中文指令友好",
    steps: 40,
    guidance: 1.0,
    maxSide: 1664,
    cost: 1,
    guide: "指令式编辑：写「把 A 改成 B」的动词短句，不要复述整张图；多图输入可写「把图1的人物穿上图2的衣服」；新增文字用「」标注原文。",
    curated: true,
    edit: { maxImages: 3, required: true },
  },
  {
    id: "Qwen/Qwen-Image-Edit-2509",
    name: "Qwen Edit 2509",
    tag: "编辑·稳定",
    description: "使用最广的 Qwen 编辑模型，多图组合、换背景、改细节都擅长",
    steps: 40,
    guidance: 1.0,
    maxSide: 1664,
    cost: 1,
    guide: "指令式编辑写法同 2511；多图组合（换装、合成、主体迁移）经验最成熟；一次只描述一个主要改动成功率最高。",
    curated: true,
    edit: { maxImages: 3, required: true },
  },
  {
    id: "MusePublic/FLUX.1-Kontext-Dev",
    name: "FLUX.1 Kontext",
    tag: "编辑·写实",
    description: "指令式修图，单张参考图，人物与产品写实细节强",
    steps: 28,
    guidance: 2.5,
    maxSide: 1024,
    cost: 1,
    guide: "单图指令编辑，英文短指令最稳（如 Change the background to a snowy field, keep everything else unchanged）；明确写出 keep/retain 不变的部分；一次只改一处，逐步迭代。",
    curated: true,
    edit: { maxImages: 1, required: true },
  },
  {
    id: "krea/Krea-2-Turbo",
    name: "Krea 2 Turbo",
    tag: "美学",
    description: "12.9B 美学向模型，8 步蒸馏，质感出众",
    steps: 8,
    guidance: null,
    maxSide: 2048,
    cost: 0.5,
    guide: "英文提示词走美学向：强调色彩情绪、材质与构图流派（muted palette、editorial photography、film grain）；插画与抽象风格出彩。",
    curated: true,
  },
  {
    id: "black-forest-labs/FLUX.1-Krea-dev",
    name: "FLUX.1 Krea",
    tag: "写实",
    description: "FLUX.1 Krea 开源版，真实摄影与光影细腻",
    steps: 28,
    guidance: 4.5,
    maxSide: 1024,
    cost: 1,
    guide: "英文自然长句最佳，像给摄影师讲画面：镜头（85mm）、光线（golden hour、soft window light）、氛围逐层展开；写实光影细腻，不建议逗号堆 tag。",
    curated: true,
  },
  {
    id: "MAILAND/majicflus_v1",
    name: "MajicFlus",
    tag: "国风",
    description: "国内社区常用 FLUX 底模，国风与写实人像",
    steps: 25,
    guidance: 3.5,
    maxSide: 2048,
    cost: 1,
    guide: "FLUX 写实/国风特化底模：英文提示词，中国元素写英文（hanfu、chinese palace、ink wash painting）；人像肤质好，古风题材首选。",
    curated: true,
  },
  {
    id: "ideogram-ai/ideogram-4-fp8",
    name: "Ideogram 4",
    tag: "排版",
    description: "文字排版与海报设计强项",
    steps: 48,
    guidance: null,
    maxSide: 2048,
    cost: 1,
    guide: "文字排版之王：先说用途（poster、logo、杂志封面），再逐条写版式（顶部大标题、底部小字说明），要渲染的文字用「」原文写入，英文最稳；出图慢但排版极准。",
    curated: true,
  },
  {
    id: "Qwen/Qwen-Image",
    name: "Qwen Image",
    tag: "经典",
    description: "20B MMDiT，综合质量高，中文理解好",
    steps: 50,
    guidance: 4.0,
    maxSide: 1664,
    cost: 1,
    guide: "Qwen-Image-2.1 的前辈，写法相同：分层中文长句 + 「」标注画面文字；通用性与中文稳定性依然很好。",
    curated: true,
  },
];

/** 根据模型家族推测一套可用的默认参数 */
export function inferDefaults(id: string): Pick<ModelInfo, "steps" | "guidance" | "maxSide"> {
  const s = id.toLowerCase();
  if (s.includes("z-image")) return { steps: 9, guidance: null, maxSide: 2048 };
  if (s.includes("qwen-image")) {
    if (s.includes("turbo")) return { steps: 8, guidance: 1.0, maxSide: 2048 };
    return { steps: 40, guidance: 4.0, maxSide: 2048 };
  }
  if (s.includes("krea")) return { steps: 8, guidance: null, maxSide: 2048 };
  if (s.includes("flux")) return { steps: 28, guidance: 4.5, maxSide: 1024 };
  if (s.includes("sd3.5") || s.includes("sd35") || s.includes("sd-3.5"))
    return { steps: 28, guidance: 4.5, maxSide: 2048 };
  if (s.includes("sdxl") || s.includes("sd-xl") || s.includes("xl-base"))
    return { steps: 30, guidance: 5.0, maxSide: 1536 };
  if (s.includes("ideogram")) return { steps: 48, guidance: null, maxSide: 2048 };
  return { steps: 25, guidance: 3.5, maxSide: 2048 };
}

export function getModels(): ModelInfo[] {
  return CURATED_MODELS.slice();
}
