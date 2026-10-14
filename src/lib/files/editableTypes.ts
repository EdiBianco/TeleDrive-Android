import { TeleFile } from "@/lib/types";

/**
 * Returns true if the file is a text or code file that can be edited
 * in-app via the TeleDrive file editor.
 *
 * Binary files (images, audio, video, PDFs, archives) return false.
 */
export function isEditableFile(file: TeleFile): boolean {
  const mime = file.mime.toLowerCase();
  const name = file.name.toLowerCase();

  // Directories are never editable
  if (mime === "inode/directory" || mime === "application/x-directory") {
    return false;
  }

  // MIME-type based detection
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/sql" ||
    mime === "application/x-sh" ||
    mime === "application/x-bat" ||
    mime === "application/x-powershell" ||
    mime.includes("javascript") ||
    mime.includes("typescript") ||
    mime.includes("yaml") ||
    mime.includes("toml") ||
    mime.includes("x-python") ||
    mime.includes("x-go") ||
    mime.includes("x-rust") ||
    mime.includes("x-c") ||
    mime.includes("x-java") ||
    mime.includes("x-ruby") ||
    mime.includes("x-php") ||
    mime.includes("x-csharp")
  ) {
    return true;
  }

  // Extension-based fallback for files that may report generic MIME
  const baseName = name.split("/").pop() ?? name;
  const noExtNames = new Set([
    "dockerfile", "makefile", "procfile", "gemfile", "vagrantfile",
    "license", "readme", "caddyfile", "jenkinsfile", "containerfile",
    ".gitignore", ".gitattributes", ".gitmodules", ".npmrc", ".nvmrc",
    ".editorconfig", ".bashrc", ".zshrc", ".profile", ".inputrc"
  ]);

  if (noExtNames.has(baseName)) {
    return true;
  }

  const ext = name.split(".").pop() ?? "";
  const editableExtensions = new Set([
    "txt", "md", "markdown", "mdown", "mkd", "csv", "tsv",
    "json", "jsonc", "json5", "ndjson", "geojson",
    "yaml", "yml",
    "toml", "ini", "conf", "config", "cfg", "properties",
    "env", "envrc", "local",
    "xml", "svg", "html", "htm", "xhtml",
    "css", "scss", "less", "sass", "styl",
    "js", "mjs", "cjs", "bundle",
    "ts", "tsx", "jsx", "mts", "cts",
    "py", "pyw", "pyi", "ipynb",
    "go", "mod", "sum",
    "rs",
    "rb", "rake", "gemspec",
    "php", "phtml",
    "java", "jav", "properties", "gradle",
    "kt", "kts",
    "swift",
    "c", "h", "cpp", "hpp", "cc", "cxx", "c++", "h++",
    "cs", "csx",
    "sh", "bash", "zsh", "fish", "ksh", "csh",
    "bat", "cmd", "ps1", "psm1", "psd1",
    "sql", "psql", "mysql", "sqlite",
    "graphql", "gql",
    "dockerfile", "containerfile",
    "makefile", "mk",
    "gitignore", "gitattributes", "gitmodules", "npmrc", "nvmrc",
    "editorconfig",
    "log", "out",
    "rst", "adoc", "asciidoc",
    "proto", "thrift",
    "tf", "tfvars", "hcl",
    "lua",
    "r", "rmd",
    "dart",
    "ex", "exs",
    "clj", "cljs", "cljc", "edn",
    "hs", "lhs",
    "elm",
    "vue",
    "svelte",
    "astro",
    "zig",
    "nim",
    "sol", "prisma",
    "tex", "latex", "bib",
    "v", "vh", "sv", "svh", "vhd", "vhdl",
    "asm", "s",
    "pl", "pm", "t",
    "f", "f90", "f95",
    "patch", "diff",
    "srt", "vtt", "ass", "sub",
    "vcf", "ics"
  ]);

  return editableExtensions.has(ext);
}
