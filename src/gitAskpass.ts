import { request } from "node:http";

// Git invokes this helper only after configured credential helpers fail to answer.
export async function askpass(prompt: string): Promise<string> {
  const port = Number(process.env.GITRISM_ASKPASS_PORT), token = process.env.GITRISM_ASKPASS_TOKEN;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !token) throw new Error("Unavailable AskPass channel");
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/askpass", method: "POST", agent: false,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }, res => {
      let body = "";
      res.on("data", chunk => { body += chunk; if (body.length > 65536) res.destroy(new Error("Invalid AskPass response")); });
      res.on("error", reject);
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) throw new Error("Cancelled AskPass request");
          const { answer } = JSON.parse(body);
          if (typeof answer !== "string" || /[\r\n\0]/.test(answer)) throw new Error("Invalid AskPass response");
          resolve(answer);
        } catch (error) { reject(error); }
      });
    });
    req.setTimeout(300_000, () => req.destroy(new Error("AskPass request timed out")));
    req.on("error", reject);
    req.end(JSON.stringify({ prompt }));
  });
}

if (require.main === module) {
  void askpass(process.argv.slice(2).join(" ")).then(answer => process.stdout.write(answer + "\n"), () => {
    process.stderr.write("Gitrism: authentication cancelled or unavailable.\n");
    process.exitCode = 1;
  });
}
