import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ttf": "font/ttf",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const file = path.normalize(path.join(root, pathname));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": types[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(data);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`instructor on http://127.0.0.1:${port}`);
});
