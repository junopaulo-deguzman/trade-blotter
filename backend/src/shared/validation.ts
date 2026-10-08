import { z } from "zod";

export class InputValidationError extends Error {
  readonly fieldErrors: Record<string, string[]>;

  constructor(fieldErrors: Record<string, string[]>) {
    super("Invalid input.");
    this.name = "InputValidationError";
    this.fieldErrors = fieldErrors;
  }
}

export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.join(".") || "body";
    fieldErrors[field] ??= [];
    fieldErrors[field].push(issue.message);
  }
  throw new InputValidationError(fieldErrors);
}
export const requiredText = z.string().trim().min(1).max(255);
export const codeText = requiredText.transform((value) => value.toUpperCase());
