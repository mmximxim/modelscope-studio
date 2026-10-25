<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import Icon from "./Icon.vue";
import { registerBackHandler, state, unregisterBackHandler } from "../store";

defineProps<{ current: string }>();
const emit = defineEmits<{ select: [id: string]; close: [] }>();

const custom = ref("");
const showCustom = ref(false);

const onBack = () => {
  emit("close");
  return true;
};
onMounted(() => registerBackHandler(onBack));
onBeforeUnmount(() => unregisterBackHandler(onBack));

function pick(id: string) {
  emit("select", id);
}

function useCustom() {
  const id = custom.value.trim();
  if (!id.includes("/")) return;
  emit("select", id);
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <div class="sheet-panel">
      <div class="sheet-grip" />
      <div class="sheet-title">
        <h2>选择模型</h2>
        <button class="icon-btn" style="width: 32px; height: 32px" @click="emit('close')">
          <Icon name="close" :size="16" />
        </button>
      </div>

      <button
        v-for="m in state.models"
        :key="m.id"
        class="model-option"
        :class="{ active: m.id === current }"
        @click="pick(m.id)"
      >
        <span class="radio" />
        <span style="flex: 1; min-width: 0">
          <span class="mo-name">{{ m.name }} <span>{{ m.tag }}</span></span>
          <span class="mo-desc">{{ m.description }}</span>
          <span class="mo-id">{{ m.id }}</span>
        </span>
      </button>

      <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line)">
        <button
          v-if="!showCustom"
          class="mini-btn"
          style="width: 100%; justify-content: center; height: 42px"
          @click="showCustom = true"
        >
          <Icon name="plus" :size="15" />
          使用自定义模型 ID
        </button>
        <div v-else class="field">
          <input
            v-model="custom"
            type="text"
            placeholder="例如 Qwen/Qwen-Image-Edit-2509"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            @keyup.enter="useCustom"
          />
          <button class="btn primary" :disabled="!custom.includes('/')" @click="useCustom">使用</button>
        </div>
      </div>
    </div>
  </div>
</template>
