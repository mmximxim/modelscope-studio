<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";
import { go, state, type Tab } from "../store";

const tabs: { key: Tab; label: string; icon: string }[] = [
  { key: "create", label: "创作", icon: "sparkles" },
  { key: "gallery", label: "作品", icon: "image" },
  { key: "settings", label: "设置", icon: "sliders" },
];

const running = computed(
  () => state.task?.status === "queued" || state.task?.status === "running",
);
</script>

<template>
  <nav class="tabbar">
    <div class="tabbar-inner">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab-item"
        :class="{ active: state.tab === t.key }"
        @click="go(t.key)"
      >
        <Icon :name="t.icon" :size="21" />
        <span>{{ t.label }}</span>
        <span v-if="t.key === 'create' && running" class="badge-dot" />
      </button>
    </div>
  </nav>
</template>
