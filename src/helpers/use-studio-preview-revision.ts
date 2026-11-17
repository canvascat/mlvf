import { useEffect, useState } from "react";
import {
  getStudioPreviewRevision,
  subscribeStudioPreview,
} from "./studio-preview";

/** studio-preview.generated.ts 更新时递增，用于 Root 里重算 defaultProps。 */
export function useStudioPreviewRevision(): number {
  const [revision, setRevision] = useState(() => getStudioPreviewRevision());
  useEffect(() => subscribeStudioPreview(() => setRevision(getStudioPreviewRevision())), []);
  return revision;
}