import Constants from 'expo-constants';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

const extra = Constants.expoConfig?.extra as { wsUrl?: string } | undefined;
const WS_URL = extra?.wsUrl ?? 'http://localhost:8080/ws';

export function subscribeAvailability(courtId: number, date: string, onMessage: () => void) {
  const client = new Client({
    webSocketFactory: () => new SockJS(WS_URL) as WebSocket,
    reconnectDelay: 5000,
    onConnect: () => {
      client.subscribe(`/topic/availability/${courtId}/${date}`, onMessage);
    }
  });

  client.activate();
  return () => client.deactivate();
}
