package com.teledrive.apkupdate

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

private const val REPO = "EdiBianco/TeleDrive"
private const val APK_ASSET = "teledrive-android.apk"
private const val USER_AGENT = "TeleDrive-Android-Updater"
private const val UPDATES_DIR = "updates"

@InvokeArg
class DownloadArgs {
    var url: String? = null
    var sha256: String? = null
}

@InvokeArg
class PathArgs {
    var path: String? = null
}

/**
 * Checks GitHub for the newest release, downloads its APK into app cache with a SHA-256 check,
 * and opens Android's installer. Android always asks the user to confirm an install; nothing installs silently.
 */
@TauriPlugin
class ApkUpdatePlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        @Volatile var bytes: Long = 0
        @Volatile var total: Long = 0
        @Volatile var done: Boolean = false
    }

    private fun updatesDir(): File = File(activity.cacheDir, UPDATES_DIR).apply { mkdirs() }

    private fun open(url: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", USER_AGENT)
            connectTimeout = 15_000
            readTimeout = 30_000
        }

    @Command
    fun fetchLatest(invoke: Invoke) {
        Thread {
            try {
                val conn = open("https://api.github.com/repos/$REPO/releases/latest")
                conn.setRequestProperty("Accept", "application/vnd.github+json")
                if (conn.responseCode != 200) {
                    invoke.reject("GitHub returned HTTP ${conn.responseCode}")
                    return@Thread
                }
                val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
                val assets = json.getJSONArray("assets")
                var asset: JSONObject? = null
                for (i in 0 until assets.length()) {
                    val candidate = assets.getJSONObject(i)
                    if (candidate.getString("name") == APK_ASSET) asset = candidate
                }
                if (asset == null) {
                    invoke.reject("The latest release has no $APK_ASSET")
                    return@Thread
                }
                val result = JSObject()
                result.put("tag", json.getString("tag_name"))
                result.put("notes", json.optString("body", ""))
                result.put("url", asset.getString("browser_download_url"))
                result.put("size", asset.optLong("size", 0))
                // GitHub reports "sha256:<hex>" for each asset; empty means no checksum to verify against.
                result.put("sha256", asset.optString("digest", "").removePrefix("sha256:"))
                invoke.resolve(result)
            } catch (ex: Exception) {
                invoke.reject("Update check failed: ${ex.message}")
            }
        }.start()
    }

    @Command
    fun download(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadArgs::class.java)
        val url = args.url
        val expected = args.sha256?.lowercase() ?: ""
        if (url == null || !url.startsWith("https://")) {
            invoke.reject("Invalid download URL")
            return
        }
        if (expected.isEmpty()) {
            invoke.reject("This release has no checksum, so the download cannot be verified")
            return
        }
        Thread {
            val partial = File(updatesDir(), "$APK_ASSET.part")
            try {
                val conn = open(url)
                if (conn.responseCode !in 200..299) {
                    invoke.reject("Download failed: HTTP ${conn.responseCode}")
                    return@Thread
                }
                bytes = 0
                total = conn.contentLengthLong
                done = false
                val digest = MessageDigest.getInstance("SHA-256")
                conn.inputStream.use { input ->
                    partial.outputStream().use { out ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            out.write(buffer, 0, read)
                            digest.update(buffer, 0, read)
                            bytes += read
                        }
                    }
                }
                val actual = digest.digest().joinToString("") { "%02x".format(it) }
                if (actual != expected) {
                    partial.delete()
                    invoke.reject("Checksum mismatch. The download was discarded.")
                    return@Thread
                }
                val target = File(updatesDir(), APK_ASSET)
                if (target.exists()) target.delete()
                if (!partial.renameTo(target)) {
                    invoke.reject("Could not save the downloaded update")
                    return@Thread
                }
                done = true
                invoke.resolve(JSObject().apply { put("path", target.absolutePath) })
            } catch (ex: Exception) {
                partial.delete()
                invoke.reject("Download failed: ${ex.message}")
            }
        }.start()
    }

    @Command
    fun status(invoke: Invoke) {
        val result = JSObject()
        result.put("bytes", bytes)
        result.put("total", total)
        result.put("done", done)
        invoke.resolve(result)
    }

    @Command
    fun install(invoke: Invoke) {
        val path = invoke.parseArgs(PathArgs::class.java).path
        val file = path?.let { File(it) }
        val allowed = File(activity.cacheDir, UPDATES_DIR).canonicalPath
        if (file == null || !file.exists() || !file.canonicalPath.startsWith(allowed)) {
            invoke.reject("Downloaded update not found. Check for updates again.")
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            // Ask the user to allow installs from TeleDrive; they then tap Install again.
            val settings = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
            activity.startActivity(settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            invoke.resolve(JSObject().apply { put("needsPermission", true) })
            return
        }
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.apkupdate.fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(intent)
        invoke.resolve(JSObject().apply { put("needsPermission", false) })
    }
}
