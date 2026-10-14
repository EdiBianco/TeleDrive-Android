package com.teledrive.keepalive

import android.app.Activity
import android.content.Intent
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@TauriPlugin
class KeepAlivePlugin(private val activity: Activity) : Plugin(activity) {

    /** Must be called while the app is in the foreground (Android 12+ restriction). */
    @Command
    fun start(invoke: Invoke) {
        try {
            ContextCompat.startForegroundService(activity, Intent(activity, BackupKeepAliveService::class.java))
            invoke.resolve()
        } catch (ex: Exception) {
            invoke.reject("keep-alive start failed: ${ex.message}")
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        activity.stopService(Intent(activity, BackupKeepAliveService::class.java))
        invoke.resolve()
    }
}
