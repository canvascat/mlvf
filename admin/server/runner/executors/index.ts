import type { Executors } from "../types";
import { coverExecutor } from "./cover";
import { exportExecutor } from "./export";
import { prepareExecutor } from "./prepare";
import { publishDraftExecutor } from "./publish-draft";
import { seasonExecutor } from "./season";
import { uploadExecutor } from "./upload";

export const executors: Executors = {
  prepare: prepareExecutor,
  export: exportExecutor,
  cover: coverExecutor,
  season: seasonExecutor,
  upload: uploadExecutor,
  publish_draft: publishDraftExecutor,
};
