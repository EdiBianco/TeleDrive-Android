const fs = require("fs");
const path = require("path");

const targetFile = path.resolve(__dirname, "../node_modules/telegram/tl/generationHelpers.js");

if (!fs.existsSync(targetFile)) {
  console.log("[patch-telegram] File not found, skipping:", targetFile);
  process.exit(0);
}

let content = fs.readFileSync(targetFile, "utf8");

if (content.includes("data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);")) {
  console.log("ℹ️ [patch-telegram] telegram/tl/generationHelpers.js is already patched");
  process.exit(0);
}

const originalSnippetLF = `function serializeBytes(data) {
    if (!(data instanceof Buffer)) {
        if (typeof data == "string") {
            data = Buffer.from(data);
        }
        else {
            throw Error(\`Bytes or str expected, not \${data.constructor.name}\`);
        }
    }`;

const originalSnippetCRLF = originalSnippetLF.replace(/\n/g, "\r\n");

const patchedSnippet = `function serializeBytes(data) {
    if (!(data instanceof Buffer) && !Buffer.isBuffer(data) && !(data instanceof Uint8Array)) {
        if (typeof data == "string") {
            data = Buffer.from(data);
        }
        else {
            throw Error(\`Bytes or str expected, not \${data.constructor.name}\`);
        }
    } else if (!(data instanceof Buffer)) {
        data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }`;

if (content.includes(originalSnippetLF)) {
  content = content.replace(originalSnippetLF, patchedSnippet);
  fs.writeFileSync(targetFile, content, "utf8");
  console.log("✅ [patch-telegram] Successfully patched telegram/tl/generationHelpers.js serializeBytes (LF)");
} else if (content.includes(originalSnippetCRLF)) {
  content = content.replace(originalSnippetCRLF, patchedSnippet.replace(/\n/g, "\r\n"));
  fs.writeFileSync(targetFile, content, "utf8");
  console.log("✅ [patch-telegram] Successfully patched telegram/tl/generationHelpers.js serializeBytes (CRLF)");
} else {
  // Regex fallback matching regardless of whitespace or line endings
  const regex = /function\s+serializeBytes\s*\(\s*data\s*\)\s*\{[\r\n\s]+if\s*\(\s*!\s*\(\s*data\s+instanceof\s+Buffer\s*\)\s*\)\s*\{[\r\n\s]+if\s*\(\s*typeof\s+data\s*==\s*"string"\s*\)\s*\{[\r\n\s]+data\s*=\s*Buffer\.from\(data\);[\r\n\s]+\}[\r\n\s]+else\s*\{[\r\n\s]+throw\s+Error\(`Bytes or str expected, not \$\{data\.constructor\.name\}`\);[\r\n\s]+\}[\r\n\s]+\}/;
  if (regex.test(content)) {
    content = content.replace(regex, patchedSnippet);
    fs.writeFileSync(targetFile, content, "utf8");
    console.log("✅ [patch-telegram] Successfully patched telegram/tl/generationHelpers.js serializeBytes (regex)");
  } else {
    console.warn("⚠️ [patch-telegram] Could not find target snippet to patch in generationHelpers.js");
  }
}

