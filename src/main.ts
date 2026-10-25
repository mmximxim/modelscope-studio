import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

createApp(App).mount("#app");

const isLocalApp = location.hostname === "127.0.0.1" || location.hostname === "localhost";
if ("serviceWorker" in navigator && import.meta.env.PROD && !isLocalApp) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* 离线能力不可用不影响主流程 */
    });
  });
}
