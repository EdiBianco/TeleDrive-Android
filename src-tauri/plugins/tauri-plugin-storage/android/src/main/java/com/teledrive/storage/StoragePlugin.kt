package com.teledrive.storage

import android.Manifest
import android.app.Activity
import android.content.ContentUris
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import androidx.documentfile.provider.DocumentFile
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.io.FileInputStream
import java.nio.ByteBuffer

private const val EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents"

@InvokeArg
class PickArgs {
    var initial: String? = null
}

@InvokeArg
class MediaArgs {
    var kind: String? = null
}

@InvokeArg
class UriArgs {
    var uri: String? = null
}

@InvokeArg
class ChunkArgs {
    var uri: String? = null
    var offset: Long = 0
    var length: Int = 0
}

/**
 * Storage sources for device backup. Photos and videos come from MediaStore; any other
 * folder comes from the Storage Access Framework tree picker, which needs no broad storage permission.
 */
@TauriPlugin(
    permissions = [
        Permission(
            strings = [
                Manifest.permission.READ_MEDIA_IMAGES,
                Manifest.permission.READ_MEDIA_VIDEO,
                Manifest.permission.READ_EXTERNAL_STORAGE,
            ],
            alias = "media"
        )
    ]
)
class StoragePlugin(private val activity: Activity) : Plugin(activity) {

    @Command
    fun pickFolder(invoke: Invoke) {
        val args = invoke.parseArgs(PickArgs::class.java)
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            presetLocation(args.initial)?.let { putExtra(DocumentsContract.EXTRA_INITIAL_URI, it) }
        }
        startActivityForResult(invoke, intent, "pickFolderResult")
    }

    @ActivityCallback
    fun pickFolderResult(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.reject("No folder selected")
            return
        }
        try {
            activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (ex: SecurityException) {
            invoke.reject("Android did not grant persistent access to this folder")
            return
        }
        invoke.resolve(JSObject().apply { put("uri", uri.toString()) })
    }

    private fun presetLocation(name: String?): Uri? {
        val documentId = when (name) {
            "downloads" -> "primary:Download"
            "documents" -> "primary:Documents"
            else -> return null
        }
        return DocumentsContract.buildDocumentUri(EXTERNAL_STORAGE_AUTHORITY, documentId)
    }

    @Command
    fun listMedia(invoke: Invoke) {
        val kind = invoke.parseArgs(MediaArgs::class.java).kind ?: "images"
        if (!hasMediaAccess(kind)) {
            invoke.reject("Photo and video access is not allowed. Enable it in Android settings.")
            return
        }
        val collection = if (kind == "videos") {
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        } else {
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        }
        val columns = mutableListOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_MODIFIED,
        )
        val hasFolders = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
        if (hasFolders) columns.add(MediaStore.MediaColumns.RELATIVE_PATH)

        val entries = JSONArray()
        activity.contentResolver.query(collection, columns.toTypedArray(), null, null, null)?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
            val nameCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
            val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
            val dateCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED)
            val folderCol = if (hasFolders) cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.RELATIVE_PATH) else -1
            while (cursor.moveToNext()) {
                val name = cursor.getString(nameCol) ?: continue
                val folder = if (folderCol >= 0) cursor.getString(folderCol) ?: "" else ""
                entries.put(
                    JSONObject().apply {
                        put("uri", ContentUris.withAppendedId(collection, cursor.getLong(idCol)).toString())
                        put("relPath", folder + name)
                        put("size", cursor.getLong(sizeCol))
                        put("mtimeMs", cursor.getLong(dateCol) * 1000)
                    }
                )
            }
        }
        invoke.resolve(JSObject().apply { put("entries", entries) })
    }

    @Command
    fun listTree(invoke: Invoke) {
        val uri = invoke.parseArgs(UriArgs::class.java).uri
        if (uri == null) {
            invoke.reject("missing uri")
            return
        }
        val root = DocumentFile.fromTreeUri(activity, Uri.parse(uri))
        if (root == null || !root.isDirectory) {
            invoke.reject("This folder is no longer accessible. Add it again.")
            return
        }
        val entries = JSONArray()
        collectFiles(root, "", entries)
        invoke.resolve(JSObject().apply { put("entries", entries) })
    }

    private fun collectFiles(dir: DocumentFile, prefix: String, out: JSONArray) {
        for (child in dir.listFiles()) {
            val name = child.name ?: continue
            val relPath = prefix + name
            if (child.isDirectory) {
                collectFiles(child, "$relPath/", out)
            } else if (child.isFile) {
                out.put(
                    JSONObject().apply {
                        put("uri", child.uri.toString())
                        put("relPath", relPath)
                        put("size", child.length())
                        put("mtimeMs", child.lastModified())
                    }
                )
            }
        }
    }

    @Command
    fun readChunk(invoke: Invoke) {
        val args = invoke.parseArgs(ChunkArgs::class.java)
        val uri = args.uri
        if (uri == null || args.length <= 0) {
            invoke.reject("missing uri or length")
            return
        }
        val buffer = ByteBuffer.allocate(args.length)
        val descriptor = activity.contentResolver.openFileDescriptor(Uri.parse(uri), "r")
        if (descriptor == null) {
            invoke.reject("cannot open file")
            return
        }
        descriptor.use { pfd ->
            FileInputStream(pfd.fileDescriptor).channel.use { channel ->
                channel.position(args.offset)
                while (buffer.hasRemaining()) {
                    if (channel.read(buffer) <= 0) break
                }
            }
        }
        if (buffer.position() != args.length) {
            invoke.reject("short read: ${buffer.position()} of ${args.length} bytes")
            return
        }
        invoke.resolve(JSObject().apply { put("data", Base64.encodeToString(buffer.array(), Base64.NO_WRAP)) })
    }

    private fun hasMediaAccess(kind: String): Boolean {
        val permission = when {
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU -> Manifest.permission.READ_EXTERNAL_STORAGE
            kind == "videos" -> Manifest.permission.READ_MEDIA_VIDEO
            else -> Manifest.permission.READ_MEDIA_IMAGES
        }
        return ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED
    }
}
