// 抓 my/overview 页面自己发出的 /api/v1 请求头（值打码）与响应状态
const fs = require("fs");
const http = require("http");
function getTargets() {
  return new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9222/json", (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(JSON.parse(d)));
    }).on("error", reject);
  });
}

(async () => {
  const targets = await getTargets();
  const t = targets.find((x) => x.type === "page" && x.url.includes("my/overview"))
    ?? targets.find((x) => x.type === "page" && x.url.includes("modelscope.cn"));
  if (!t) { console.log("NO_TARGET"); process.exit(1); }
  console.log("attach:", t.url.slice(0, 70));

  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  function send(method, params = {}, cb) {
    const msg = { id: ++id, method, params };
    pending.set(msg.id, cb ?? (() => {}));
    ws.send(JSON.stringify(msg));
  }
  const apiCalls = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Network.requestWillBeSent") {
      const u = m.params.request.url;
      if (!u.includes("/api/v1/")) return;
      const h = m.params.request.headers ?? {};
      const interesting = Object.entries(h)
        .filter(([k]) => /^(authorization|x-|m-|csrf|token)/i.test(k))
        .map(([k, v]) => `${k}: ${String(v).slice(0, 10)}…(len${String(v).length})`);
      apiCalls.push(`REQ ${m.params.request.method} ${u.replace("https://modelscope.cn", "")} cookies:${(h.Cookie ?? h.cookie ?? "").length}ch ${interesting.join(" | ")}`);
    }
    if (m.method === "Network.responseReceived") {
      const u = m.params.response.url;
      if (!u.includes("/api/v1/")) return;
      apiCalls.push(`  RES ${m.params.response.status} ${u.replace("https://modelscope.cn", "")}`);
    }
    if (m.id && pending.has(m.id)) {
      const cb = pending.get(m.id);
      pending.delete(m.id);
      cb(m.result ?? m);
    }
  };

  await new Promise((r) => (ws.onopen = r));
  send("Network.enable");
  send("Page.enable");
  send("Page.reload");
  setTimeout(() => {
    console.log(apiCalls.length ? apiCalls.slice(0, 30).join("\n") : "（没有捕获到 /api/v1 请求）");
    ws.close();
    process.exit(0);
  }, 30000);
})();
