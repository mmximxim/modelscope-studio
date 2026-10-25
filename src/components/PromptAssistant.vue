<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Icon from "./Icon.vue";
import { assistantSend, clearAssistant, closeAssistant, registerBackHandler, state, toast, unregisterBackHandler, useAssistantPrompt } from "../store";

const props = defineProps<{
  imageModel: string;
  modelName: string;
  currentPrompt: string;
  currentImages: string[];
}>();

const onBack = () => {
  closeAssistant();
  return true;
};
onMounted(() => registerBackHandler(onBack));
onBeforeUnmount(() => unregisterBackHandler(onBack));

const input = ref("");
const listEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);

const msgs = computed(() => state.assistantMsgs);
const busy = computed(() => state.assistantBusy);
const hasPrompt = computed(() => props.currentPrompt.trim().length > 0);

const SUGGESTIONS = [
  "帮我写一个雨夜霓虹街头的电影感提示词",
  "想要一张国风水墨山水，怎么写提示词？",
  "产品图：一只陶瓷杯放在木桌上，帮我想构图和光线",
];

function scrollBottom() {
  nextTick(() => {
    const el = listEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

watch(
  () => [msgs.value.length, busy.value],
  () => scrollBottom(),
  { immediate: true },
);

/** 取回复里最后一个 ``` 围栏代码块作为提示词 */
function extractPrompt(text: string): string {
  const blocks = [...text.matchAll(/```[^\n]*\n?([\s\S]*?)```/g)];
  const last = blocks.length ? blocks[blocks.length - 1][1] : "";
  return last.trim();
}

function hasBlock(text: string): boolean {
  return /```[^\n]*\n?[\s\S]*?```/.test(text);
}

function apply(text: string) {
  const p = extractPrompt(text);
  if (!p) {
    toast("这条回复里没有可用的提示词");
    return;
  }
  useAssistantPrompt(p);
}

function optimize() {
  const p = props.currentPrompt.trim();
  if (!p) return;
  void assistantSend(`请把下面这段想法优化成适合当前模型的提示词：\n${p}`, props.imageModel, props.currentImages);
}

function send() {
  const t = input.value.trim();
  if (!t || busy.value) return;
  input.value = "";
  if (inputEl.value) inputEl.value.style.height = "auto";
  void assistantSend(t, props.imageModel, props.currentImages);
}

function autoGrow() {
  const el = inputEl.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="closeAssistant">
    <div class="sheet-panel assistant-panel">
      <div class="sheet-grip" />
      <div class="sheet-title">
        <div class="as-title">
          <h2>提示词助手</h2>
          <span class="as-model">{{ modelName }}</span>
        </div>
        <div style="display: flex; gap: 4px">
          <button
            v-if="msgs.length"
            class="icon-btn"
            style="width: 32px; height: 32px"
            title="清空对话"
            @click="clearAssistant"
          >
            <Icon name="trash" :size="15" />
          </button>
          <button class="icon-btn" style="width: 32px; height: 32px" @click="closeAssistant">
            <Icon name="close" :size="16" />
          </button>
        </div>
      </div>

      <div ref="listEl" class="as-list">
        <div v-if="!msgs.length" class="as-empty">
          <Icon name="chat" :size="26" />
          <p>把想法告诉我，我帮你打磨成适合 <strong>{{ modelName }}</strong> 的提示词。</p>
          <div class="as-suggest">
            <button
              v-for="s in SUGGESTIONS"
              :key="s"
              class="as-chip"
              @click="void assistantSend(s, props.imageModel, props.currentImages)"
            >
              {{ s }}
            </button>
          </div>
        </div>

        <div v-for="(m, i) in msgs" :key="i" class="as-msg" :class="m.role">
          <div class="as-bubble">
            <div v-if="m.images?.length" class="as-msg-imgs">
              <img v-for="(img, ii) in m.images" :key="ii" :src="img" alt="参考图" />
            </div>
            <p v-for="(line, li) in m.content.split('\n')" :key="li" :class="{ 'as-gap': !line }">
              {{ line }}
            </p>
            <button
              v-if="m.role === 'assistant' && hasBlock(m.content)"
              class="as-apply"
              @click="apply(m.content)"
            >
              <Icon name="wand" :size="13" />
              填入提示词
            </button>
          </div>
        </div>

        <div v-if="busy" class="as-msg assistant">
          <div class="as-bubble as-typing">
            <span /><span /><span />
          </div>
        </div>
      </div>

      <div class="as-actions">
        <button class="as-optimize" :disabled="busy || !hasPrompt" @click="optimize">
          <Icon name="sparkles" :size="14" />
          优化当前提示词{{ props.currentImages.length ? `（含 ${props.currentImages.length} 图）` : "" }}
        </button>
      </div>

      <div class="as-input">
        <textarea
          ref="inputEl"
          v-model="input"
          rows="1"
          maxlength="2000"
          placeholder="描述你的想法，或直接向助手提问"
          @input="autoGrow"
          @keydown.enter.exact.prevent="send"
        />
        <button class="as-send" :disabled="busy || !input.trim()" @click="send">
          <Icon name="send" :size="16" />
        </button>
      </div>
    </div>
  </div>
</template>
