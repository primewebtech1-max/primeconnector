import { socksDispatcher } from 'fetch-socks';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { ProxyAgent } from 'undici';

type Proxy = {
  host: string;
  password?: string;
  port?: string;
  protocol?: string;
  username?: string;
};

function selectProxyAgent(proxyUrl: string): HttpsProxyAgent<string> | SocksProxyAgent {
  const url = new URL(proxyUrl);
  const protocol = url.protocol.toLowerCase();

  switch (protocol) {
    case 'http:':
    case 'https:':
      return new HttpsProxyAgent(url);
    case 'socks:':
    case 'socks4:':
    case 'socks4a:':
    case 'socks5:':
    case 'socks5h:': {
      const proto = protocol.replace(':', '');
      const auth =
        url.username && url.password ? `${encodeURIComponent(url.username)}:${encodeURIComponent(url.password)}@` : '';
      const port = url.port ? `:${url.port}` : ':1080';
      const urlSocks = `${proto}://${auth}${url.hostname}${port}`;
      return new SocksProxyAgent(urlSocks);
    }
    default:
      throw new Error(`Unsupported proxy protocol: ${url.protocol}`);
  }
}

export function makeProxyAgent(proxy: Proxy | string): HttpsProxyAgent<string> | SocksProxyAgent {
  if (typeof proxy === 'string') {
    return selectProxyAgent(proxy);
  }

  const { host, password, port, protocol, username } = proxy;
  if (!host) {
    throw new Error('Proxy host is required');
  }

  // If host is already a full URL with scheme (e.g. http://... or socks5://...)
  if (/^[a-zA-Z0-9+-.]+:\/\//.test(host)) {
    return selectProxyAgent(host);
  }

  const cleanProtocol = (protocol || 'http').replace(/:$/, '').toLowerCase();
  const cleanPort = port || (cleanProtocol.startsWith('socks') ? '1080' : '80');
  const auth = username && password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : '';
  const proxyUrl = `${cleanProtocol}://${auth}${host}:${cleanPort}`;

  return selectProxyAgent(proxyUrl);
}

export function makeProxyAgentUndici(proxy: Proxy | string): ProxyAgent {
  let proxyUrl: string;
  let protocol: string;

  if (typeof proxy === 'string') {
    const url = new URL(proxy);
    protocol = url.protocol.replace(':', '').toLowerCase();
    proxyUrl = proxy;
  } else {
    const { host, password, port, protocol: proto, username } = proxy;
    if (!host) {
      throw new Error('Proxy host is required');
    }

    if (/^[a-zA-Z0-9+-.]+:\/\//.test(host)) {
      const url = new URL(host);
      protocol = url.protocol.replace(':', '').toLowerCase();
      proxyUrl = host;
    } else {
      protocol = (proto || 'http').replace(':', '').toLowerCase();
      const cleanPort = port || (protocol.startsWith('socks') ? '1080' : '80');
      const auth = username && password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : '';
      proxyUrl = `${protocol}://${auth}${host}:${cleanPort}`;
    }
  }

  protocol = protocol.toLowerCase();

  switch (protocol) {
    case 'http':
    case 'https':
      return new ProxyAgent(proxyUrl);

    case 'socks4':
    case 'socks4a':
    case 'socks':
    case 'socks5':
    case 'socks5h': {
      let type: 4 | 5 = 5;
      if (protocol.startsWith('socks4')) type = 4;

      const url = new URL(proxyUrl);

      return socksDispatcher({
        type: type,
        host: url.hostname,
        port: Number(url.port) || 1080,
        userId: url.username ? decodeURIComponent(url.username) : undefined,
        password: url.password ? decodeURIComponent(url.password) : undefined,
      });
    }

    default:
      throw new Error(`Unsupported proxy protocol: ${protocol}`);
  }
}
