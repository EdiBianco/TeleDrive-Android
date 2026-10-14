/**
 * langDetect.ts
 * Maps file extensions to:
 *  - highlight.js language alias (for read/preview mode)
 *  - CodeMirror 6 language loader (lazy dynamic import, for edit mode)
 *  - Human-readable display name (for status bar badge)
 */

export interface LangInfo {
  /** highlight.js language alias — pass to hljs.highlight() */
  hljsLang: string;
  /** Display name shown in the status bar / language badge */
  displayName: string;
  /** Lazy loader that returns a CodeMirror LanguageSupport */
  cmLoader: (() => Promise<any>) | null;
}

const LANG_MAP: Record<string, LangInfo> = {
  // Python
  py:   { hljsLang: "python",     displayName: "Python",      cmLoader: () => import("@codemirror/lang-python").then(m => m.python()) },
  pyw:  { hljsLang: "python",     displayName: "Python",      cmLoader: () => import("@codemirror/lang-python").then(m => m.python()) },

  // JavaScript / TypeScript
  js:   { hljsLang: "javascript", displayName: "JavaScript",  cmLoader: () => import("@codemirror/lang-javascript").then(m => m.javascript()) },
  mjs:  { hljsLang: "javascript", displayName: "JavaScript",  cmLoader: () => import("@codemirror/lang-javascript").then(m => m.javascript()) },
  cjs:  { hljsLang: "javascript", displayName: "JavaScript",  cmLoader: () => import("@codemirror/lang-javascript").then(m => m.javascript()) },
  jsx:  { hljsLang: "javascript", displayName: "JSX",         cmLoader: () => import("@codemirror/lang-javascript").then(m => m.javascript({ jsx: true })) },
  ts:   { hljsLang: "typescript", displayName: "TypeScript",  cmLoader: () => import("@codemirror/lang-javascript").then(m => m.javascript({ typescript: true })) },
  tsx:  { hljsLang: "typescript", displayName: "TSX",         cmLoader: () => import("@codemirror/lang-javascript").then(m => m.javascript({ jsx: true, typescript: true })) },

  // Web
  html: { hljsLang: "html",       displayName: "HTML",        cmLoader: () => import("@codemirror/lang-html").then(m => m.html()) },
  htm:  { hljsLang: "html",       displayName: "HTML",        cmLoader: () => import("@codemirror/lang-html").then(m => m.html()) },
  css:  { hljsLang: "css",        displayName: "CSS",         cmLoader: () => import("@codemirror/lang-css").then(m => m.css()) },
  scss: { hljsLang: "scss",       displayName: "SCSS",        cmLoader: () => import("@codemirror/lang-css").then(m => m.css()) },
  less: { hljsLang: "less",       displayName: "Less",        cmLoader: () => import("@codemirror/lang-css").then(m => m.css()) },

  // Data formats
  json:  { hljsLang: "json",      displayName: "JSON",        cmLoader: () => import("@codemirror/lang-json").then(m => m.json()) },
  jsonc: { hljsLang: "json",      displayName: "JSONC",       cmLoader: () => import("@codemirror/lang-json").then(m => m.json()) },
  yaml:  { hljsLang: "yaml",      displayName: "YAML",        cmLoader: null },
  yml:   { hljsLang: "yaml",      displayName: "YAML",        cmLoader: null },
  toml:  { hljsLang: "toml",      displayName: "TOML",        cmLoader: null },
  xml:   { hljsLang: "xml",       displayName: "XML",         cmLoader: () => import("@codemirror/lang-xml").then(m => m.xml()) },
  svg:   { hljsLang: "xml",       displayName: "SVG",         cmLoader: () => import("@codemirror/lang-xml").then(m => m.xml()) },

  // Systems languages
  rs:   { hljsLang: "rust",       displayName: "Rust",        cmLoader: () => import("@codemirror/lang-rust").then(m => m.rust()) },
  go:   { hljsLang: "go",         displayName: "Go",          cmLoader: () => import("@codemirror/lang-go").then(m => m.go()) },
  c:    { hljsLang: "c",          displayName: "C",           cmLoader: () => import("@codemirror/lang-cpp").then(m => m.cpp()) },
  h:    { hljsLang: "c",          displayName: "C Header",    cmLoader: () => import("@codemirror/lang-cpp").then(m => m.cpp()) },
  cpp:  { hljsLang: "cpp",        displayName: "C++",         cmLoader: () => import("@codemirror/lang-cpp").then(m => m.cpp()) },
  cc:   { hljsLang: "cpp",        displayName: "C++",         cmLoader: () => import("@codemirror/lang-cpp").then(m => m.cpp()) },
  cxx:  { hljsLang: "cpp",        displayName: "C++",         cmLoader: () => import("@codemirror/lang-cpp").then(m => m.cpp()) },
  hpp:  { hljsLang: "cpp",        displayName: "C++ Header",  cmLoader: () => import("@codemirror/lang-cpp").then(m => m.cpp()) },

  // JVM
  java: { hljsLang: "java",       displayName: "Java",        cmLoader: () => import("@codemirror/lang-java").then(m => m.java()) },
  kt:   { hljsLang: "kotlin",     displayName: "Kotlin",      cmLoader: null },
  kts:  { hljsLang: "kotlin",     displayName: "Kotlin",      cmLoader: null },
  scala:{ hljsLang: "scala",      displayName: "Scala",       cmLoader: null },

  // Other languages
  cs:   { hljsLang: "csharp",     displayName: "C#",          cmLoader: null },
  swift:{ hljsLang: "swift",      displayName: "Swift",       cmLoader: null },
  rb:   { hljsLang: "ruby",       displayName: "Ruby",        cmLoader: null },
  php:  { hljsLang: "php",        displayName: "PHP",         cmLoader: null },
  dart: { hljsLang: "dart",       displayName: "Dart",        cmLoader: null },
  lua:  { hljsLang: "lua",        displayName: "Lua",         cmLoader: null },
  r:    { hljsLang: "r",          displayName: "R",           cmLoader: null },
  ex:   { hljsLang: "elixir",     displayName: "Elixir",      cmLoader: null },
  exs:  { hljsLang: "elixir",     displayName: "Elixir",      cmLoader: null },

  // Shell
  sh:   { hljsLang: "bash",       displayName: "Shell",       cmLoader: null },
  bash: { hljsLang: "bash",       displayName: "Bash",        cmLoader: null },
  zsh:  { hljsLang: "bash",       displayName: "Zsh",         cmLoader: null },
  fish: { hljsLang: "bash",       displayName: "Fish",        cmLoader: null },
  bat:  { hljsLang: "batch",      displayName: "Batch",       cmLoader: null },
  cmd:  { hljsLang: "batch",      displayName: "Batch",       cmLoader: null },
  ps1:  { hljsLang: "powershell", displayName: "PowerShell",  cmLoader: null },

  // Database
  sql:  { hljsLang: "sql",        displayName: "SQL",         cmLoader: () => import("@codemirror/lang-sql").then(m => m.sql()) },

  // Markup / Docs
  md:       { hljsLang: "markdown",   displayName: "Markdown",    cmLoader: () => import("@codemirror/lang-markdown").then(m => m.markdown()) },
  markdown: { hljsLang: "markdown",   displayName: "Markdown",    cmLoader: () => import("@codemirror/lang-markdown").then(m => m.markdown()) },
  rst:      { hljsLang: "plaintext",  displayName: "reStructured", cmLoader: null },

  // Config
  ini:       { hljsLang: "ini",       displayName: "INI",         cmLoader: null },
  conf:      { hljsLang: "ini",       displayName: "Config",      cmLoader: null },
  cfg:       { hljsLang: "ini",       displayName: "Config",      cmLoader: null },
  env:       { hljsLang: "bash",      displayName: "Env",         cmLoader: null },
  tf:        { hljsLang: "plaintext", displayName: "Terraform",   cmLoader: null },
  tfvars:    { hljsLang: "plaintext", displayName: "Terraform",   cmLoader: null },
  proto:     { hljsLang: "protobuf",  displayName: "Protobuf",    cmLoader: null },
  graphql:   { hljsLang: "graphql",   displayName: "GraphQL",     cmLoader: null },
  gql:       { hljsLang: "graphql",   displayName: "GraphQL",     cmLoader: null },
  dockerfile:{ hljsLang: "dockerfile",displayName: "Dockerfile",  cmLoader: null },
  makefile:  { hljsLang: "makefile",  displayName: "Makefile",    cmLoader: null },

  // Plain text & Data
  txt: { hljsLang: "plaintext", displayName: "Plain Text", cmLoader: null },
  log: { hljsLang: "plaintext", displayName: "Log",        cmLoader: null },
  csv: { hljsLang: "plaintext", displayName: "CSV",        cmLoader: null },
  tsv: { hljsLang: "plaintext", displayName: "TSV",        cmLoader: null },

  // Specialized languages & formats
  sol:     { hljsLang: "javascript", displayName: "Solidity",   cmLoader: null },
  prisma:  { hljsLang: "javascript", displayName: "Prisma",     cmLoader: null },
  zig:     { hljsLang: "c",          displayName: "Zig",        cmLoader: null },
  nim:     { hljsLang: "python",     displayName: "Nim",        cmLoader: null },
  tex:     { hljsLang: "latex",      displayName: "LaTeX",      cmLoader: null },
  latex:   { hljsLang: "latex",      displayName: "LaTeX",      cmLoader: null },
  bib:     { hljsLang: "latex",      displayName: "BibTeX",     cmLoader: null },
  v:       { hljsLang: "verilog",    displayName: "Verilog",    cmLoader: null },
  vhdl:    { hljsLang: "vhdl",       displayName: "VHDL",       cmLoader: null },
  asm:     { hljsLang: "x86asm",     displayName: "Assembly",   cmLoader: null },
  s:       { hljsLang: "x86asm",     displayName: "Assembly",   cmLoader: null },
  diff:    { hljsLang: "diff",       displayName: "Diff",       cmLoader: null },
  patch:   { hljsLang: "diff",       displayName: "Patch",      cmLoader: null },
  srt:     { hljsLang: "plaintext",  displayName: "Subtitles",  cmLoader: null },
  vtt:     { hljsLang: "plaintext",  displayName: "WebVTT",     cmLoader: null },
  gradle:  { hljsLang: "java",       displayName: "Gradle",     cmLoader: null },
  properties:{ hljsLang: "ini",      displayName: "Properties", cmLoader: null },
};

