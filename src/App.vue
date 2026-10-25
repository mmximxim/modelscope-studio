<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import CreateView from "./views/CreateView.vue";
import GalleryView from "./views/GalleryView.vue";
import SettingsView from "./views/SettingsView.vue";
import ResultViewer from "./components/ResultViewer.vue";
import TabBar from "./components/TabBar.vue";
import Icon from "./components/Icon.vue";
import { attachTask, boot, refreshHistory, refreshInfo, refreshMagicube, state, submitAccessCode, toast } from "./store";

const accessInput = ref("");
const accessBusy = ref(false);

async function enterWithCode() {
  if (!accessInput.value.trim() || accessBusy.value) return;
  accessBusy.value = true;
  try {
    await submitAccessCode(accessInput.value);
    if (!state.needAccess) accessInput.value = "";
  } finally {
    accessBusy.value = false;
  }
}

watch(
  () => state.tab,
  (tab) => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    if (tab === "gallery") void refreshHistory();
    else void refreshInfo();
  },
);

function onVisibility() {
  if (document.visibilityState !== "visible") return;
  void refreshInfo();
  if (state.info?.hasToken) void refreshMagicube();
  if (state.task && (state.task.status === "running" || state.task.status === "queued")) {
    void attachTask(state.task.id);
  }
}

async function retryBoot() {
  state.booted = false;
  await boot();
  if (state.bootError) toast(state.bootError, "error");
}

onMounted(() => {
  void boot();
  document.addEventListener("visibilitychange", onVisibility);
});

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onVisibility);
});
</script>

<template>
  <div v-if="!state.booted" class="boot">
    <div style="text-align: center">
      <div class="boot-mark" />
      <div>正在打开画室</div>
    </div>
  </div>

  <div v-else-if="state.bootError" class="boot">
    <div style="text-align: center; max-width: 300px">
      <div class="empty-mark" style="margin-bottom: 16px">
        <Icon name="alert" :size="28" />
      </div>
      <div style="color: var(--text); font-size: 14px; margin-bottom: 6px">连接服务失败</div>
      <div style="font-size: 12px; line-height: 1.7; color: var(--faint)">{{ state.bootError }}</div>
      <button class="btn primary" style="margin-top: 18px" @click="retryBoot">重试</button>
    </div>
  </div>

  <template v-else>
    <div class="app-shell">
      <CreateView v-show="state.tab === 'create'" />
      <GalleryView v-if="state.tab === 'gallery'" />
      <SettingsView v-if="state.tab === 'settings'" />
    </div>

    <TabBar />
    <ResultViewer v-if="state.viewer" />

    <div class="toasts">
      <TransitionGroup name="toast">
        <div v-for="t in state.toasts" :key="t.id" class="toast" :class="t.tone">{{ t.text }}</div>
      </TransitionGroup>
    </div>

    <div
      v-if="state.needAccess"
      class="sheet-backdrop"
      style="align-items: center; z-index: 100"
    >
      <div class="card" style="width: calc(100% - 44px); max-width: 340px; padding: 24px">
        <div class="empty-mark" style="margin: 0 auto 16px; width: 62px; height: 62px; border-radius: 20px">
          <Icon name="lock" :size="26" />
        </div>
        <h3
          style="
            margin: 0 0 6px;
            text-align: center;
            font-family: var(--font-serif);
            font-size: 18px;
            font-weight: 600;
            letter-spacing: 0.08em;
          "
        >
          需要访问码
        </h3>
        <p class="hint" style="text-align: center; margin-bottom: 16px">
          服务端已开启访问保护，请输入 ACCESS_CODE。
        </p>
        <div class="field">
          <input
            v-model="accessInput"
            type="password"
            placeholder="访问码"
            autocomplete="off"
            @keyup.enter="enterWithCode"
          />
          <button class="btn primary" :disabled="accessBusy || !accessInput.trim()" @click="enterWithCode">
            进入
          </button>
        </div>
      </div>
    </div>
  </template>
</template>
