package com.mou.imagestudio;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/** 把 assets/web 解压到磁盘，供本地 HTTP 服务直接读文件（带版本号缓存） */
final class AssetExtractor {

    private static final String VERSION_FILE = ".version";

    private AssetExtractor() {
    }

    static void extract(Context context, String assetDir, File targetDir) throws IOException {
        String version = readVersion(context, assetDir);
        File marker = new File(targetDir, VERSION_FILE);
        if (marker.exists() && version.equals(new String(readFile(marker), "UTF-8").trim())) {
            return;
        }
        deleteRecursive(targetDir);
        copyDir(context.getAssets(), assetDir, targetDir);
        marker.getParentFile().mkdirs();
        write(marker, version);
    }

    private static String readVersion(Context context, String assetDir) throws IOException {
        // 构建时由任务写入 web.version；缺失则每次覆盖
        try (InputStream in = context.getAssets().open(assetDir + "/.version")) {
            java.util.Scanner sc = new java.util.Scanner(in, "UTF-8");
            return sc.hasNext() ? sc.next() : String.valueOf(System.currentTimeMillis());
        } catch (IOException e) {
            return String.valueOf(System.currentTimeMillis());
        }
    }

    private static void copyDir(android.content.res.AssetManager assets, String from, File to)
            throws IOException {
        String[] entries = assets.list(from);
        if (entries == null || entries.length == 0) {
            copyFile(assets, from, to);
            return;
        }
        to.mkdirs();
        for (String name : entries) {
            copyDir(assets, from + "/" + name, new File(to, name));
        }
    }

    private static void copyFile(android.content.res.AssetManager assets, String from, File to)
            throws IOException {
        to.getParentFile().mkdirs();
        try (InputStream in = assets.open(from); OutputStream out = new FileOutputStream(to)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
        }
    }

    private static void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        File[] children = f.listFiles();
        if (children != null) {
            for (File c : children) deleteRecursive(c);
        }
        f.delete();
    }

    private static byte[] readFile(File f) throws IOException {
        try (InputStream in = new java.io.FileInputStream(f)) {
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toByteArray();
        }
    }

    private static void write(File f, String content) throws IOException {
        try (OutputStream out = new FileOutputStream(f)) {
            out.write(content.getBytes("UTF-8"));
        }
    }
}
