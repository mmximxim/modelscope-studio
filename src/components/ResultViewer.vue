<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Icon from "./Icon.vue";
import * as api from "../api";
import { closeViewer, favorite, registerBackHandler, removeHistory, reuse, saveImage, state, toast, unregisterBackHandler } from "../store";
import { formatDateTime, formatDuration } from "../lib/format";

const item = computed(() => state.viewer);
const saving = ref(false);
const confirming = ref(false);

const onBack = () => {
  closeViewer();
  return true;
};
onMounted(() => registerBackHandler(onBack));
onBeforeUnmount(() => unregisterBackHandler(onBack));

const src = computed(() => (item.value ? api.imageUrl(item.value.file) : ""));

async function onSave() {
  if (!item.value || saving.value) return;
  saving.value = true;
  try {
    await saveImage(item.value);
  } finally {
    saving.value = false;
  }
}

async function onCopy() {
  if (!item.value) return;
  try {
    await navigator.clipboard.writeText(item.value.prompt);
    toast("提示词已复制", "success");
  } catch {
    toast("复制失败，请手动选择文本", "error");
  }
}

async function onDelete() {
  if (!item.value) return;
  if (!confirming.value) {
    confirming.value = true;
    window.setTimeout(() => (confirming.value = false), 3200);
    return;
  }
  await removeHistory(item.value);
}
</script>

<template>
  <div v-if="item" class="viewer">
    <div class="viewer-bar">
      <button class="icon-btn" @click="closeViewer">
        <Icon name="close" :size="18" />
      </button>
      <div class="spacer" />
      <button
        class="icon-btn"
        :class="{ liked: item.favorite }"
        @click="favorite(item)"
        :aria-label="item.favorite ? '取消收藏' : '收藏'"
      >
        <Icon name="heart" :size="18" :fill="item.favorite" />
      </button>
      <button class="icon-btn" :class="{ liked: confirming }" @click="onDelete">
        <Icon name="trash" :size="17" />
      </button>
    </div>

    <div class="viewer-stage">
      <img :src="src" :alt="item.prompt" />
    </div>

    <div class="viewer-info">
      <p class="viewer-prompt">{{ item.prompt }}</p>
      <div class="meta-chips">
        <span class="meta-chip">{{ item.modelName }}</span>
        <span class="meta-chip">{{ item.size }}</span>
        <span v-if="item.steps" class="meta-chip">{{ item.steps }} 步</span>
        <span v-if="item.guidance" class="meta-chip">CFG {{ item.guidance }}</span>
        <span v-if="item.seed !== null" class="meta-chip">种子 {{ item.seed }}</span>
        <span class="meta-chip">{{ formatDuration(item.elapsedMs) }}</span>
        <span class="meta-chip">{{ formatDateTime(item.createdAt) }}</span>
      </div>

      <div class="viewer-actions">
        <button class="btn primary" :disabled="saving" @click="onSave">
          <Icon name="download" :size="16" />
          {{ saving ? "保存中" : "保存" }}
        </button>
        <button class="btn" @click="onCopy">
          <Icon name="copy" :size="15" />
          复制词
        </button>
        <button class="btn" @click="reuse(item)">
          <Icon name="refresh" :size="15" />
          再做
        </button>
      </div>
    </div>
  </div>
</template>
