import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { startLocalServer } from "./localServer";
import { setLanguage } from "./localization";
import { authorsForRange } from "./attribution";
import { formatError } from "./workspaceSession";

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    console.log(`Gitrism local workspace\n\nUsage: gitrism serve [--repo PATH] [--port 0] [--locale en|zh-CN|zh-TW]\n                     [--theme auto|dark|light] [--open] [--stdio]\n\nRequires Node.js 22+ and Git 2.25.1+. Binds to 127.0.0.1 only.\n--stdio is a private JSON-lines editor bridge; EOF stops the server.`); return;
  }
  if (args[0] !== "serve") throw new Error("Expected: gitrism serve (see --help)");
  let repo = process.cwd(), port = 0, locale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "en";
  let theme: "auto" | "dark" | "light" = "auto", stdio = false, open = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--stdio") { stdio = true; continue; }
    if (arg === "--open") { open = true; continue; }
    if (!["--repo", "--port", "--locale", "--theme"].includes(arg) || !args[i + 1]) throw new Error("Unknown or incomplete option: " + arg);
    const value = args[++i];
    if (arg === "--repo") repo = value;
    if (arg === "--locale") locale = value.split(".")[0];
    if (arg === "--port") { if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error("Invalid port"); port = Number(value); }
    if (arg === "--theme") { if (!["auto", "dark", "light"].includes(value)) throw new Error("Invalid theme"); theme = value as typeof theme; }
  }
  setLanguage(locale);
  const write = (message: unknown) => { process.stdout.write(JSON.stringify(message) + "\n"); };
  const workspace = await startLocalServer({ repo, port, theme, editor: stdio ? write : undefined });
  let stopping = false;
  let editorInput: ReturnType<typeof createInterface> | undefined;
  const stop = async () => { if (stopping) return; stopping = true; editorInput?.close(); await workspace.close(); };
  process.once("SIGINT", () => { void stop(); }); process.once("SIGTERM", () => { void stop(); });
  if (stdio) {
    const input = editorInput = createInterface({ input: process.stdin, crlfDelay: Infinity });
    let inFlight = 0;
    input.on("line", line => {
      if (line.length > 1024 * 1024) { input.close(); void stop(); return; }
      let request: Record<string, unknown>;
      try { request = JSON.parse(line); if (!request || typeof request !== "object" || !Number.isSafeInteger(request.id)) throw new Error("Invalid editor request"); }
      catch (error) { write({ type: "protocolError", error: formatError(error) }); return; }
      if (inFlight >= 16) { write({ type: "response", id: request.id, error: "Too many pending editor requests" }); return; }
      inFlight++;
      void handle(request).then(result => write({ type: "response", id: request.id, result }), error => write({ type: "response", id: request.id, error: formatError(error) })).finally(() => { inFlight--; });
    });
    async function handle(request: Record<string, unknown>): Promise<unknown> {
      const file = typeof request.file === "string" ? request.file : "";
      switch (request.method) {
        case "refresh": await workspace.refresh(); return true;
        case "timeline": workspace.revealTimeline(file); return true;
        case "commit": if (typeof request.ref !== "string") throw new Error("Invalid reference"); await workspace.revealCommit(request.ref); return true;
        case "blame": case "attribution": case "lineHistory": {
          const start = Number(request.start), end = Number(request.end);
          if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end - start >= 5000) throw new Error("Invalid line range (maximum 5000 lines)");
          if (request.method === "lineHistory") return workspace.git.lineHistory(file, start, end);
          const lines = await workspace.git.blame(file, start, end);
          return request.method === "attribution" ? authorsForRange(lines, 0, lines.length - 1) : lines;
        }
        default: throw new Error("Unknown editor method");
      }
    }
    input.once("close", () => { void stop(); });
    write({ type: "ready", root: workspace.git.cwd, url: workspace.url });
  } else {
    console.log("Gitrism: " + workspace.git.cwd + "\n" + workspace.url + "\nPress Ctrl+C to stop.");
  }
  if (open) {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
    const child = spawn(command, process.platform === "win32" ? ["url.dll,FileProtocolHandler", workspace.url] : [workspace.url], { stdio: "ignore" });
    child.on("error", error => console.error("Open the workspace URL manually: " + error.message)); child.unref();
  }
}
