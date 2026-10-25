<script setup lang="ts">
import { computed, ref } from "vue";
import Icon from "../components/Icon.vue";
import * as api from "../api";
import { go, openViewer, state } from "../store";

const filter = ref<"all" | "fav">("all");

const items = computed(() =>
  filter.value === "all" ? state.history : state.history.filter((h) => h.favorite),
);
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="brand">
        <div>
          <h1 style="letter-spacing: 0.12em">作品</h1>
          <p>{{ state.history.length }} images · 本地保存</p>
        </div>
      </div>
      <div class="quota-pill">今日 {{ state.info?.stats.today ?? 0 }} 张</div>
    </header>

    <div class="filter-row">
      <button class="chip" :class="{ active: filter === 'all' }" @click="filter = 'all'">
        全部
      </button>
      <button class="chip" :class="{ active: filter === 'fav' }" @click="filter = 'fav'">
        收藏 · {{ state.info?.stats.favorites ?? 0 }}
      </button>
    </div>

    <div v-if="items.length === 0" class="empty">
      <div class="empty-mark">
        <Icon name="image" :size="30" :stroke="1.3" />
      </div>
      <h3>{{ filter === "fav" ? "还没有收藏" : "画廊还是空的" }}</h3>
      <p>
        {{
          filter === "fav"
            ? "在作品上点一下心形，喜欢的画面会留在这里。"
            : "写下你脑海里的画面，第一张作品就会出现在这里。"
        }}
      </p>
      <button class="btn primary" style="margin-top: 20px" @click="go('create')">
        <Icon name="sparkles" :size="16" />
        去创作
      </button>
    </div>

    <div v-else class="gallery-grid">
      <button
        v-for="item in items"
        :key="item.id"
        class="gallery-item"
        @click="openViewer(item)"
        :aria-label="item.prompt"
      >
        <img :src="api.imageUrl(item.file)" :alt="item.prompt" loading="lazy" />
        <span v-if="item.favorite" class="fav"><Icon name="heart" :size="13" fill /></span>
      </button>
    </div>

    <p v-if="items.length" class="hint" style="text-align: center; margin-top: 18px">
      轻点查看大图 · 可保存、收藏或带入参数重做
    </p>
  </div>
</template>
