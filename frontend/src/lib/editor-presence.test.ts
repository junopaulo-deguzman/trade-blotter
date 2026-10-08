import { describe, expect, it } from "vitest";
import { formatOtherEditors } from "./editor-presence";
import type { Editor } from "@/types/ws";

const editors: Editor[] = [
  { connectionId: "1", userId: 1, name: "Ari" },
  { connectionId: "2", userId: 2, name: "Bea" },
  { connectionId: "3", userId: 3, name: "Cal" },
  { connectionId: "4", userId: 4, name: "Dee" },
];

describe("formatOtherEditors", () => {
  it("shows a single editor name", () => {
    expect(formatOtherEditors(editors.slice(0, 1))).toBe("Ari");
  });

  it("shows two editor names", () => {
    expect(formatOtherEditors(editors.slice(0, 2))).toBe("Ari and Bea");
  });

  it("shows at most two names and a correctly pluralized remainder", () => {
    expect(formatOtherEditors(editors.slice(0, 3))).toBe("Ari, Bea and 1 other");
    expect(formatOtherEditors(editors)).toBe("Ari, Bea and 2 others");
  });
});
