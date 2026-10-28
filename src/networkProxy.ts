import { t } from "./localization";

export interface NetworkProxy { mode: "inherit" | "custom" | "direct"; url: string }
export const defaultNetworkProxy: NetworkProxy = { mode: "inherit", url: "" };

export function normalizeNetworkProxy(value: unknown): NetworkProxy {
  const config = value as Partial<NetworkProxy> | null;
  if (!config || typeof config.mode !== "string" || !["inherit", "custom", "direct"].includes(config.mode) || typeof config.url !== "string") throw new Error(t("Invalid network proxy configuration"));
  if (config.mode !== "custom") return { mode: config.mode!, url: "" };
  const input = config.url.trim();
  // URLs contain endpoints only: never accept credentials or shell fragments.
  if (!input || input.length > 2048 || /[\s\x00-\x1f\x7f'"`\\]/.test(input)) throw new Error(t("Enter a proxy address, such as http://127.0.0.1:7890 or socks5h://192.168.1.10:1080"));
  let url: URL;
  const address = input.includes("://") ? input : "http://" + input;
  try { url = new URL(address); } catch { throw new Error(t("Invalid proxy address")); }
  if (!["http:", "socks5:", "socks5h:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) throw new Error(t("Use an HTTP or SOCKS5 proxy URL without credentials, paths, or query parameters"));
  // WHATWG URL omits a default HTTP port; an omitted port means 80.
  const port = url.port ? Number(url.port) : url.protocol === "http:" ? 80 : 0;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(t("Proxy port must be between 1 and 65535"));
  return { mode: "custom", url: `${url.protocol}//${url.hostname}:${port}` };
}

export function shellQuote(value: string): string {
  return process.platform === "win32" ? '"' + value.replace(/"/g, '\\"') + '"' : "'" + value.replace(/'/g, "'\\''") + "'";
}

export function sshProxyCommand(command: string, proxy: boolean): string {
  const helper = `${shellQuote(process.execPath)} ${shellQuote(require.resolve("./sshProxy"))} ${shellQuote("%h")} ${shellQuote("%p")}`;
  // OpenSSH uses the first value for an option. Put our choice before existing flags.
  const parts = command.trim().match(/^("[^"]*"|'[^']*'|[^\s]+)([\s\S]*)$/);
  if (!parts) throw new Error(t("Invalid SSH command"));
  return `${parts[1]} -o ${shellQuote("ProxyCommand=" + (proxy ? helper : "none"))}${proxy ? "" : " -o ProxyJump=none"}${parts[2]}`;
}
