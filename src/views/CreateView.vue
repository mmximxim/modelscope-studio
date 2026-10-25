<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Icon from "../components/Icon.vue";
import ModelPicker from "../components/ModelPicker.vue";
import PromptAssistant from "../components/PromptAssistant.vue";
import HistoryPicker from "../components/HistoryPicker.vue";
import * as api from "../api";
import {
  cancelGeneration,
  dismissTask,
  findModel,
  go,
  openAssistant,
  openViewer,
  registerBackHandler,
  startGeneration,
  state,
  toast,
  unregisterBackHandler,
} from "../store";
import type { ModelInfo } from "../types";
import { RATIOS, computeSize, ratioFromSize, ratioOf, type Quality } from "../lib/size";

const FALLBACK: ModelInfo = {
  id: "Tongyi-MAI/Z-Image-Turbo",
  name: "Z-Image Turbo",
  tag: "极速",
  description: "",
  steps: 9,
  guidance: null,
  maxSide: 2048,
};

const IDEAS = [
  "黄昏的海边，一位穿白裙的女孩回头，35mm 胶片质感，柔和逆光",
  "雨夜的东京街头，霓虹倒映在积水里，电影感构图，浅景深",
  "一只橘猫趴在窗台的阳光里，毛发细节清晰，温暖日常摄影",
  "漂浮在云海上的古老中式楼阁，晨雾，水墨与写实融合",
  "极简产品摄影，一只白色陶瓷杯放在米色背景上，柔和硬光，留白构图",
  "赛博朋克风格的机械蝴蝶，黄铜与霓虹，微距特写，深色背景",
  "秋天的森林小径，金色落叶，逆光丁达尔效应，宽幅风景",
  "手绘儿童绘本，一只戴着围巾的小熊在雪地里抬头，暖色调",
];

const STYLES = ["电影感", "国风插画", "产品摄影", "赛博朋克", "水彩", "3D 渲染", "极简海报"];

const prompt = ref("");
const negative = ref("");
const showNegative = ref(false);
const modelId = ref(FALLBACK.id);
const ratioKey = ref("1:1");
const quality = ref<Quality>("standard");
const steps = ref(FALLBACK.steps);
const guidance = ref<number | null>(FALLBACK.guidance);
const seedText = ref("");
const advancedOpen = ref(false);
const pickOpen = ref(false);
const promptEl = ref<HTMLTextAreaElement | null>(null);
const initialized = ref(false);
const now = ref(Date.now());
const refImages = ref<string[]>([]);
const refMenuOpen = ref(false);
const historyPickerOpen = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const model = computed<ModelInfo>(
  () => findModel(modelId.value) ?? state.models.find((m) => m.id === modelId.value) ?? FALLBACK,
);
const editInfo = computed(() => model.value.edit ?? null);
const canEdit = computed(() => editInfo.value != null);
const editHint = computed(() => {
  const e = editInfo.value;
  if (!e) return "";
  if (e.required) {
    return e.maxImages === 1
      ? "编辑模型：加 1 张参考图，描述要怎么改"
      : `编辑模型：加 1–${e.maxImages} 张参考图，描述要怎么改`;
  }
  return `可选垫图（最多 ${e.maxImages} 张）：加了就是图生图`;
});
const ratio = computed(() => ratioOf(ratioKey.value));
const size = computed(() => computeSize(ratio.value, quality.value, model.value.maxSide));
const busy = computed(() => state.task?.status === "queued" || state.task?.status === "running");
const recent = computed(() => state.history.slice(0, 8));
const elapsed = computed(() => {
  const task = state.task;
  if (!task) return 0;
  const start = task.startedAt ?? task.createdAt;
  return Math.max(0, Math.round((now.value - start) / 1000));
});
const stageText = computed(() => {
  const task = state.task;
  if (!task) return "";
  if (task.stage === "submitting") return "正在提交任务";
  if (task.stage === "downloading") return "正在下载图片";
  if (task.upstreamStatus) return "模型正在绘制";
  return "排队等待中";
});
const quotaText = computed(() => {
  if (!state.info?.hasToken) return "未配置 Token";
  const d = state.magicube?.data as { available_balance?: number } | undefined;
  if (state.magicube?.ok && d && typeof d.available_balance === "number") {
    return `魔粒 ${d.available_balance}`;
  }
  return "已连接";
});

