// 用法: node cdp-dom-probe2.cjs <url关键字> [正则]
const http = require("http");
const urlKey = process.argv[2] || "/home";
const pattern = process.argv[3] || "魔方|余额|积分|Magicube";

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
  const t = targets.find((x) => x.type === "page" && x.url.includes(urlKey));
  if (!t) { console.log("NO_TARGET for", urlKey); process.exit(1); }
  console.log("attach:", t.url.slice(0, 70));
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
      send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true },
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

  const probe = `
    (function(){
      var hits = [];
      var re = new RegExp(${JSON.stringify(pattern)});
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      var n;
      while ((n = walker.nextNode())) {
        var t = n.textContent;
        if (re.test(t)) {
          var el = n.parentElement;
          hits.push(t.trim().slice(0,120) + '  <' + (el ? el.tagName + ' cls=' + String(el.className).slice(0,60) : '?') + '>');
        }
      }
      return hits.length ? hits.join('\\n---\\n') : 'NOT_FOUND_IN_TEXT';
    })()
  `;
  console.log(await evaluate(probe));
  ws.close();
  process.exit(0);
})();
