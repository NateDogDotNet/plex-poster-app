// Loopback checks shared by the dev server (and anything else that must tell a local
// client from a LAN one). Importing this starts no server.

// True when a socket peer address (req.socket.remoteAddress) is a loopback address.
export function isLoopback(addr) {
  if (typeof addr !== 'string' || !addr) return false;
  const a = addr.toLowerCase().replace(/^::ffff:/, ''); // IPv4-mapped IPv6
  if (a === '::1') return true;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  return !!m && m.slice(1).every((n) => Number(n) <= 255);
}

// True when a Host header names localhost, 127.0.0.1 or [::1]. Only the hostname is
// compared; the port is ignored (browsers send `localhost:8080`).
export function isLoopbackHost(host) {
  if (typeof host !== 'string' || !host) return false;
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL('http://' + host).hostname);
  } catch {
    return false;
  }
}