let clock: ReturnType<typeof setInterval> | null = null;

function syncModelParams() {
  steps.value = model.value.steps;
  guidance.value = model.value.guidance;
}

function onModel(id: string) {
  modelId.value = id;
  syncModelParams();
  if (!model.value.edit && refImages.value.length) {
    refImages.value = [];
    toast("已清空参考图：该模型不支持垫图");
  }
  pickOpen.value = false;
}

function addStyle(style: string) {
  const base = prompt.value.trim().replace(/[，,]\s*$/, "");
  prompt.value = base ? `${base}，${style}` : style;
}

function surprise() {
  prompt.value = IDEAS[Math.floor(Math.random() * IDEAS.length)];
}

function randomSeed() {
  seedText.value = String(Math.floor(Math.random() * 2147483646) + 1);
}

/** 参考图：压缩到长边 1024 的 JPEG data URL，控制上传体积 */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const maxSide = 1024;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.9));
      } catch (err) {
        reject(err instanceof Error ? err : new Error("图片处理失败"));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };
    img.src = url;
  });
}

async function onFilePick(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  if (!files.length) return;
  const cap = editInfo.value?.maxImages ?? 0;
  const room = Math.max(0, cap - refImages.value.length);
  if (room === 0) {
    toast(`该模型最多 ${cap} 张参考图`);
    return;
  }
  const picked = files.slice(0, room);
  try {
    const urls = await Promise.all(picked.map(fileToDataUrl));
    refImages.value.push(...urls);
  } catch {
    toast("图片处理失败，换一张试试", "error");
  }
}

function removeRef(i: number) {
  refImages.value.splice(i, 1);
}

function onPickFromHistory(file: string) {
  historyPickerOpen.value = false;
  void pickFromHistory(file);
}

async function pickFromHistory(file: string) {
  try {
    const res = await fetch(api.imageUrl(file));
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const data = await fileToDataUrl(new File([blob], file, { type: blob.type || "image/png" }));
    const cap = editInfo.value?.maxImages ?? 0;
    if (refImages.value.length >= cap) {
      toast(`该模型最多 ${cap} 张参考图`);
      return;
    }
    refImages.value.push(data);
    toast("已加入参考图", "success");
  } catch {
    toast("读取作品失败", "error");
  }
}

function autoGrow() {
  const el = promptEl.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
}

async function onGenerate() {
  if (!state.info?.hasToken) {
    go("settings");
    return;
  }
  if (!prompt.value.trim()) {
    promptEl.value?.focus();
    return;
  }
  if (editInfo.value?.required && refImages.value.length === 0) {
    toast("这个模型需要参考图，先添加 1 张", "error");
    refMenuOpen.value = true;
    return;
  }
  const seed = seedText.value.trim() === "" ? null : Number(seedText.value);
  if (seed !== null && (!Number.isInteger(seed) || seed < -1)) {
    seedText.value = "";
    return;
  }
  await startGeneration({
    model: modelId.value,
    prompt: prompt.value.trim(),
    negativePrompt: negative.value.trim() || undefined,
    size: size.value,
    seed,
    steps: steps.value,
    guidance: model.value.guidance === null ? null : guidance.value,
    ...(refImages.value.length ? { images: refImages.value.slice() } : {}),
  });
}

watch(
  () => state.info,
  (info) => {
    if (!info || initialized.value) return;
    initialized.value = true;
    if (info.defaultModel) modelId.value = info.defaultModel;
    if (info.defaultRatio) ratioKey.value = info.defaultRatio;
    if (info.defaultQuality) quality.value = info.defaultQuality;
    syncModelParams();
  },
  { immediate: true },
);

