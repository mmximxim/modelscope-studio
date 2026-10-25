package com.mou.imagestudio;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

/**
 * 极简本地 HTTP 服务：
 * - 静态文件：直接读解压出来的网页资源
 * - /api/*：转发到手机上运行的 Node 服务（127.0.0.1:8124）
 */
final class AssetWebServer {

    private static final String MIME_DEFAULT = "application/octet-stream";

    private final File webRoot;
    private final ApiHandler api;
    private ServerSocket serverSocket;
    private java.util.concurrent.ExecutorService pool;

    AssetWebServer(File webRoot, ApiHandler api) {
        this.webRoot = webRoot;
        this.api = api;
    }

    void start(int port) throws IOException {
        serverSocket = new ServerSocket(port, 64, InetAddress.getByName("127.0.0.1"));
        pool = Executors.newFixedThreadPool(4);
        Thread acceptor = new Thread(() -> {
            while (!serverSocket.isClosed()) {
                try {
                    Socket socket = serverSocket.accept();
                    pool.execute(() -> handle(socket));
                } catch (IOException e) {
                    if (!serverSocket.isClosed()) {
                        try { Thread.sleep(50); } catch (InterruptedException ignored) { return; }
                    }
                }
            }
        }, "webserver-accept");
        acceptor.setDaemon(true);
        acceptor.start();
    }

    void stop() {
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
        if (pool != null) pool.shutdownNow();
    }

