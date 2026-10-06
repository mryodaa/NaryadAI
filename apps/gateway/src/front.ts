// WebSocket для интерфейса (/ws): снимок двойника, лента входящих, состояние источников.
import type { WebSocket } from 'ws';
import type { ServerMessage } from '@allur/contracts';

export class FrontHub {
  private clients = new Set<WebSocket>();

  add(socket: WebSocket, initial: ServerMessage[]) {
    this.clients.add(socket);
    for (const m of initial) socket.send(JSON.stringify(m));
    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => this.clients.delete(socket));
  }

  get size() {
    return this.clients.size;
  }

  broadcast(msg: ServerMessage) {
    if (this.clients.size === 0) return;
    const data = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.readyState === 1 && c.bufferedAmount < 2_000_000) c.send(data);
    }
  }
}
