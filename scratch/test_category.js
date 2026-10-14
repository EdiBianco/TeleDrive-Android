function getFileExtension(fileName) {
  const parts = (fileName || "").split(".");
  if (parts.length <= 1) return "";
  return parts.pop().toLowerCase().trim();
}

function getFileCategory(fileName, mime) {
  const m = (mime || "").toLowerCase().trim();
  const ext = getFileExtension(fileName);

  if (m === "inode/directory" || m === "application/x-directory") {
    return "Other";
  }

  if (
    m.startsWith("image/") ||
    ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "tiff", "tif", "heic", "heif", "ico", "psd", "ai"].includes(ext)
  ) {
    return "Images";
  }

  if (
    m.startsWith("video/") ||
    ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "3gp", "mpeg", "mpg"].includes(ext)
  ) {
    return "Videos";
  }

  if (
    m.startsWith("audio/") ||
    ["mp3", "wav", "ogg", "m4a", "flac", "aac", "wma", "opus", "amr", "mpga"].includes(ext)
  ) {
    return "Audio";
  }

  if (
    m.includes("zip") ||
    m.includes("tar") ||
    m.includes("rar") ||
    m.includes("gzip") ||
    m.includes("archive") ||
    m.includes("compressed") ||
    ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zipx", "iso", "dmg"].includes(ext)
  ) {
    return "Archives";
  }

  if (
    m.startsWith("text/") ||
    m.includes("document") ||
    m.includes("msword") ||
    m.includes("pdf") ||
    m.includes("spreadsheet") ||
    m.includes("excel") ||
    m.includes("presentation") ||
    m.includes("powerpoint") ||
    m.includes("json") ||
    m.includes("javascript") ||
    m.includes("xml") ||
    [
      "txt", "md", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", 
      "rtf", "odt", "ods", "odp", "epub", "pages", "numbers", "key",
      "js", "ts", "jsx", "tsx", "html", "css", "json", "xml", "yaml", "yml",
      "py", "go", "c", "cpp", "h", "cs", "java", "rb", "rs", "sh", "bat", "ps1", "sql", "ini", "conf"
    ].includes(ext)
  ) {
    return "Documents";
  }

  return "Other";
}

console.log("expresspro-prompt-playbook.md:", getFileCategory("expresspro-prompt-playbook.md", "application/octet-stream"));
console.log("README.MD:", getFileCategory("README.MD", "application/octet-stream"));
console.log("README.md (uppercase MIME):", getFileCategory("README.md", "APPLICATION/OCTET-STREAM"));
console.log("File without extension:", getFileCategory("README", "text/markdown"));
console.log("Folder type:", getFileCategory("high", "inode/directory"));
