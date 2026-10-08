// Живое состояние из WebSocket /ws: снимок двойника, лента входящих, источники.
import { create } from 'zustand';
import type { BodyView, CrewView, FeedItem, LiveSnapshot, ServerMessage, SourceStatus } from '@allur/contracts/ref';
import { setConnections, setPlantConfig } from './plant';

type Conn = 'connecting' | 'open' | 'closed';

interface LiveState {
  conn: Conn;
  booting: string | null;
  snapshot: LiveSnapshot | null;
  feed: FeedItem[];
  sources: SourceStatus[];
  /** Кузова в цехе по трекеру двойника (раз в секунду) */
  bodies: BodyView[];
  /** Рабочее место мастера: сигналы, журнал, запросы */
  crew: CrewView | null;
  lastMessageAt: number;
}

export const useLive = create<LiveState>(() => ({
  conn: 'connecting',
  booting: null,
  snapshot: null,
  feed: [],
  sources: [],
  bodies: [],
  crew: null,
  lastMessageAt: 0,
}));

let socket: WebSocket | null = null;
let retry = 0;
/** Первая лента после подключения — последние сообщения целиком; дальше приходят только новые */
let feedFresh = true;

export function connectLive() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  feedFresh = true;
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
      case 'feed': {
        // начальная лента и первая рассылка после подключения могут пересекаться — без повторов
        const base = feedFresh ? [] : useLive.getState().feed;
        feedFresh = false;
        const seen = new Set(base.map((f) => f.id));
        useLive.setState({ feed: [...base, ...msg.items.filter((f) => !seen.has(f.id))].slice(-200), lastMessageAt: now });
        break;
      }
      case 'sources':
        useLive.setState({ sources: msg.items, lastMessageAt: now });
        break;
      case 'plant':
        setPlantConfig(msg.config);
        break;
      case 'connections':
        setConnections(msg.items);
        break;
      case 'bodies':
        useLive.setState({ bodies: msg.items });
        break;
      case 'crew':
        useLive.setState({ crew: msg.data });
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
