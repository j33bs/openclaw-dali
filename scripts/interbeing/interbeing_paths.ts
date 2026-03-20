import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_INTERBEING_DIR = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
