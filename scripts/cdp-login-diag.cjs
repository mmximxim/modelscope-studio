// 诊断登录页 WebView：登录态、localStorage、同源 fetch 魔方接口
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
  const pages = targets.filter((x) => x.type === "page");
  console.log("targets:");
  pages.forEach((t) => console.log(" -", t.url.slice(0, 80)));
  const t = pages.find((x) => x.url.includes("modelscope.cn"));
  if (!t) { console.log("NO_MODELSCOPE_TARGET"); process.exit(1); }
  console.log("attaching:", t.url.slice(0, 80));

  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  function send(method, params = {}, cb) {
    const msg = { id: ++id, method, params };
    pending.set(msg.id, cb ?? (() => {}));
    ws.send(JSON.stringify(msg));
  }
  function evaluate(expr) {
    return new Promise((resolve) => {
      send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, backtraceRetry: false },
        (r) => resolve(r.result?.value ?? JSON.stringify(r).slice(0, 300)));
    });
  }

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const cb = pending.get(m.id);
      pending.delete(m.id);
      cb(m.result ?? m);
    }
  };

  await new Promise((r) => (ws.onopen = r));

  console.log("=== location ===");
  console.log(await evaluate("location.href"));

  console.log("=== 同源 fetch magicube ===");
  console.log(await evaluate(
    `fetch('/api/v1/users/magicube',{credentials:'include'}).then(r=>r.text()).then(t=>t.slice(0,300)).catch(e=>'ERR:'+e.message)`));

  console.log("=== document.cookie（HttpOnly 不可见） ===");
  console.log((await evaluate("document.cookie.slice(0,200)")) || "(空)");

  console.log("=== localStorage 全部键值（值截断 60） ===");
  console.log(await evaluate(
    `JSON.stringify(Object.fromEntries(Object.entries(localStorage).map(([k,v])=>[k,String(v).slice(0,60)])))`));

  console.log("=== 页面里的用户名线索 ===");
  console.log(await evaluate(
    `(document.body.innerText.match(/魔搭|ModelScope|登录|注册|退出/g)||[]).slice(0,5).join(',')`));

  ws.close();
  process.exit(0);
})();
