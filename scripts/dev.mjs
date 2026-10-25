import { spawn } from "node:child_process";

const isWin = process.platform === "win32";

const server = spawn(process.execPath, ["--watch", "server/index.ts"], {
  stdio: "inherit",
  env: process.env,
});

const vite = spawn(isWin ? "npm.cmd" : "npm", ["run", "dev:web"], {
  stdio: "inherit",
  shell: isWin,
  env: process.env,
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.kill();
  vite.kill();
  setTimeout(() => process.exit(0), 300);
}

server.on("exit", (code) => {
  if (!closing && code !== 0) shutdown();
});
vite.on("exit", (code) => {
  if (!closing && code !== 0) shutdown();
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
