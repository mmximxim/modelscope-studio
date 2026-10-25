// CDP 诊断：观察 modelscope.cn 登录态下的 API 请求头（打码）+ 直接调魔方接口
const fs = require("fs");
const targets = JSON.parse(fs.readFileSync("cdp-targets.json", "utf8"));
const t = targets.find((x) => x.type === "page" && x.url.includes("modelscope.cn"));
if (!t) { console.log("no modelscope target"); process.exit(1); }

const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const reqs = [];

ws.onopen = () => {
  send("Network.enable");
  send("Runtime.enable");
  step1();
};

function send(method, params = {}, cb) {
  const msg = { id: ++id, method, params };
  pending.set(msg.id, cb ?? (() => {}));
  ws.send(JSON.stringify(msg));
}

function step1() {
  // 直接在登录态页面里调魔方接口
  send("Runtime.evaluate", {
    expression: `fetch('/api/v1/users/magicube',{credentials:'include'}).then(r=>r.text()).then(t=>t.slice(0,500)).catch(e=>'ERR:'+e.message)`,
    awaitPromise: true,
    returnByValue: true,
  }, (r) => {
    console.log("=== 页面内 fetch /api/v1/users/magicube ===");
    console.log(r.result?.value ?? JSON.stringify(r).slice(0, 300));
    step2();
  });
}

function step2() {
  // 看看 localStorage 里有什么键（找登录凭证）
  send("Runtime.evaluate", {
    expression: `JSON.stringify(Object.keys(localStorage).map(k=>k+'='+String(localStorage.getItem(k)).length))`,
    returnByValue: true,
  }, (r) => {
    console.log("=== localStorage 键（名=长度） ===");
    console.log(r.result?.value ?? "none");
    step3();
  });
}

function step3() {
  // 重载页面，抓网站自己的 API 请求头（打码）
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Network.requestWillBeSent") {
      const u = m.params.request.url;
      if (u.includes("/api/v1/") && !u.includes("magicube")) return;
      const h = m.params.request.headers ?? {};
      const masked = Object.entries(h)
        .filter(([k]) => !/^(accept|content-type|user-agent|referer|origin|sec-|accept-|cache|pragma|connection|host|cookie-length)/i.test(k))
        .map(([k, v]) => `${k}: ${String(v).slice(0, 8)}…(len${String(v).length})`);
      reqs.push(`${m.params.request.method} ${u.replace("https://modelscope.cn", "")} [${masked.join(" | ")}]`);
    }
  });
  send("Page.enable");
  send("Page.reload");
  setTimeout(() => {
    console.log("=== 网站自身 API 请求（头已打码） ===");
    const uniq = [...new Set(reqs)];
    console.log(uniq.length ? uniq.slice(0, 12).join("\n") : "（没有抓到 api/v1 请求）");
    ws.close();
    process.exit(0);
  }, 12000);
}

function pending_cb() {}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const cb = pending.get(m.id);
    pending.delete(m.id);
    cb(m.result ?? m);
  }
};