    private void handle(Socket socket) {
        try {
            socket.setSoTimeout(120000);
            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(socket.getInputStream(), StandardCharsets.ISO_8859_1));
            String requestLine = reader.readLine();
            if (requestLine == null) {
                socket.close();
                return;
            }
            String[] parts = requestLine.split(" ");
            String method = parts[0];
            String rawPath = parts.length > 1 ? parts[1] : "/";
            String path = URLDecoder.decode(rawPath, "UTF-8");
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            String header;
            long contentLength = 0;
            while ((header = reader.readLine()) != null && !header.isEmpty()) {
                String lower = header.toLowerCase();
                if (lower.startsWith("content-length:")) {
                    contentLength = Long.parseLong(header.substring(15).trim());
                }
            }

            if (path.startsWith("/api/")) {
                handleApi(method, path, reader, socket, contentLength);
            } else if (path.startsWith("/files/")) {
                serveFile(path, socket);
            } else if (method.equals("GET") || method.equals("HEAD")) {
                serveStatic(path, socket);
            } else {
                respond(socket, 405, "text/plain", "Method Not Allowed");
            }
        } catch (Exception e) {
            // 客户端中断等噪声忽略
        } finally {
            try { socket.close(); } catch (IOException ignored) {}
        }
    }

    /** API 请求：读出 body 后交给 ApiHandler，返回 JSON */
    private void handleApi(String method, String path, BufferedReader reader, Socket socket,
                           long contentLength) throws IOException {
        if (contentLength > 32L * 1024 * 1024) {
            respond(socket, 413, "application/json", "{\"ok\":false,\"error\":\"请求体过大\"}");
            return;
        }
        byte[] body = new byte[0];
        if (contentLength > 0) {
            char[] buf = new char[(int) contentLength];
            int read = 0;
            while (read < buf.length) {
                int n = reader.read(buf, read, buf.length - read);
                if (n < 0) break;
                read += n;
            }
            // reader 按 ISO_8859_1 解码，每个 char 恰好等于原始字节值，
            // 因此必须用 ISO_8859_1 编回字节；用 UTF_8 会把 >0x7F 的字节双重编码
            body = new String(buf, 0, read).getBytes(StandardCharsets.ISO_8859_1);
        }
        int[] status = {200};
        byte[] response = api.handle(method, path, body, status);
        StringBuilder headers = new StringBuilder();
        headers.append("HTTP/1.1 ").append(status[0]).append(" X\r\n");
        headers.append("Content-Type: application/json; charset=utf-8\r\n");
        headers.append("Cache-Control: no-store\r\n");
        headers.append("Content-Length: ").append(response.length).append("\r\n");
        headers.append("Connection: close\r\n\r\n");
        OutputStream out = socket.getOutputStream();
        out.write(headers.toString().getBytes(StandardCharsets.ISO_8859_1));
        out.write(response);
        out.flush();
    }

    /** 生成结果图片：data/images 下的文件，带 ETag 缓存 */
    private void serveFile(String path, Socket socket) throws IOException {
        String name = path.replace('\\', '/');
        name = name.substring("/files/".length());
        if (name.isEmpty() || name.contains("/") || name.contains("..")) {
            respond(socket, 404, "text/plain", "Not Found");
            return;
        }
        File file = new File(api.imagesDir(), name);
        if (!file.exists() || !file.isFile()) {
            respond(socket, 404, "text/plain", "Not Found");
            return;
        }
        long len = file.length();
        String etag = "\"" + len + "-" + file.lastModified() + "\"";
        StringBuilder headers = new StringBuilder();
        headers.append("HTTP/1.1 200 OK\r\n");
        headers.append("Content-Type: ").append(contentType(file.getName())).append("\r\n");
        headers.append("Content-Length: ").append(len).append("\r\n");
        headers.append("Cache-Control: private, max-age=31536000, immutable\r\n");
        headers.append("ETag: ").append(etag).append("\r\n");
        headers.append("Connection: close\r\n\r\n");
        OutputStream out = socket.getOutputStream();
        out.write(headers.toString().getBytes(StandardCharsets.ISO_8859_1));
        try (InputStream in = new FileInputStream(file)) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        out.flush();
    }

    private void serveStatic(String path, Socket socket) throws IOException {
        if (path.equals("/")) path = "/index.html";
        String clean = path.replace('\\', '/');
        while (clean.startsWith("/")) clean = clean.substring(1);
        File file = new File(webRoot, clean).getCanonicalFile();
        if (!file.getPath().startsWith(webRoot.getCanonicalPath())) {
            respond(socket, 403, "text/plain", "Forbidden");
            return;
        }
        if (!file.exists() || file.isDirectory()) {
            File index = new File(webRoot, "index.html");
            if (clean.contains(".") ) {
                respond(socket, 404, "text/plain", "Not Found");
                return;
            }
            file = index;
        }
        String type = contentType(file.getName());
        long len = file.length();
        StringBuilder headers = new StringBuilder();
        headers.append("HTTP/1.1 200 OK\r\n");
        headers.append("Content-Type: ").append(type).append("\r\n");
        headers.append("Content-Length: ").append(len).append("\r\n");
        boolean immutable = clean.startsWith("assets/");
        headers.append("Cache-Control: ")
               .append(immutable ? "public, max-age=31536000, immutable" : "no-cache")
               .append("\r\n");
        headers.append("Connection: close\r\n\r\n");
        OutputStream out = socket.getOutputStream();
        out.write(headers.toString().getBytes(StandardCharsets.ISO_8859_1));
        try (InputStream in = new FileInputStream(file)) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
        }
        out.flush();
    }

    private void respond(Socket socket, int code, String type, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        StringBuilder headers = new StringBuilder();
        headers.append("HTTP/1.1 ").append(code).append(" X\r\n");
        headers.append("Content-Type: ").append(type).append("; charset=utf-8\r\n");
        headers.append("Content-Length: ").append(bytes.length).append("\r\n");
        headers.append("Connection: close\r\n\r\n");
        OutputStream out = socket.getOutputStream();
        out.write(headers.toString().getBytes(StandardCharsets.ISO_8859_1));
        out.write(bytes);
        out.flush();
    }

    private static String contentType(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".html")) return "text/html; charset=utf-8";
        if (n.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (n.endsWith(".css")) return "text/css; charset=utf-8";
        if (n.endsWith(".json") || n.endsWith(".webmanifest")) return "application/json; charset=utf-8";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".ico")) return "image/x-icon";
        if (n.endsWith(".woff2")) return "font/woff2";
        return MIME_DEFAULT;
    }
}