const FALLBACK: LangInfo = {
  hljsLang: "plaintext",
  displayName: "Plain Text",
  cmLoader: null,
};

/**
 * Detect language info from a file name.
 * Handles dotfiles like `.gitignore`, `.env`, `Dockerfile`, `Makefile`.
 */
export function detectLang(fileName: string): LangInfo {
  const lower = fileName.toLowerCase();
  const base = lower.split("/").pop() ?? lower;

  // Special dotfiles / no-extension files
  if (base === "dockerfile")          return LANG_MAP["dockerfile"];
  if (base === "makefile")            return LANG_MAP["makefile"];
  if (base === ".gitignore")          return { hljsLang: "bash", displayName: "Git Ignore", cmLoader: null };
  if (base === ".gitattributes")      return { hljsLang: "bash", displayName: "Git Attributes", cmLoader: null };
  if (base === ".npmrc")              return { hljsLang: "ini",  displayName: "npmrc", cmLoader: null };
  if (base === ".nvmrc")              return { hljsLang: "plaintext", displayName: "nvmrc", cmLoader: null };
  if (base === ".env" || base.startsWith(".env.")) return LANG_MAP["env"];
  if (base === ".editorconfig")       return { hljsLang: "ini", displayName: "EditorConfig", cmLoader: null };

  // Extension-based
  const parts = base.split(".");
  if (parts.length >= 2) {
    const ext = parts[parts.length - 1];
    return LANG_MAP[ext] ?? FALLBACK;
  }

  return FALLBACK;
}
