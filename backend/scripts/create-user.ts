import { parseArgs } from "node:util";
import { provisionUserSchema } from "../src/auth/auth.types.ts";
import { InputValidationError, validate } from "../src/shared/validation.ts";
import { provisionAccount } from "../src/auth/auth.service.ts";
import { db } from "../db/connection.ts";

function readPassword(): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error("Run this command in an interactive terminal to enter the password securely.");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let password = "";
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (data: Buffer) => {
      for (const character of data.toString("utf8")) {
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(password);
          return;
        }
        if (character === "\u0003" || character === "\u0004") {
          cleanup();
          reject(new Error("Cancelled."));
          return;
        }
        if (character === "\u007f" || character === "\b") password = password.slice(0, -1);
        else if (character >= " ") password += character;
      }
    };
    process.stdin.on("data", onData);
    process.stdout.write("Password (minimum 12 characters): ");
  });
}
try {
  const { values } = parseArgs({
    options: {
      username: { type: "string" },
      name: { type: "string" },
      "reset-password": { type: "boolean", default: false },
    },
  });
  if (!values.username || (!values.name && !values["reset-password"]))
    throw new Error(
      "Usage: npm run user:create -- --username USER --name NAME (or --reset-password)",
    );
  const input = validate(provisionUserSchema, {
    username: values.username,
    name: values.name ?? values.username,
    password: await readPassword(),
  });
  await provisionAccount(input, values["reset-password"]);
  console.log(
    values["reset-password"] ? "Password reset; existing sessions revoked." : "User created.",
  );
} catch (error) {
  if (error instanceof InputValidationError) {
    for (const [field, messages] of Object.entries(error.fieldErrors)) {
      console.error(`${field}: ${messages.join("; ")}`);
    }
  } else {
    console.error(error instanceof Error ? error.message : "User provisioning failed.");
  }
  process.exitCode = 1;
} finally {
  await db.end();
}
