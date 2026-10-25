package com.mou.imagestudio;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 隐藏的 1x1 WebView，以 modelscope.cn 为源做同源 fetch 查询魔方余额。
 * 阿里云 WAF 会拦截服务端 Java 客户端的带凭证请求，但 WebView 内的浏览器环境能正常通过，
 * 所以查询必须在这里执行。Cookie 与登录用的 LoginActivity 共享同一个 CookieManager。
 */
public final class MagicubeFetcher {

    private final Activity activity;
    private WebView hidden;
    private volatile boolean ready = false;
    private volatile String lastResult;

    public MagicubeFetcher(Activity activity) {
        this.activity = activity;
        // 便于通过 chrome://inspect 抓取网站真实请求头
        WebView.setWebContentsDebuggingEnabled(true);
    }

    /** 在 UI 线程创建隐藏 WebView 并加载真实魔搭首页（只需一次，页面 JS 环境是查询成功的前提） */
    public synchronized void ensureReady() {
        if (hidden != null && ready) return;
        final CountDownLatch loaded = new CountDownLatch(1);
        activity.runOnUiThread(() -> {
            try {
                hidden = new WebView(activity);
                hidden.setLayoutParams(new ViewGroup.LayoutParams(1, 1));
                hidden.setBackgroundColor(Color.TRANSPARENT);
                hidden.getSettings().setJavaScriptEnabled(true);
                hidden.getSettings().setDomStorageEnabled(true);
                CookieManager.getInstance().setAcceptCookie(true);
                hidden.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        ready = true;
                        loaded.countDown();
                    }
                });
                activity.addContentView(hidden, new ViewGroup.LayoutParams(1, 1));
                hidden.loadUrl("https://modelscope.cn/");
            } catch (Exception e) {
                loaded.countDown();
            }
        });
        try {
            loaded.await(30, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
        }
    }

    /** 同源 fetch 魔粒余额（新 /openapi 网关），返回原始 JSON 文本；失败返回 null */
    public synchronized String fetchMagicubeJson() {
        ensureReady();
        if (hidden == null || !ready) return null;
        lastResult = null;
        final CountDownLatch done = new CountDownLatch(1);
        activity.runOnUiThread(() -> hidden.evaluateJavascript(
                "fetch('/openapi/v1/magicubes/balance',{credentials:'include'})"
                        + ".then(function(r){return r.text()})"
                        + ".catch(function(e){return ''})",
                value -> {
                    lastResult = unquote(value);
                    done.countDown();
                }));
        try {
            done.await(15, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
        }
        return lastResult;
    }

    /** evaluateJavascript 的返回值是 JSON 编码的字符串，去掉外层引号并反转义 */
    private static String unquote(String value) {
        if (value == null || value.length() < 2) return "";
        if (value.startsWith("\"") && value.endsWith("\"")) {
            String s = value.substring(1, value.length() - 1);
            s = s.replace("\\\"", "\"").replace("\\\\", "\\")
                    .replace("\\n", "\n").replace("\\r", "\r").replace("\\/", "/");
            return s;
        }
        return value;
    }
}
