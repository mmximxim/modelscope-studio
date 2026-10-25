<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import Icon from "../components/Icon.vue";
import ModelPicker from "../components/ModelPicker.vue";
import * as api from "../api";
import { findModel, refreshInfo, refreshMagicube as storeRefreshMagicube, state, toast } from "../store";
import { RATIOS, ratioOf, type Quality } from "../lib/size";

const tokenInput = ref("");
const showToken = ref(false);
const editing = ref(false);
const saving = ref(false);
const testing = ref(false);
const confirmRemove = ref(false);
const pickOpen = ref(false);

const model = computed(() => findModel(state.info?.defaultModel ?? ""));
const urls = computed(() => state.info?.server.urls ?? []);

// ---- 魔方余额（数据与刷新在 store，主页角标共用） ----
type MagicubeEntry = { key: string; value: string };
const magicube = computed(() => state.magicube);
const magicubeBusy = computed(() => state.magicubeBusy);

const magicubeEntries = computed<MagicubeEntry[]>(() => {
  const d = magicube.value?.data;
  if (!d || typeof d !== "object") return [];
  const LABELS: Record<string, string> = {
    total_balance: "累计魔粒",
    available_balance: "可用魔粒",
    frozen_amount: "冻结",
    Balance: "余额",
    balance: "余额",
    Magicube: "魔方",
    magicube: "魔方",
    Credit: "积分",
    credit: "积分",
    Total: "累计",
    total: "累计",
    DailyIncome: "今日获得",
    dailyIncome: "今日获得",
    Frozen: "冻结",
    frozen: "冻结",
  };
  const out: MagicubeEntry[] = [];
  for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
    if (v === null || typeof v === "object") continue;
    out.push({ key: LABELS[k] ?? k, value: String(v) });
  }
  return out.slice(0, 8);
});

function refreshMagicube() {
  void storeRefreshMagicube();
}

function openWebLogin() {
  const bridge = (window as unknown as { MStudio?: { openLogin?: () => void } }).MStudio;
  if (bridge?.openLogin) {
    bridge.openLogin();
  } else {
    toast("当前环境不支持网页登录", "error");
  }
}

async function removeCookie() {
  try {
    await api.clearCookie();
    await refreshInfo();
    void storeRefreshMagicube();
    toast("已退出网页登录");
  } catch {
    toast("操作失败", "error");
  }
}

onMounted(() => {
  if (state.info?.hasToken) void refreshMagicube();
});

watch(
  () => state.info?.hasToken,
  (has) => {
    if (!has) editing.value = true;
  },
  { immediate: true },
);

async function save() {
  const token = tokenInput.value.trim();
  if (token.length < 8) return;
  saving.value = true;
  try {
    await api.saveToken(token);
    await refreshInfo();
    tokenInput.value = "";
    editing.value = false;
    toast("Token 已验证并保存", "success");
  } catch (err) {
    toast(err instanceof Error ? err.message : "保存失败", "error");
  } finally {
    saving.value = false;
  }
}

async function test() {
  testing.value = true;
  try {
    await api.testToken();
    await refreshInfo();
    toast("连接正常", "success");
  } catch (err) {
    toast(err instanceof Error ? err.message : "连接失败", "error");
  } finally {
    testing.value = false;
  }
}

async function remove() {
  if (!confirmRemove.value) {
    confirmRemove.value = true;
    window.setTimeout(() => (confirmRemove.value = false), 3200);
    return;
  }
  try {
    await api.clearToken();
    await refreshInfo();
    editing.value = true;
    confirmRemove.value = false;
    toast("Token 已移除");
  } catch (err) {
    toast(err instanceof Error ? err.message : "移除失败", "error");
  }
}

async function pickModel(id: string) {
  pickOpen.value = false;
  try {
    await api.savePrefs({ defaultModel: id });
    await refreshInfo();
    toast("默认模型已更新");
  } catch (err) {
    toast(err instanceof Error ? err.message : "保存失败", "error");
  }
}

async function setRatio(key: string) {
  try {
    await api.savePrefs({ defaultRatio: key });
    await refreshInfo();
  } catch {
    toast("保存失败", "error");
  }
}

