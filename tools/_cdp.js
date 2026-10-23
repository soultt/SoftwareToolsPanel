'use strict';

/**
 * 开发用：CDP 远程调试客户端（不参与打包）
 * 用法：node tools/_cdp.js <动作>
 *   node tools/_cdp.js shot <文件>              -> 截图当前页面
 *   node tools/_cdp.js eval "<js>"              -> 执行一段 JS 并输出结果
 */

const http = require('http');
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');

const PORT = Number(process.env.CDP_PORT || 9222);

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  });
}

class WS {
  constructor(url) {
    this.url = new URL(url);
    this.buf = Buffer.alloc(0);
    this.handlers = new Map();
    this.id = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const sock = net.connect(Number(this.url.port), this.url.hostname);
      this.sock = sock;
      let handshaking = true;
      let head = Buffer.alloc(0);

      sock.on('connect', () => {
        sock.write(
          `GET ${this.url.pathname}${this.url.search} HTTP/1.1\r\n` +
            `Host: ${this.url.host}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Key: ${key}\r\n` +
            'Sec-WebSocket-Version: 13\r\n\r\n'
        );
      });

      sock.on('data', (chunk) => {
        if (handshaking) {
          head = Buffer.concat([head, chunk]);
          const idx = head.indexOf('\r\n\r\n');
          if (idx < 0) return;
          const header = head.slice(0, idx).toString();
          if (!/101/.test(header)) return reject(new Error(header.split('\r\n')[0]));
          handshaking = false;
          const rest = head.slice(idx + 4);
          if (rest.length) this.onData(rest);
          resolve();
          return;
        }
        this.onData(chunk);
      });

      sock.on('error', (err) => (handshaking ? reject(err) : console.error(err.message)));
    });
  }

  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        len = Number(b.readBigUInt64BE(2));
        off = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (b.length < off + maskLen + len) return;
      let payload = b.slice(off + maskLen, off + maskLen + len);
      if (masked) {
        const mask = b.slice(off, off + 4);
        payload = Buffer.from(payload.map((v, i) => v ^ mask[i % 4]));
      }
      this.buf = b.slice(off + maskLen + len);

      if (opcode === 0x0) {
        if (this.frag) {
          this.frag.chunks.push(payload);
          if (fin) {
            const full = Buffer.concat(this.frag.chunks);
            const op = this.frag.opcode;
            this.frag = null;
            this.dispatch(op, full);
          }
        }
        continue;
      }

      if (!fin && (opcode === 0x1 || opcode === 0x2)) {
        this.frag = { opcode, chunks: [payload] };
        continue;
      }

      this.dispatch(opcode, payload);
    }
  }

  dispatch(opcode, payload) {
    if (opcode === 0x1) {
      const msg = JSON.parse(payload.toString('utf8'));
      if (msg.id && this.handlers.has(msg.id)) {
        const { resolve, reject } = this.handlers.get(msg.id);
        this.handlers.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    } else if (opcode === 0x8) {
      this.sock.end();
    } else if (opcode === 0x9) {
      this.sendFrame(0xa, payload);
    }
  }

  sendFrame(opcode, payload) {
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([header, mask, masked]));
  }

  send(method, params = {}) {
    const id = ++this.id;
    const body = Buffer.from(JSON.stringify({ id, method, params }), 'utf8');
    this.sendFrame(0x1, body);
    return new Promise((resolve, reject) => {
      this.handlers.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.handlers.has(id)) {
          this.handlers.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 30000);
    });
  }
}

async function main() {
  const [, , cmd, arg] = process.argv;
  const targets = await httpGet('/json/list');
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();

  if (cmd === 'shot') {
    const out = arg || 'shots/cdp.png';
    let res;
    try {
      res = await ws.send('Page.captureScreenshot', { format: 'png', fromSurface: false, captureBeyondViewport: false });
    } catch (_) {
      res = await ws.send('Page.captureScreenshot', { format: 'png' });
    }
    fs.writeFileSync(out, Buffer.from(res.data, 'base64'));
    const size = await ws.send('Runtime.evaluate', {
      expression: 'innerWidth + "x" + innerHeight',
      returnByValue: true
    });
    console.log('saved', out, size.result.value);
  } else if (cmd === 'eval') {
    const res = await ws.send('Runtime.evaluate', {
      expression: arg,
      returnByValue: true,
      awaitPromise: true
    });
    console.log(JSON.stringify(res.result.value, null, 2));
  } else {
    console.log('usage: node tools/_cdp.js shot <file> | eval "<js>"');
  }
  ws.sock.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('ERR', err.message);
  process.exit(1);
});
