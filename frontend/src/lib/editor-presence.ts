import type { Editor } from "@/types/ws";

export function formatOtherEditors(editors: readonly Editor[]): string {
  const names = editors.slice(0, 2).map((editor) => editor.name);
  const others = editors.length - names.length;
  const visibleNames = names.join(others < 1 ? " and " : ", ");


  return others > 0
    ? `${visibleNames} and ${others} other${others === 1 ? "" : "s"}`
    : visibleNames;
}
