package com.teledrive.fileshare

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

private const val STAGING_DIR = "shared"

@InvokeArg
class FileArgs {
    var path: String? = null
    var mime: String? = null
}

/**
 * Opens or shares a file that TeleDrive has staged in its cache folder. Only paths inside
 * that folder are accepted, so the webview cannot point these intents at other files.
 */
@TauriPlugin
class FileSharePlugin(private val activity: Activity) : Plugin(activity) {

    private fun stagedFile(path: String?): File? {
        if (path == null) return null
        val root = File(activity.cacheDir, STAGING_DIR).canonicalPath + File.separator
        val file = File(path).canonicalFile
        return if (file.path.startsWith(root) && file.isFile) file else null
    }

    private fun uriFor(file: File) =
        FileProvider.getUriForFile(activity, "${activity.packageName}.fileshare.fileprovider", file)

    @Command
    fun open(invoke: Invoke) {
        val args = invoke.parseArgs(FileArgs::class.java)
        val file = stagedFile(args.path)
        if (file == null) {
            invoke.reject("File is not available. Try again.")
            return
        }
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uriFor(file), args.mime ?: "*/*")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            activity.startActivity(intent)
            invoke.resolve()
        } catch (ex: ActivityNotFoundException) {
            invoke.reject("No app on this phone can open this file type.")
        }
    }

    @Command
    fun share(invoke: Invoke) {
        val args = invoke.parseArgs(FileArgs::class.java)
        val file = stagedFile(args.path)
        if (file == null) {
            invoke.reject("File is not available. Try again.")
            return
        }
        val send = Intent(Intent.ACTION_SEND)
            .setType(args.mime ?: "*/*")
            .putExtra(Intent.EXTRA_STREAM, uriFor(file))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        activity.startActivity(Intent.createChooser(send, file.name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        invoke.resolve(JSObject())
    }
}
