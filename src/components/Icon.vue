<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    name: string;
    size?: number;
    fill?: boolean;
    stroke?: number;
  }>(),
  { size: 20, fill: false, stroke: 1.7 },
);

const PATHS: Record<string, string[]> = {
  sparkles: [
    "M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3z",
    "M19 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z",
  ],
  image: [
    "M4.5 4.5h15a1 1 0 011 1v13a1 1 0 01-1 1h-15a1 1 0 01-1-1v-13a1 1 0 011-1z",
    "M3.5 16l4.6-4.6a1 1 0 011.4 0l3 3",
    "M13 14.5l2.3-2.3a1 1 0 011.4 0l4.8 4.8",
    "M9.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z",
  ],
  sliders: [
    "M4 7h6M14 7h6M4 12h4M12 12h8M4 17h10M18 17h2",
    "M12 5a2 2 0 100 4 2 2 0 000-4z",
    "M10 10a2 2 0 100 4 2 2 0 000-4z",
    "M16 15a2 2 0 100 4 2 2 0 000-4z",
  ],
  wand: [
    "M15 4V2M15 10V8M11 7h2M17 7h2M7 20l9.5-9.5M4.5 19.5l2 2",
  ],
  close: ["M6 6l12 12M18 6L6 18"],
  download: ["M12 3v12M7 10l5 5 5-5M4 19h16"],
  share: ["M12 16V4M8 8l4-4 4 4M5 14v4.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V14"],
  refresh: ["M20 12a8 8 0 11-2.34-5.66M20 4v5h-5"],
  trash: [
    "M4 7h16M9.5 7V5.5A1.5 1.5 0 0111 4h2a1.5 1.5 0 011.5 1.5V7",
    "M6.5 7l.9 12A1.5 1.5 0 008.9 20.5h6.2a1.5 1.5 0 001.5-1.4L17.5 7",
    "M10 11v6M14 11v6",
  ],
  heart: ["M12 20.3s-7.4-4.5-7.4-9.6A4.3 4.3 0 0112 8.1a4.3 4.3 0 017.4 2.6c0 5.1-7.4 9.6-7.4 9.6z"],
  check: ["M4.5 12.5l4.5 4.5L19.5 6.5"],
  alert: ["M12 3.5l8.5 15.5h-17L12 3.5z", "M12 9.5v4M12 16.8v.4"],
  plus: ["M12 5v14M5 12h14"],
  eye: ["M2.5 12S6 6.2 12 6.2 21.5 12 21.5 12 18 17.8 12 17.8 2.5 12 2.5 12z", "M15 12a3 3 0 11-6 0 3 3 0 016 0z"],
  "eye-off": [
    "M3 3l18 18",
    "M10.6 6.4A10.4 10.4 0 0112 6.2c6 0 9.5 5.8 9.5 5.8a17.6 17.6 0 01-3.1 3.7",
    "M6.3 7.9A17 17 0 002.5 12S6 17.8 12 17.8c1.4 0 2.7-.3 3.8-.8",
  ],
  copy: ["M9 9h10.5v11H9z", "M5 15V4.5h10"],
  "chevron-down": ["M6 9l6 6 6-6"],
  "chevron-right": ["M9 6l6 6-6 6"],
  "arrow-left": ["M15 18l-6-6 6-6"],
  clock: ["M21 12a9 9 0 11-18 0 9 9 0 0118 0z", "M12 7.5V12l3 1.8"],
  info: ["M21 12a9 9 0 11-18 0 9 9 0 0118 0z", "M12 11v5M12 8h.01"],
  lock: ["M6 10.5h12a1 1 0 011 1V20a1 1 0 01-1 1H6a1 1 0 01-1-1v-8.5a1 1 0 011-1z", "M9 10.5V8a3 3 0 016 0v2.5"],
  external: ["M14 4h6v6", "M20 4l-8.5 8.5", "M18 14v5.5a.5.5 0 01-.5.5h-13a.5.5 0 01-.5-.5v-13a.5.5 0 01.5-.5H10"],
  dice: ["M4 4h16v16H4z", "M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01"],
  server: ["M4 5h16v6H4zM4 13h16v6H4z", "M7.5 8h.01M7.5 16h.01"],
  chat: ["M4 5.5h16a1 1 0 011 1v9a1 1 0 01-1 1H9l-4.2 3.4A0.6 0.6 0 014 19.4V6.5a1 1 0 011-1z", "M8 10.5h8M8 13.5h5"],
  send: ["M4 11.5L20 4l-7.5 16-2-6.5-6.5-2z"],
  phone: ["M7 2.5h10a1.5 1.5 0 011.5 1.5v16a1.5 1.5 0 01-1.5 1.5H7A1.5 1.5 0 015.5 20V4A1.5 1.5 0 017 2.5z", "M10.5 18.5h3"],
};

const paths = computed(() => PATHS[props.name] ?? PATHS.info);
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    :fill="fill ? 'currentColor' : 'none'"
    :stroke="fill && name === 'heart' ? 'none' : 'currentColor'"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="display: block; flex: none"
  >
    <path v-for="(d, i) in paths" :key="i" :d="d" />
  </svg>
</template>