watch(
  () => state.draft,
  (draft) => {
    if (!draft) return;
    prompt.value = draft.prompt;
    negative.value = draft.negativePrompt;
    showNegative.value = Boolean(draft.negativePrompt);
    modelId.value = draft.model;
    steps.value = draft.steps ?? model.value.steps;
    guidance.value = draft.guidance;
    seedText.value = draft.seed === null ? "" : String(draft.seed);
    refImages.value = [];
    const r = ratioFromSize(draft.width, draft.height);
    ratioKey.value = r.key;
    quality.value = Math.max(draft.width, draft.height) >= 1400 ? "high" : "standard";
    state.draft = null;
    nextTick(autoGrow);
  },
);

watch(prompt, () => nextTick(autoGrow));

watch(
  () => state.pendingPrompt,
  (p) => {
    if (!p) return;
    prompt.value = p;
    state.pendingPrompt = null;
    nextTick(() => {
      autoGrow();
      promptEl.value?.focus();
    });
  },
);
watch(busy, (running) => {
  if (clock) {
    clearInterval(clock);
    clock = null;
  }
  if (running) {
    now.value = Date.now();
    clock = setInterval(() => (now.value = Date.now()), 1000);
  }
});

onMounted(() => {
  autoGrow();
  registerBackHandler(onBack);
  if (busy.value) {
    now.value = Date.now();
    clock = setInterval(() => (now.value = Date.now()), 1000);
  }
});

onBeforeUnmount(() => {
  unregisterBackHandler(onBack);
  if (clock) clearInterval(clock);
});

