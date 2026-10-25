package com.mou.imagestudio;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;

public class MainActivity extends Activity {

    public static android.content.res.AssetManager ASSETS;
    private static final int PORT = 8123;
    private static final int FILE_CHOOSER_REQUEST = 10001;
    private WebView webView;
    private AssetWebServer server;
    private final ApiHandler api = new ApiHandler();
    private MagicubeFetcher magicubeFetcher;
    private ValueCallback<Uri[]> fileCallback;

    @SuppressLint("SetJavaScriptEnabled")
    /** JS 桥：必须是 public 静态类，匿名包私有类的方法调用会被反射静默吞掉 */
    public static class JsBridge {
        private final MainActivity activity;

        JsBridge(MainActivity activity) {
            this.activity = activity;
        }

        @android.webkit.JavascriptInterface
        public void openLogin() {
            activity.runOnUiThread(() -> activity.startActivity(
                    new Intent(activity, LoginActivity.class)));
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ASSETS = getAssets();

        File dataDir = new File(getFilesDir(), "data");
        File webRoot = new File(getCacheDir(), "web");
        try {
            AssetExtractor.extract(this, "web", webRoot);
            api.init(dataDir);
        } catch (Exception e) {
            throw new RuntimeException("初始化失败", e);
        }

        server = new AssetWebServer(webRoot, api);
        try {
            server.start(PORT);
        } catch (Exception e) {
            throw new RuntimeException("本地服务启动失败", e);
        }

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(0xFF0A0908);
        WebSettingsCompat.configure(webView);
        CookieManager.getInstance().setAcceptCookie(true);

        webView.addJavascriptInterface(new JsBridge(this), "MStudio");
        magicubeFetcher = new MagicubeFetcher(this);
        api.setMagicubeFetcher(magicubeFetcher);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                // 首帧前保持黑底，避免白屏闪烁
            }
        });

        setContentView(webView);
        webView.loadUrl("http://127.0.0.1:" + PORT + "/");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    results = new Uri[n];
                    for (int i = 0; i < n; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(results);
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        // 先问页面有没有弹层要关（MStudioBack 返回 "true" 表示页面已处理）；
        // 页面没有弹层时：WebView 能后退则后退，否则走系统默认（回桌面/退出）
        if (webView != null) {
            webView.evaluateJavascript(
                    "window.MStudioBack ? window.MStudioBack() : 'false'",
                    value -> {
                        if (!"\"true\"".equals(value)) {
                            runOnUiThread(() -> {
                                if (webView != null && webView.canGoBack()) {
                                    webView.goBack();
                                } else {
                                    finish();
                                }
                            });
                        }
                    });
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (server != null) {
            server.stop();
        }
        super.onDestroy();
    }
}
