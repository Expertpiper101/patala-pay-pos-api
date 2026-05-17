import fs from "node:fs";
import http from "node:http";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : "true";
    args[key] = value;
    if (value !== "true") {
      index += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(args.root || ".");
const HOST = args.host || "127.0.0.1";
const PORT = Number(args.port || 8080);
const LABEL = args.name || `static-${PORT}`;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

function resolveRequestPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0]);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relativePath);
  if (!filePath.startsWith(ROOT)) {
    return null;
  }
  return filePath;
}

const server = http.createServer((req, res) => {
  const requestedPath = resolveRequestPath(req.url || "/");
  if (!requestedPath) {
    send(res, 403, "Forbidden");
    return;
  }

  let filePath = requestedPath;
  if (!fs.existsSync(filePath)) {
    filePath = path.join(ROOT, "index.html");
  }

  try {
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";
    const body = fs.readFileSync(filePath);
    send(res, 200, body, contentType);
  } catch (error) {
    send(res, 404, `Not found: ${error.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`${LABEL} serving ${ROOT} at http://${HOST}:${PORT}`);
});
