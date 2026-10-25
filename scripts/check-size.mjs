// Fails if the gzipped widget bundle goes over budget. Usage: node scripts/check-size.mjs [file] [bytes]
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const [file = "dist/cecil.js", max = "9000"] = process.argv.slice(2);
const size = gzipSync(readFileSync(file)).length;
console.log(`${file}: ${size} bytes gzipped (budget ${max})`);
if (size > Number(max)) {
  console.error("over budget");
  process.exit(1);
}
