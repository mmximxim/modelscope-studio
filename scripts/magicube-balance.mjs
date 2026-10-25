#!/usr/bin/env node
/**
 * 魔搭（ModelScope）魔方/魔粒余额查询 — 服务端直连版
 *
 * 接口: GET https://modelscope.cn/openapi/v1/magicubes/balance
 * 鉴权: 网页登录 Cookie（浏览器 F12 → Network → 任意 modelscope.cn 请求 → 复制完整 Cookie 头）
 *
 * 用法:
 *   MAGICSCOPE_COOKIE='cna=...; login_uyt=...' node magicube-balance.mjs
 *   node magiccube-balance.mjs --cookie "cna=...; ..."
 *
 * 已匿名验证: 网关可达（Node undici / curl 均无 TLS 指纹拦截），无 Cookie 时返回
 *   401 {"success":false,"code":"InvalidAuthentication","message":"authentication required"}
 * 预期成功结构（字段名来自官方前端解构代码）:
 *   { "success": true, "data": { "total_balance": 200, "available_balance": 150 }, "request_id": "..." }
 */

const BASE = 'https://modelscope.cn/openapi/v1/magicubes';

function getCookieArg() {
  const i = process.argv.indexOf('--cookie');
  if (i > -1 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.MAGICSCOPE_COOKIE || '';
}

const cookie = getCookieArg();
if (!cookie) {
  console.error('未提供 Cookie。用法: MAGICSCOPE_COOKIE="..." node magicube-balance.mjs');
  process.exit(1);
}

const headers = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'application/json',
  Cookie: cookie,
  'X-ModelScope-Accept-Language': 'zh-CN',
  // 仅追踪用，可省略；网关会把它回显为 request_id
  'X-ModelScope-Trace-Id': crypto.randomUUID(),
};

const api = async (path) => {
  const r = await fetch(BASE + path, { headers });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  return { status: r.status, json };
};

const show = (label, { status, json }) => {
  console.log(`\n== ${label}  [HTTP ${status}]`);
  console.log(JSON.stringify(json.json ?? json, null, 2).slice(0, 1500));
};

// 1) 余额
show('balance', await api('/balance'));

// 2) 流水（可选）: type 取值 earn（发放）; 消耗统计 tab 对应的 type 码未实测，可试 'spend'
show('transactions(type=earn)', await api('/transactions?type=earn&page=1&page_size=20'));

// 3) 赚魔粒规则（可选）
show('earn/rules', await api('/earn/rules'));

// 4) 消耗费率表（可选，即文档里的 API-Inference 成本表）
show('spend/rates', await api('/spend/rates'));
