import { useEffect, useId } from "react";
const drafts = new Set();
export const hasDrafts = () => drafts.size > 0;
export function useDraft(dirty) {
  const id = useId();
  useEffect(() => {
    if (dirty) drafts.add(id);
    else drafts.delete(id);
    return () => drafts.delete(id);
  }, [dirty, id]);
}
