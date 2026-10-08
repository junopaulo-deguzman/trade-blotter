import app from "./app.ts";
import { db } from "../db/connection.ts";
import { attachTradeWebSocket, websocketOrigins } from "./ws/websocket.ts";

import { seedTradesOnStartup } from "./startup/seed-trades.ts";

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");

const origins = websocketOrigins();
try {
  const count = await seedTradesOnStartup();
  if (count) console.log(`Initialized blotter with ${count} demo trades`);
} catch {
  console.error("Startup data initialization failed. Check database connectivity and migrations.");
  await db.end();
  process.exit(1);
}
const server = app.listen(port, "0.0.0.0", () => console.log(`API listening on port ${port}`));

const stopWebSocket = attachTradeWebSocket(server, { origins });

const shutdown = () => {
  stopWebSocket();
  server.close(() => {
    void db.end().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
