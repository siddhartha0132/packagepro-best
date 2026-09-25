// Clears the PackagePro app database (trips, bookings, guide reservations, Telegram chats). The PS-04 dataset is untouched.
// A running server keeps the database open and caches guide bookings, so this refuses while one is listening.
// Usage: pnpm db:reset   (PORT, PACKAGEPRO_APP_DB respected)
import { rmSync } from "node:fs";
import net from "node:net";

const APP = process.env.PACKAGEPRO_APP_DB || "data/packagepro-app.db";
const port = Number(process.env.PORT || 3000);

const serverUp = await new Promise(resolve => {
  const socket = net.connect({ port, host: "127.0.0.1" });
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
  socket.setTimeout(800, () => { socket.destroy(); resolve(false); });
});
if (serverUp) {
  console.error(`A server is running on port ${port} and holds the database open.\nStop it first (Ctrl+C in the 'pnpm dev' terminal), run 'pnpm db:reset' again, then start 'pnpm dev'.`);
  process.exit(1);
}
for (const file of [APP, `${APP}-wal`, `${APP}-shm`]) rmSync(file, { force: true });
console.log("PackagePro app database cleared (trips, bookings, guide reservations, Telegram chats). PS-04 dataset untouched.\nStart the app with 'pnpm dev' — every guide slot is free again.");
