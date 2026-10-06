// Живое состояние из WebSocket /ws: снимок двойника, лента входящих, источники.
import { create } from 'zustand';
import type { FeedItem, LiveSnapshot, ServerMessage, SourceStatus } from '@allur/contracts/ref';

type Conn = 'connecting' | 'open' | 'closed';

interface LiveState {
  conn: Conn;
  booting: string | null;
  snapshot: LiveSnapshot | null;
  feed: FeedItem[];
  sources: SourceStatus[];
  lastMessageAt: number;
}

export const useLive = create<LiveState>(() => ({
  conn: 'connecting',
  booting: null,
  snapshot: null,
  feed: [],
  sources: [],
  lastMessageAt: 0,
}));

let socket: WebSocket | null = null;
let retry = 0;

export function connectLive() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  useLive.setState({ conn: 'connecting' });
  socket.onopen = () => {
    retry = 0;
    useLive.setState({ conn: 'open' });
  };
  socket.onmessage = (ev) => {
    const msg = JSON.parse(ev.data as string) as ServerMessage;
    const now = Date.now();
    switch (msg.t) {
      case 'snapshot':
        useLive.setState({ snapshot: msg.data, booting: null, lastMessageAt: now });
        break;
      case 'booting':
        useLive.setState({ booting: msg.message, lastMessageAt: now });
        break;
      case 'feed':
        useLive.setState((s) => ({ feed: [...s.feed, ...msg.items].slice(-200), lastMessageAt: now }));
        break;
      case 'sources':
        useLive.setState({ sources: msg.items, lastMessageAt: now });
        break;
    }
  };
  socket.onclose = () => {
    useLive.setState({ conn: 'closed' });
    socket = null;
    // бесплатный хостинг просыпается до минуты — переподключаемся с нарастающей паузой
    const delay = Math.min(10_000, 500 * 2 ** retry++);
    setTimeout(connectLive, delay);
  };
  socket.onerror = () => socket?.close();
}