async function setQuality(q: Quality) {
  try {
    await api.savePrefs({ defaultQuality: q });
    await refreshInfo();
  } catch {
    toast("保存失败", "error");
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制", "success");
  } catch {
    toast("复制失败", "error");
  }
}
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="brand">
        <div>
          <h1 style="letter-spacing: 0.12em">设置</h1>
          <p>Token · 默认参数 · 服务</p>
        </div>
      </div>
      <img src="/icons/icon.svg" alt="" width="34" height="34" style="border-radius: 11px" />
    </header>

    <!-- Token -->
    <div class="section" style="margin-top: 0">
      <div class="section-head">
        <h2 class="section-title">魔搭访问令牌</h2>
        <span class="section-note">仅存本机</span>
      </div>
      <div class="card token-card">
        <div class="token-status">
          <div class="badge" :class="{ off: !state.info?.hasToken }">
            <Icon :name="state.info?.hasToken ? 'check' : 'lock'" :size="16" />
          </div>
          <div>
            <div class="t1">{{ state.info?.hasToken ? "已连接" : "未配置" }}</div>
            <div class="t2">
              {{ state.info?.hasToken ? state.info.tokenMasked : "请从魔搭个人中心创建访问令牌" }}
            </div>
          </div>
        </div>

        <template v-if="state.info?.hasToken && !editing">
          <div style="display: flex; gap: 8px">
            <button class="btn" style="flex: 1" @click="test" :disabled="testing">
              <Icon name="refresh" :size="14" />
              {{ testing ? "测试中" : "测试连接" }}
            </button>
            <button class="btn" style="flex: 1" @click="editing = true">
              <Icon name="sliders" :size="14" />
              更换
            </button>
            <button class="btn danger" @click="remove">
              {{ confirmRemove ? "确认移除" : "移除" }}
            </button>
          </div>
        </template>

        <template v-else>
          <div class="field">
            <input
              v-model="tokenInput"
              :type="showToken ? 'text' : 'password'"
              placeholder="粘贴 ms- 开头的访问令牌"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              @keyup.enter="save"
            />
            <button class="icon-btn" style="align-self: center" @click="showToken = !showToken">
              <Icon :name="showToken ? 'eye-off' : 'eye'" :size="16" />
            </button>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 10px">
            <button class="btn primary" style="flex: 1" :disabled="tokenInput.trim().length < 8 || saving" @click="save">
              <Icon name="check" :size="15" />
              {{ saving ? "验证中" : "验证并保存" }}
            </button>
            <button
              v-if="state.info?.hasToken"
              class="btn"
              @click="editing = false; tokenInput = ''"
            >
              取消
            </button>
          </div>
        </template>

        <p class="hint" style="margin-top: 12px">
          令牌在服务端验证后写入本机 data/config.json，不会发送到前端。
          <a href="https://modelscope.cn/my/myaccesstoken" target="_blank" rel="noreferrer">
            打开魔搭令牌页 <Icon name="external" :size="10" style="display: inline-block; vertical-align: -1px" />
          </a>
        </p>
      </div>
    </div>

    <!-- 魔方余额 -->
    <div class="section" style="margin-top: 14px">
      <div class="section-head">
        <h2 class="section-title">魔方余额</h2>
        <div style="display: flex; gap: 8px; align-items: center">
          <span class="section-note">{{ magicube?.ok ? (magicube.auth === "token" ? "令牌查询" : "网页登录") : "网页登录后显示" }}</span>
          <button v-if="state.info?.hasToken" class="mini-btn" style="padding: 3px 9px" :disabled="magicubeBusy" @click="refreshMagicube">
            <Icon name="refresh" :size="12" :style="{ animation: magicubeBusy ? 'spin 0.8s linear infinite' : 'none' }" />
            {{ magicubeBusy ? "查询中" : "刷新" }}
          </button>
        </div>
      </div>
      <div class="card" style="padding: 14px">
        <template v-if="magicube?.ok && magicubeEntries.length">
          <div style="display: flex; flex-wrap: wrap; gap: 8px 22px">
            <div v-for="e in magicubeEntries" :key="e.key" style="min-width: 90px">
              <div style="font-size: 10.5px; color: var(--faint)">{{ e.key }}</div>
              <div style="font-size: 17px; font-weight: 600; font-family: var(--font-mono, monospace)">{{ e.value }}</div>
            </div>
          </div>
          <div v-if="state.info?.hasCookie" style="margin-top: 10px">
            <button class="mini-btn" style="padding: 3px 9px" @click="removeCookie">退出网页登录</button>
          </div>
        </template>
        <template v-else>
          <p class="hint" style="margin: 0">
            {{ magicube?.error ?? "尚未查询" }}
          </p>
          <button
            v-if="state.info?.webLogin"
            class="btn primary"
            style="margin-top: 10px; width: 100%"
            @click="openWebLogin"
          >
            <Icon name="external" :size="14" />
            登录魔搭网页版
          </button>
          <p v-if="state.info?.webLogin" class="hint" style="margin: 8px 0 0">
            令牌查询失败时的后备方式：网页登录后用站点会话查询。
          </p>
        </template>
      </div>
    </div>

    <!-- 默认参数 -->
    <div class="section">
      <div class="section-head">
        <h2 class="section-title">生成偏好</h2>
        <span class="section-note">新建作品时生效</span>
      </div>
      <div class="setting-group">
        <button class="setting-row tappable" style="width: 100%; text-align: left" @click="pickOpen = true">
          <div class="row-main">
            <div class="row-label">默认模型</div>
            <div class="row-sub">{{ model?.id ?? state.info?.defaultModel ?? "—" }}</div>
          </div>
          <span class="row-value">{{ model?.name ?? "选择" }}</span>
          <Icon name="chevron-right" :size="16" class="arrow" />
        </button>
        <div class="setting-row" style="display: block">
          <div class="row-label" style="margin-bottom: 10px">默认画幅</div>
          <div class="chip-row">
            <button
              v-for="r in RATIOS"
              :key="r.key"
              class="chip"
              :class="{ active: state.info?.defaultRatio === r.key }"
              @click="setRatio(r.key)"
            >
              {{ r.label }}
            </button>
          </div>
        </div>
        <div class="setting-row">
          <div class="row-main">
            <div class="row-label">默认清晰度</div>
            <div class="row-sub">高清档长边 1536，受模型上限约束</div>
          </div>
          <div class="segment" style="width: 150px">
            <button :class="{ active: state.info?.defaultQuality === 'standard' }" @click="setQuality('standard')">标准</button>
            <button :class="{ active: state.info?.defaultQuality === 'high' }" @click="setQuality('high')">高清</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 手机访问 -->
    <div class="section">
      <div class="section-head">
        <h2 class="section-title">手机访问</h2>
        <span class="section-note">与电脑同一 Wi-Fi</span>
      </div>
      <div class="setting-group">
        <div v-for="url in urls" :key="url" class="setting-row">
          <div class="row-main">
            <div class="row-label">
              <Icon name="phone" :size="14" />
              局域网地址
            </div>
            <div class="row-sub">{{ url }}</div>
          </div>
          <button class="mini-btn" @click="copy(url)">
            <Icon name="copy" :size="13" />
            复制
          </button>
        </div>
        <div v-if="!urls.length" class="setting-row">
          <div class="row-main">
            <div class="row-label">局域网地址</div>
            <div class="row-sub">未检测到局域网网卡</div>
          </div>
        </div>
        <div class="setting-row">
          <div class="row-main">
            <div class="row-label">添加到主屏幕</div>
            <div class="row-sub">用手机浏览器打开上面的地址，选择“添加到主屏幕”即可像 App 一样使用。</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 关于 -->
    <div class="section">
      <div class="section-head">
        <h2 class="section-title">关于</h2>
      </div>
      <div class="setting-group">
        <div class="setting-row">
          <div class="row-main">
            <div class="row-label">版本</div>
            <div class="row-sub">魔搭画室 · PWA</div>
          </div>
          <span class="row-value">v{{ state.info?.version ?? "0.1.0" }}</span>
        </div>
        <div class="setting-row">
          <div class="row-main">
            <div class="row-label">接口</div>
            <div class="row-sub">api-inference.modelscope.cn / v1</div>
          </div>
          <span class="row-value">异步任务</span>
        </div>
        <div class="setting-row">
          <div class="row-main">
            <div class="row-label">数据存储</div>
            <div class="row-sub">图片与生成记录保存在本机 data/ 目录，不会上传到第三方。</div>
          </div>
        </div>
      </div>
    </div>

    <p class="hint" style="text-align: center; margin-top: 22px; line-height: 1.8">
      访问令牌由服务端保管，请勿把本服务暴露到公网。<br />
      如需公网访问，请先设置 ACCESS_CODE 环境变量。
    </p>

    <ModelPicker
      v-if="pickOpen"
      :current="state.info?.defaultModel ?? ''"
      @select="pickModel"
      @close="pickOpen = false"
    />
  </div>
</template>