function onBack(): boolean {
  if (refMenuOpen.value) {
    refMenuOpen.value = false;
    return true;
  }
  return false;
}
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" />
        <div>
          <h1>魔搭画室</h1>
          <p>ModelScope Studio</p>
        </div>
      </div>
      <div class="quota-pill" :class="{ off: !state.info?.hasToken }">
        <span class="dot" />
        {{ quotaText }}
      </div>
    </header>

    <div v-if="!state.info?.hasToken" class="notice">
      <Icon name="lock" :size="17" />
      <div>
        <strong>还差一步</strong><br />
        填入魔搭访问令牌后即可开始生成，令牌只保存在本机服务端。
      </div>
      <button class="notice-action" @click="go('settings')">去设置</button>
    </div>

    <div v-if="state.task && busy" class="generating">
      <div class="gen-orb" />
      <div class="gen-inner">
        <div class="gen-status">
          <span class="pulse" />
          {{ stageText }}
        </div>
        <p class="gen-prompt">{{ state.task.prompt }}</p>
        <div class="gen-meta">
          <span>{{ state.task.modelName }}</span>
          <span>{{ state.task.size }}</span>
          <span>{{ elapsed }}s</span>
          <button class="gen-cancel" @click="cancelGeneration">取消</button>
        </div>
      </div>
      <div class="gen-bar" />
    </div>

    <div v-else-if="state.task?.status === 'failed'" class="notice">
      <Icon name="alert" :size="17" />
      <div>{{ state.task.error || "生成失败，请稍后重试" }}</div>
      <button class="notice-action" @click="dismissTask">知道了</button>
    </div>

    <section class="card prompt-card">
      <div class="prompt-label">
        <span>描述你想要的画面</span>
        <span class="counter">{{ prompt.length }}/2000</span>
      </div>
      <textarea
        ref="promptEl"
        v-model="prompt"
        class="prompt-input"
        rows="4"
        maxlength="2000"
        placeholder="例如：黄昏的海边，一位穿白裙的女孩回头，35mm 胶片质感，柔和逆光"
        @input="autoGrow"
      />
      <div v-if="showNegative" class="negative-field">
        <input
          v-model="negative"
          type="text"
          maxlength="2000"
          placeholder="不想出现的元素，例如：模糊、变形、水印"
        />
      </div>
      <div v-if="canEdit" class="ref-block">
        <div class="ref-thumbs">
          <div v-for="(img, i) in refImages" :key="i" class="ref-thumb">
            <img :src="img" alt="参考图" />
            <button class="ref-remove" @click="removeRef(i)">
              <Icon name="close" :size="11" />
            </button>
          </div>
          <button
            v-if="refImages.length < (editInfo?.maxImages ?? 0)"
            class="ref-add"
            @click="refMenuOpen = true"
          >
            <Icon name="plus" :size="17" />
            <span>参考图</span>
          </button>
        </div>
        <p class="ref-hint">{{ editHint }}</p>
      </div>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        multiple
        style="display: none"
        @change="onFilePick"
      />
      <div class="prompt-foot">
        <div style="display: flex; gap: 8px">
          <button class="mini-btn" @click="openAssistant(modelId)">
            <Icon name="chat" :size="14" />
            助手
          </button>
          <button class="mini-btn accent" @click="surprise">
            <Icon name="wand" :size="14" />
            来点灵感
          </button>
          <button class="mini-btn" @click="showNegative = !showNegative">
            <Icon name="plus" :size="14" />
            负向词
          </button>
        </div>
        <button
          v-if="prompt"
          class="mini-btn"
          style="padding: 7px 10px"
          @click="prompt = ''"
        >
          清空
        </button>
      </div>
    </section>

    <div class="section">
      <div class="section-head">
        <h2 class="section-title">风格</h2>
        <span class="section-note">点一下追加到描述</span>
      </div>
      <div class="chip-row">
        <button v-for="s in STYLES" :key="s" class="chip" @click="addStyle(s)">{{ s }}</button>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <h2 class="section-title">模型</h2>
        <button class="mini-btn" style="padding: 4px 10px" @click="pickOpen = true">
          全部 <Icon name="chevron-right" :size="12" />
        </button>
      </div>
      <div class="model-strip">
        <button
          v-for="m in state.models"
          :key="m.id"
          class="model-card"
          :class="{ active: m.id === modelId }"
          @click="onModel(m.id)"
        >
          <div class="mc-top">
            <span class="mc-name">{{ m.name }}</span>
          </div>
          <div class="mc-desc">{{ m.description }}</div>
          <div class="mc-id">{{ m.id }}</div>
        </button>
        <button class="model-card" style="width: 128px" @click="pickOpen = true">
          <div class="mc-top">
            <span class="mc-name" style="color: var(--accent-2)">更多</span>
            <Icon name="chevron-right" :size="14" style="color: var(--faint)" />
          </div>
          <div class="mc-desc">浏览全部可用模型，或填写自定义模型 ID。</div>
        </button>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <h2 class="section-title">画幅</h2>
        <span class="size-readout">{{ size }} px</span>
      </div>
      <div class="ratio-row">
        <button
          v-for="r in RATIOS"
          :key="r.key"
          class="ratio-chip"
          :class="{ active: ratioKey === r.key }"
          @click="ratioKey = r.key"
        >
          <span
            class="ratio-box"
            :style="{
              width: `${Math.round((r.w / Math.max(r.w, r.h)) * 20)}px`,
              height: `${Math.round((r.h / Math.max(r.w, r.h)) * 20)}px`,
            }"
          />
          {{ r.label }}
        </button>
      </div>

      <div style="display: flex; gap: 10px; margin-top: 10px; align-items: center">
        <div class="segment" style="flex: 1">
          <button :class="{ active: quality === 'standard' }" @click="quality = 'standard'">标准 1K</button>
          <button :class="{ active: quality === 'high' }" @click="quality = 'high'">高清 1.5K</button>
        </div>
        <button
          class="mini-btn"
          style="height: 38px; padding: 0 12px"
          @click="advancedOpen = !advancedOpen"
        >
          参数
          <Icon name="chevron-down" :size="13" :style="{ transform: advancedOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }" />
        </button>
      </div>

      <div v-if="advancedOpen" class="advanced-body">
        <div class="slider-row">
          <div class="slider-head">
            <span>采样步数</span>
            <strong>{{ steps }}</strong>
          </div>
          <input v-model.number="steps" type="range" min="1" max="50" step="1" />
        </div>
        <div v-if="model.guidance !== null" class="slider-row">
          <div class="slider-head">
            <span>引导系数 CFG</span>
            <strong>{{ guidance?.toFixed(1) }}</strong>
          </div>
          <input v-model.number="guidance" type="range" min="1" max="20" step="0.5" />
        </div>
        <div class="slider-row">
          <div class="slider-head">
            <span>随机种子</span>
            <button class="mini-btn" style="padding: 3px 9px; font-size: 10.5px" @click="randomSeed">
              随机
            </button>
          </div>
          <div class="seed-row">
            <input v-model="seedText" type="text" inputmode="numeric" placeholder="留空则每次随机" />
            <button v-if="seedText" class="mini-btn" @click="seedText = ''">清除</button>
          </div>
        </div>
        <p class="hint">推荐值来自模型卡：{{ model.name }} 默认 {{ model.steps }} 步{{ model.guidance !== null ? `、CFG ${model.guidance}` : "" }}。</p>
      </div>
    </div>

    <div class="generate-dock">
      <button class="btn-generate" :disabled="busy" @click="onGenerate">
        <Icon name="sparkles" :size="19" />
        {{ busy ? "正在生成" : state.info?.hasToken ? "开始生成" : "先配置 Token" }}
      </button>
      <div class="generate-meta">
        <span>{{ model.name }}</span>
        <span>·</span>
        <span>{{ size }}</span>
        <span>·</span>
        <span>{{ steps }} 步</span>
      </div>
    </div>

    <div v-if="recent.length" class="section" style="margin-top: 6px">
      <div class="section-head">
        <h2 class="section-title">最近</h2>
        <button class="mini-btn" style="padding: 4px 10px" @click="go('gallery')">全部作品</button>
      </div>
      <div class="recent-strip">
        <button v-for="item in recent" :key="item.id" class="thumb" @click="openViewer(item)">
          <img :src="api.imageUrl(item.file)" :alt="item.prompt" loading="lazy" />
        </button>
      </div>
    </div>

    <p class="hint" style="text-align: center; margin-top: 18px">
      图片由魔搭 API-Inference 生成 · 生成内容请遵守平台规范
    </p>

    <ModelPicker v-if="pickOpen" :current="modelId" @select="onModel" @close="pickOpen = false" />
    <PromptAssistant
      v-if="state.assistantOpen"
      :image-model="modelId"
      :model-name="model.name"
      :current-prompt="prompt"
      :current-images="refImages"
    />
    <HistoryPicker
      v-if="historyPickerOpen"
      @select="onPickFromHistory"
      @close="historyPickerOpen = false"
    />
    <div v-if="refMenuOpen" class="sheet-backdrop" @click.self="refMenuOpen = false">
      <div class="sheet-panel" style="overflow: visible">
        <div class="sheet-grip" />
        <div class="sheet-title">
          <h2>添加参考图</h2>
          <button class="icon-btn" style="width: 32px; height: 32px" @click="refMenuOpen = false">
            <Icon name="close" :size="16" />
          </button>
        </div>
        <button class="ref-menu-item" @click="fileInput?.click(); refMenuOpen = false">
          <Icon name="image" :size="18" />
          <span>从相册选择</span>
        </button>
        <button
          class="ref-menu-item"
          :disabled="!state.history.length"
          @click="historyPickerOpen = true; refMenuOpen = false"
        >
          <Icon name="clock" :size="18" />
          <span>从作品选择</span>
        </button>
      </div>
    </div>
  </div>
</template>
