import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const code = fs.readFileSync(path.join(root, "apps-script", "Code.gs"), "utf8");
const out = `async () => {
  const code = ${JSON.stringify(code)};
  if (typeof monaco !== "undefined" && monaco.editor) {
    const models = monaco.editor.getModels();
    if (models && models.length) {
      models[0].setValue(code);
      return { ok: true, via: "monaco", len: code.length, modelCount: models.length };
    }
  }
  const ta =
    document.querySelector("textarea.inputarea") ||
    document.querySelector(".monaco-editor textarea") ||
    document.querySelector('[role="textbox"][aria-multiline="true"]');
  if (ta) {
    ta.focus();
    const native = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    );
    if (native && native.set) native.set.call(ta, code);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: true, via: "textarea", len: code.length };
  }
  return {
    ok: false,
    error: "No monaco/textarea found",
    hasMonaco: typeof monaco !== "undefined",
  };
}
`;
const dest = path.join(root, "scripts", "inject-apps-script.js");
fs.writeFileSync(dest, out);
console.log("wrote", dest, "chars", out.length);
