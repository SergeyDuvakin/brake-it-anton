import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (full.endsWith(".js")) acc.push(full);
  }
  return acc;
}

const files = [...walk("js"), ...walk("tools"), ...walk("test")];
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed += 1;
    console.error(file);
    console.error(result.stderr);
  }
}
if (failed) {
  console.error(`${failed} file(s) failed syntax check`);
  process.exit(1);
}
console.log(`syntax ok (${files.length} files)`);
