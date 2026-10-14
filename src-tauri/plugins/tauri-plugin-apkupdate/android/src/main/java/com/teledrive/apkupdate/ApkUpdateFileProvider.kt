package com.teledrive.apkupdate

import androidx.core.content.FileProvider

/**
 * Separate FileProvider subclass so the app's own androidx FileProvider entry does not
 * conflict with this plugin's entry during manifest merge.
 */
class ApkUpdateFileProvider : FileProvider()
