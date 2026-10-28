// OpenSSH ProxyCommand adapter. Credentials and keys remain with OpenSSH.
import * as net from "node:net";
import { lookup } from "node:dns/promises";
import { normalizeNetworkProxy } from "./networkProxy";

async function read(socket: net.Socket, count: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { socket.off("readable", ready); socket.off("error", fail); socket.off("end", ended); socket.off("close", ended); };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const ended = () => fail(new Error("Proxy closed the connection during negotiation"));
    const ready = () => {
      const data = socket.read(count) as Buffer | null;
      if (data) { cleanup(); resolve(data); }
      else if (socket.destroyed || socket.readableEnded) ended();
    };
    socket.on("readable", ready); socket.once("error", fail); socket.once("end", ended); socket.once("close", ended); ready();
  });
}

export async function connectSshProxy(proxyAddress: string, host: string, port: number): Promise<net.Socket> {
  if (!host || host.length > 253 || /[\s\x00-\x1f\x7f]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid SSH destination");
  const config = normalizeNetworkProxy({ mode: "custom", url: proxyAddress });
  const proxy = new URL(config.url);
  const socket = net.createConnection({ host: proxy.hostname.replace(/^\[|\]$/g, ""), port: Number(proxy.port || 80) });
  // A single deadline covers DNS, connection, and all handshake steps.
  const timer = setTimeout(() => socket.destroy(new Error("Proxy negotiation timed out")), 15000);
  // Keep a listener between awaited reads as a peer may fail at any time.
  let failure: Error | undefined;
  const failed = (error: Error) => { failure = error; };
  socket.on("error", failed);
  try {
    await new Promise<void>((resolve, reject) => {
      const connected = () => { socket.off("error", rejected); resolve(); };
      const rejected = (error: Error) => { socket.off("connect", connected); reject(error); };
      socket.once("connect", connected); socket.once("error", rejected);
    });
    if (proxy.protocol === "http:") {
      const destination = `${net.isIP(host) === 6 ? "[" + host + "]" : host}:${port}`;
      socket.write(`CONNECT ${destination} HTTP/1.1\r\nHost: ${destination}\r\n\r\n`);
      let header = "";
      while (!header.endsWith("\r\n\r\n")) {
        if (header.length >= 16384) throw new Error("Proxy response headers are too large");
        header += (await read(socket, 1)).toString("latin1");
      }
      if (!/^HTTP\/1\.[01] 200(?:\s|\r)/.test(header)) throw new Error("HTTP proxy refused the SSH tunnel");
    } else {
      socket.write(Buffer.from([5, 1, 0]));
      const greeting = await read(socket, 2);
      if (greeting[0] !== 5 || greeting[1] !== 0) throw new Error("SOCKS5 proxy requires unsupported authentication or rejected the connection");
      const destination = proxy.protocol === "socks5:" ? (await lookup(host, { family: 4 })).address : host;
      const name = Buffer.from(destination);
      const request = Buffer.alloc(7 + name.length);
      request.set([5, 1, 0, 3, name.length]); name.copy(request, 5); request.writeUInt16BE(port, 5 + name.length);
      socket.write(request);
      const reply = await read(socket, 4);
      if (reply[0] !== 5 || reply[1] !== 0 || reply[2] !== 0) throw new Error("SOCKS5 proxy refused the SSH tunnel");
      const addressLength = reply[3] === 1 ? 4 : reply[3] === 4 ? 16 : reply[3] === 3 ? (await read(socket, 1))[0] : 0;
      if (!addressLength) throw new Error("Invalid SOCKS5 proxy response");
      await read(socket, addressLength + 2);
    }
    if (failure) throw failure;
    return socket;
  } catch (error) { socket.destroy(); throw failure || error; }
  finally { clearTimeout(timer); socket.off("error", failed); }
}

if (require.main === module) {
  void connectSshProxy(process.env.GITRISM_PROXY_URL || "", process.argv[2], Number(process.argv[3])).then(socket => {
    const stop = () => socket.destroy();
    socket.on("error", () => { stop(); process.exitCode = 1; });
    process.stdin.on("error", stop); process.stdout.on("error", stop);
    process.stdin.on("end", stop); process.stdout.on("close", stop);
    process.stdin.pipe(socket).pipe(process.stdout);
  }, () => {
    // Never print proxy responses, remote addresses, or authentication material.
    process.stderr.write("Gitrism: unable to establish the SSH proxy tunnel. Check the proxy address, protocol, and reachability.\n");
    process.exitCode = 1;
  });
}
