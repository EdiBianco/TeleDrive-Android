package com.teledrive.keystore

import android.app.Activity
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val KEY_ALIAS = "teledrive_vault_v1"
private const val ANDROID_KEYSTORE = "AndroidKeyStore"
private const val TRANSFORMATION = "AES/GCM/NoPadding"
private const val GCM_TAG_BITS = 128
private const val IV_BYTES = 12

@InvokeArg
class TextArgs {
    var data: String? = null
}

/**
 * AES-256-GCM with a key that lives in Android Keystore and cannot be exported.
 * Only the app's own process can use it; a copied vault file is useless without it.
 */
@TauriPlugin
class KeystorePlugin(private val activity: Activity) : Plugin(activity) {

    private fun vaultKey(): SecretKey {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    @Command
    fun seal(invoke: Invoke) {
        val text = invoke.parseArgs(TextArgs::class.java).data
        if (text == null) {
            invoke.reject("missing data")
            return
        }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, vaultKey())
        val sealed = cipher.doFinal(text.toByteArray(Charsets.UTF_8))
        val out = JSObject()
        out.put("data", Base64.encodeToString(cipher.iv + sealed, Base64.NO_WRAP))
        invoke.resolve(out)
    }

    @Command
    fun unseal(invoke: Invoke) {
        val blob = invoke.parseArgs(TextArgs::class.java).data
        if (blob == null) {
            invoke.reject("missing data")
            return
        }
        val bytes = Base64.decode(blob, Base64.NO_WRAP)
        if (bytes.size <= IV_BYTES + GCM_TAG_BITS / 8) {
            invoke.reject("sealed value too short")
            return
        }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            vaultKey(),
            GCMParameterSpec(GCM_TAG_BITS, bytes.copyOfRange(0, IV_BYTES))
        )
        val plain = cipher.doFinal(bytes.copyOfRange(IV_BYTES, bytes.size))
        val out = JSObject()
        out.put("data", String(plain, Charsets.UTF_8))
        invoke.resolve(out)
    }
}
