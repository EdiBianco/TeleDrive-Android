package com.teledrive.fileshare

import androidx.core.content.FileProvider

/** Own FileProvider subclass so it does not clash with the app's or the updater's providers. */
class FileShareFileProvider : FileProvider()
