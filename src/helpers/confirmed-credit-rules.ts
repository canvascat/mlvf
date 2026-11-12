import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  confirmedCreditKeyList,
  rememberConfirmedCreditKeys,
} from "./lyric-metadata";

const defaultCreditRulesPath = fileURLToPath(
  new URL("./confirmed-credit-keys.json", import.meta.url),
);

export function addConfirmedCreditKeys(
  lines: readonly string[],
  filePath = defaultCreditRulesPath,
): string[] {
  const added = rememberConfirmedCreditKeys(lines);
  if (added.length > 0) {
    const keys = confirmedCreditKeyList();
    writeFileSync(filePath, `${JSON.stringify({ keys }, null, 2)}\n`);
  }
  return added;
}
