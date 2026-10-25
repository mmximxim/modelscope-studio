// 一次性脚本：向 server/catalog.ts 的每个模型注入 guide 字段
const fs = require("fs");
const PATH = "server/catalog.ts";
let s = fs.readFileSync(PATH, "utf8");
const guides = {
  "Tongyi-MAI/Z-Image-Turbo":
    "宜用短小精悍的中文自然句（30–80 字），主体+场景+风格直给，堆砌形容词反而有害；写实人像、静物、日常摄影极强，简单中文文字可渲染但复杂排版不稳；基本不需要负向词。",
  "Qwen/Qwen-Image-2.1":
    "适合细节丰富的中文自然长句，按「主体→场景→光影→风格→画质」分层描述；画面中要出现文字时用「」写明原文（如：招牌上写着「开业大吉」）；构图控制与中文渲染是强项。",
  "Qwen/Qwen-Image-2.1-Turbo":
    "写法同 Qwen-Image-2.1；8 步快速出图适合反复试稿；垫图时提示词写「要改什么」，不要复述整张图。",
  "Qwen/Qwen-Image-2512":
    "与 Qwen-Image 家族同写法：中文长句分层描述；做海报先定版式（左右分栏、居中标题等）再写内容；高分辨率下细节更稳。",
  "Qwen/Qwen-Image-Edit-2511":
    "指令式编辑：写「把 A 改成 B」的动词短句，不要复述整张图；多图输入可写「把图1的人物穿上图2的衣服」；新增文字用「」标注原文。",
  "Qwen/Qwen-Image-Edit-2509":
    "指令式编辑写法同 2511；多图组合（换装、合成、主体迁移）经验最成熟；一次只描述一个主要改动成功率最高。",
  "MusePublic/FLUX.1-Kontext-Dev":
    "单图指令编辑，英文短指令最稳（如 Change the background to a snowy field, keep everything else unchanged）；明确写出 keep/retain 不变的部分；一次只改一处，逐步迭代。",
  "krea/Krea-2-Turbo":
    "英文提示词走美学向：强调色彩情绪、材质与构图流派（muted palette、editorial photography、film grain）；插画与抽象风格出彩。",
  "black-forest-labs/FLUX.1-Krea-dev":
    "英文自然长句最佳，像给摄影师讲画面：镜头（85mm）、光线（golden hour、soft window light）、氛围逐层展开；写实光影细腻，不建议逗号堆 tag。",
  "MAILAND/majicflus_v1":
    "FLUX 写实/国风特化底模：英文提示词，中国元素写英文（hanfu、chinese palace、ink wash painting）；人像肤质好，古风题材首选。",
  "ideogram-ai/ideogram-4-fp8":
    "文字排版之王：先说用途（poster、logo、杂志封面），再逐条写版式（顶部大标题、底部小字说明），要渲染的文字用「」原文写入，英文最稳；出图慢但排版极准。",
  "Qwen/Qwen-Image":
    "Qwen-Image-2.1 的前辈，写法相同：分层中文长句 + 「」标注画面文字；通用性与中文稳定性依然很好。",
};
let count = 0;
for (const [id, guide] of Object.entries(guides)) {
  const anchor = `id: "${id}"`;
  const idx = s.indexOf(anchor);
  if (idx < 0) {
    console.log("NOT FOUND:", id);
    continue;
  }
  // 在该模型条目的 maxSide 行后插入 guide
  const maxSideIdx = s.indexOf("maxSide:", idx);
  const lineEnd = s.indexOf(",", maxSideIdx);
  const insertAt = lineEnd + 1;
  s = s.slice(0, insertAt) + `\n    guide: "${guide}",` + s.slice(insertAt);
  count++;
}
fs.writeFileSync(PATH, s);
console.log("injected guides:", count);
