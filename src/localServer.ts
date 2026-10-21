import * as http from "node:http";
import * as path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { GitService, GitError } from "./gitService";
import { getLocale, getLocalization, t } from "./localization";
import { WorkspaceSession, WorkspaceHost, WorkspaceMessage, formatError } from "./workspaceSession";

export interface LocalServerOptions {
  repo: string;
  port?: number;
  editor?: (event: Record<string, unknown>) => void;
  theme?: "auto" | "dark" | "light";
}
interface Client {
  response: http.ServerResponse;
  session: WorkspaceSession;
  pending: Map<number, (value: unknown) => void>;
  refreshing: boolean;
}
const assets = new Set(["workspace.css", "timeline.css", "i18n.js", "graphLayout.js", "activity.js", "paneResize.js", "workingTree.js", "workspace.js", "browserHost.js", "browserHost.css"]);
const resources = path.join(__dirname, "../resources");
const escapeJson = (value: unknown) => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

export async function startLocalServer(options: LocalServerOptions) {
  const git = new GitService(await realpath(await new GitService(path.resolve(options.repo)).repositoryRoot()));
  const token = randomBytes(32).toString("hex");
  const clients = new Map<string, Client>();
  let origin = "", sequence = 0, closed = false;
  let navigation: { type: string; file?: string; hash?: string } | undefined;
  const send = (client: Client, message: unknown) => {
    if (client.response.destroyed) return;
    if (client.response.writableLength > 8 * 1024 * 1024) { client.response.destroy(); return; }
    client.response.write("data: " + JSON.stringify(message) + "\n\n");
  };
  const refresh = async () => {
    await Promise.all([...clients.values()].map(async client => {
      if (client.refreshing) return;
      client.refreshing = true;
      try { await client.session.refresh(); } finally { client.refreshing = false; }
    }));
  };
  const broadcast = (message: unknown) => { for (const c of clients.values()) send(c, message); };
  const ask = (client: Client, kind: string, values: Record<string, unknown>): Promise<unknown> => new Promise(resolve => {
    const id = ++sequence;
    const timer = setTimeout(() => { client.pending.delete(id); resolve(undefined); }, 120_000);
    client.pending.set(id, value => { clearTimeout(timer); resolve(value); });
    send(client, { type: "hostRequest", id, kind, ...values });
  });
  async function content(ref: string, file: string): Promise<string> {
    let value: string;
    if (ref === "WORKING") {
      const absolute = await realpath(git.filePath(file));
      if (!absolute.startsWith(git.cwd + path.sep)) throw new GitError(t("File is outside the current repository"));
      const info = await stat(absolute);
      if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error(t("This preview supports text files up to 2 MiB."));
      value = await readFile(absolute, "utf8");
    } else value = await git.contentAt(ref, file);
    if (Buffer.byteLength(value) > 2 * 1024 * 1024 || value.includes("\0")) throw new Error(t("This preview supports text files up to 2 MiB."));
    return value;
  }
  function hostFor(client: Client): WorkspaceHost {
    return {
      postMessage: message => send(client, message), isTrusted: () => true,
      confirm: async (message, detail) => await ask(client, "confirm", { message, detail }) === true,
      input: async (prompt, value) => { const result = await ask(client, "input", { prompt, value }); return typeof result === "string" ? result : undefined; },
      pick: async (items, prompt) => { const result = await ask(client, "pick", { items, prompt }); return typeof result === "string" && items.includes(result) ? result : undefined; },
      chooseRepository: async () => send(client, { type: "notice", message: t("This workspace is bound to {0}. Open another repository from your editor or CLI.", git.cwd) }),
      openGraph: async () => { if (options.editor) options.editor({ type: "focusEditor" }); },
      activeHistory: async () => {
        if (options.editor) options.editor({ type: "activeHistory" });
        else { const file = await ask(client, "input", { prompt: t("File path relative to the repository root") }); if (typeof file === "string" && file) { git.filePath(file); client.session.revealTimeline(file); } }
      },
      openDiff: async (_git, from, to, file, oldFile = file) => {
        const [left, right] = await Promise.all([content(from, oldFile), content(to, file)]);
        send(client, { type: "browserDiff", from, to, file, left, right, editor: !!options.editor });
      },
      openFile: async file => {
        const relative = path.relative(git.cwd, file); git.filePath(relative);
        if (options.editor) options.editor({ type: "openFile", path: file, line: 1 });
        else send(client, { type: "browserDiff", from: "WORKING", to: "WORKING", file: relative, left: "", right: await content("WORKING", relative), editor: false });
      },
      openWorktree: async directory => {
        if (options.editor) options.editor({ type: "openWorktree", path: directory });
        else send(client, { type: "notice", message: t("Open this worktree with gitrism serve --repo {0}", directory) });
      },
      copy: async value => send(client, { type: "browserCopy", value })
    };
  }
  async function jsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error("Request is too large"); chunks.push(chunk); }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid request");
    return value as Record<string, unknown>;
  }
  const server = http.createServer((req, res) => { void route(req, res).catch(error => {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: formatError(error) }));
  }); });
  async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    if (closed || req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) { res.writeHead(403); res.end(); return; }
    const url = new URL(req.url || "/", origin);
    if (url.pathname.startsWith("/api/")) {
      const provided = Buffer.from(String(req.headers["x-gitrism-token"] || ""));
      if (provided.length !== token.length || !timingSafeEqual(provided, Buffer.from(token))) { res.writeHead(403); res.end(); return; }
      if (url.pathname === "/api/events" && req.method === "GET") {
        if (clients.size >= 16) { res.writeHead(429); res.end(); return; }
        const id = randomBytes(16).toString("hex");
        res.writeHead(200, { "Content-Type": "text/event-stream", "Connection": "keep-alive" });
        res.flushHeaders();
        const client: Client = { response: res, session: undefined!, pending: new Map(), refreshing: false };
        client.session = new WorkspaceSession(git, hostFor(client), refresh); clients.set(id, client);
        send(client, { type: "connected", client: id });
        res.once("close", () => {
          client.session.dispose(); clients.delete(id);
          for (const resolve of client.pending.values()) resolve(undefined);
          client.pending.clear();
        });
        return;
      }
      if (url.pathname === "/api/message" && req.method === "POST" && req.headers.origin === origin) {
        const body = await jsonBody(req), client = clients.get(String(body.client));
        if (!client) { res.writeHead(410); res.end(); return; }
        const message = body.message as WorkspaceMessage;
        if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.type !== "string") throw new Error("Invalid message");
        if (message.type === "hostResponse") { client.pending.get(Number(message.id))?.(message.value); client.pending.delete(Number(message.id)); }
        else if (message.type === "browserOpenFile") {
          if (!options.editor || typeof message.file !== "string") throw new Error("Editor is unavailable");
          options.editor({ type: "openFile", path: git.filePath(message.file), line: 1 });
        } else {
          void client.session.handle(message).then(() => {
            if (message.type === "ready" && navigation) send(client, navigation);
          });
        }
        res.writeHead(202); res.end(); return;
      }
      res.writeHead(404); res.end(); return;
    }
    if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
    if (url.pathname === "/") {
      const nonce = randomBytes(16).toString("hex");
      res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'self'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      const scripts = ["i18n.js", "graphLayout.js", "activity.js", "paneResize.js", "workingTree.js", "browserHost.js", "workspace.js"];
      res.end(`<!DOCTYPE html><html lang="${getLocale()}" data-theme="${options.theme || "auto"}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gitrism</title><link rel="stylesheet" href="/workspace.css"><link rel="stylesheet" href="/timeline.css"><link rel="stylesheet" href="/browserHost.css"></head><body><main id="app" aria-busy="true"></main><div id="toast" role="status" hidden></div><script nonce="${nonce}" id="gitrism-localization" type="application/json">${escapeJson(getLocalization())}</script>${scripts.map(s => `<script nonce="${nonce}" src="/${s}"></script>`).join("")}</body></html>`); return;
    }
    const asset = url.pathname.slice(1);
    if (!assets.has(asset)) { res.writeHead(404); res.end(); return; }
    res.setHeader("Content-Type", asset.endsWith(".css") ? "text/css" : "text/javascript");
    res.end(await readFile(path.join(resources, asset)));
  }
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port || 0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to start local workspace");
  origin = "http://127.0.0.1:" + address.port;
  const timer = setInterval(() => { broadcast({ type: "heartbeat" }); void refresh(); }, 5000);
  timer.unref();
  return {
    git, origin, token, url: origin + "/#token=" + token,
    refresh,
    revealTimeline: (file: string) => { git.filePath(file); navigation = { type: "timeline", file }; broadcast(navigation); },
    revealCommit: async (ref: string) => { const hash = await git.resolveCommit(ref); navigation = { type: "revealCommit", hash }; broadcast(navigation); },
    broadcast,
    close: async () => {
      closed = true; clearInterval(timer);
      for (const c of clients.values()) c.response.end();
      server.closeIdleConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}
