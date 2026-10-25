package com.mou.imagestudio;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 网页版登录魔搭：登录成功后自动捕获 Cookie 交给本地服务，
 * 用于查询网站域的魔方余额（推理令牌访问不了网站域）。
 */
public class LoginActivity extends Activity {

    private WebView webView;
    private TextView statusView;
    private boolean saved = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0A0908"));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(40, 30, 40, 30);

        statusView = new TextView(this);
        statusView.setText("在页面里登录魔搭，成功后会自动保存并返回");
        statusView.setTextColor(Color.parseColor("#C9BFB2"));
        statusView.setTextSize(13);
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);

        Button done = new Button(this);
        done.setText("完成");
        done.setTextSize(13);
        done.setOnClickListener(v -> saveAndClose(""));
        LinearLayout.LayoutParams doneParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        doneParams.leftMargin = 20;

        bar.addView(statusView, statusParams);
        bar.addView(done, doneParams);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0A0908"));
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        // 桌面版 UA：魔搭给手机端只出短信/密码登录，桌面版才有全部第三方登录方式
        webView.getSettings().setUserAgentString(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36");
        webView.getSettings().setUseWideViewPort(true);
        webView.getSettings().setLoadWithOverviewMode(true);
        webView.getSettings().setSupportZoom(true);
        webView.getSettings().setBuiltInZoomControls(true);
        webView.getSettings().setDisplayZoomControls(false);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                checkLogin();
            }
        });

        root.addView(bar, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        webView.loadUrl("https://modelscope.cn/login");
    }

    /** 登录页每次加载完都试一次：同源 fetch 魔粒余额，成功则把响应体一并交给本地服务保存 */
    private void checkLogin() {
        if (saved || webView == null) return;
        webView.evaluateJavascript(
                "fetch('/openapi/v1/magicubes/balance',{credentials:'include'})"
                        + ".then(function(r){return r.text()})"
                        + ".then(function(t){return JSON.stringify({ok:t.indexOf('\"success\":true')>=0,body:t})})"
                        + ".catch(function(e){return JSON.stringify({ok:false,body:''})})",
                value -> {
                    try {
                        org.json.JSONObject r = new org.json.JSONObject(unquote(value));
                        if (r.optBoolean("ok")) {
                            statusView.setText("登录成功，正在保存…");
                            saveAndClose(r.optString("body", ""));
                        }
                    } catch (Exception ignored) {
                    }
                });
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

    private void saveAndClose(String magicubeData) {
        if (saved) return;
        // 会话 Cookie 可能落在 modelscope.cn 或 www.modelscope.cn（登录后跳转决定），两个域都存
        String ckMain = CookieManager.getInstance().getCookie("https://modelscope.cn/");
        String ckWww = CookieManager.getInstance().getCookie("https://www.modelscope.cn/");
        if ((ckMain == null || ckMain.isEmpty()) && (ckWww == null || ckWww.isEmpty())) {
            Toast.makeText(this, "还没有可用的登录信息", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        saved = true;
        final String payload;
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("cookie", ckMain != null && !ckMain.isEmpty() ? ckMain : ckWww);
            if (ckMain != null && !ckMain.isEmpty()) o.put("ms", ckMain);
            if (ckWww != null && !ckWww.isEmpty()) o.put("www", ckWww);
            if (magicubeData != null && !magicubeData.isEmpty()) o.put("magicubeData", magicubeData);
            payload = o.toString();
        } catch (Exception e) {
            finish();
            return;
        }
        new Thread(() -> {
            boolean ok = false;
            try {
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection)
                        new java.net.URL("http://127.0.0.1:8123/api/config/cookie").openConnection();
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.getOutputStream().write(payload.getBytes("UTF-8"));
                ok = conn.getResponseCode() == 200;
                conn.disconnect();
            } catch (Exception ignored) {
            }
            final boolean success = ok;
            runOnUiThread(() -> {
                Toast.makeText(this, success ? "登录信息已保存" : "保存失败，请重试", Toast.LENGTH_SHORT).show();
                finish();
            });
        }).start();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            finish();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
