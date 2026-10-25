<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import Icon from "./Icon.vue";
import { registerBackHandler, state, unregisterBackHandler } from "../store";
import * as api from "../api";

const emit = defineEmits<{ select: [file: string]; close: [] }>();

const onBack = () => {
  emit("close");
  return true;
};
onMounted(() => registerBackHandler(onBack));
onBeforeUnmount(() => unregisterBackHandler(onBack));

const recent = state.history.slice(0, 60);
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <div class="sheet-panel">
      <div class="sheet-grip" />
      <div class="sheet-title">
        <h2>选择参考图</h2>
        <button class="icon-btn" style="width: 32px; height: 32px" @click="emit('close')">
          <Icon name="close" :size="16" />
        </button>
      </div>
      <p class="hp-hint">选一张已有作品垫底，生成的图会基于它修改</p>
      <div class="hp-grid">
        <button
          v-for="item in recent"
          :key="item.id"
          class="hp-item"
          @click="emit('select', item.file)"
        >
          <img :src="api.imageUrl(item.file)" :alt="item.prompt" loading="lazy" />
        </button>
      </div>
    </div>
  </div>
</template>
