import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

export type GitCredentialPrompt = (prompt: string, signal: AbortSignal) => Promise<string | undefined>;
export type GitNetworkAuthentication = <T>(operation: (env: Record<string, string>) => Promise<T>) => Promise<T>;

/** An operation-scoped AskPass channel. Credentials never enter files or argv. */
export async function withGitAuthentication<T>(prompt: GitCredentialPrompt, operation: (env: Record<string, string>) => Promise<T>): Promise<T> {
  const token = randomBytes(32).toString("hex");
  const controller = new AbortController();
  let pending = false;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST" || req.url !== "/askpass" || req.headers.authorization !== `Bearer ${token}` || req.headers.origin || pending) {
      res.writeHead(403).end(); return;
    }
    pending = true;
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 8192) { res.writeHead(413).end(); return; }
      }
      const value = JSON.parse(body);
      if (typeof value.prompt !== "string" || value.prompt.length > 4096 || /[\x00-\x1f\x7f]/.test(value.prompt)) { res.writeHead(400).end(); return; }
      const answer = await prompt(value.prompt, controller.signal);
      if (controller.signal.aborted || answer === undefined || /[\r\n\0]/.test(answer)) res.writeHead(401).end();
      else res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ answer }));
    } catch { if (!res.writableEnded) res.writeHead(400).end(); }
    finally { pending = false; }
  });
  server.requestTimeout = 300_000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(path.join(tmpdir(), "gitrism-askpass-"));
    const command = path.join(directory, "askpass.sh");
    // GIT_ASKPASS is an executable path, not a shell command with arguments.
    // Git for Windows also supports /bin/sh scripts. Quote for that shell.
    const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
    await writeFile(command, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(process.execPath)} ${quote(require.resolve("./gitAskpass"))} "$@"\n`, { mode: 0o700 });
    return await operation({
      GIT_ASKPASS: command, SSH_ASKPASS: command, LC_ALL: "C",
      GITRISM_ASKPASS_PORT: String(port), GITRISM_ASKPASS_TOKEN: token
    });
  } finally {
    controller.abort();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
