
import { useEffect, useRef, useState, useCallback } from 'react';
import { API_BASE_URL } from './api';

export interface RealtimeEvent {
  event: string;
  payload: any;
  timestamp: string;
}

export type RealtimeEventHandler = (payload: any, event: RealtimeEvent) => void;

interface UseRealtimeOptions {
  channels?: string[];
  enabled?: boolean;
  onEvent?: (event: RealtimeEvent) => void;
}

export function useRealtime(options: UseRealtimeOptions = {}) {
  const { channels = ['public'], enabled = true, onEvent } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffDelayRef = useRef(1500); // starts at 1.5s
  const eventListenersRef = useRef<Map<string, Set<RealtimeEventHandler>>>(new Map());
  const onEventCallbackRef = useRef(onEvent);
  onEventCallbackRef.current = onEvent;

  // Resolve WebSocket Gateway URL
  const getWsUrl = useCallback(() => {
    const channelQuery = channels.map(c => `channel=${encodeURIComponent(c)}`).join('&');

    try {
      let base = API_BASE_URL;
      if (!base) {
        const isHttps = window.location.protocol === 'https:';
        base = `${isHttps ? 'https' : 'http'}://${window.location.host}`;
      }
      
      const parsed = new URL(base, window.location.href);
      const wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      // host contains hostname and port (e.g. localhost:8080), without any path segments like /api
      const host = parsed.host;
      return `${wsProto}//${host}/ws?${channelQuery}`;
    } catch {
      const isHttps = window.location.protocol === 'https:';
      const wsProto = isHttps ? 'wss:' : 'ws:';
      return `${wsProto}//${window.location.host}/ws?${channelQuery}`;
    }
  }, [channels]);

  // Subscribe to specific event type
  const subscribe = useCallback((eventName: string, handler: RealtimeEventHandler) => {
    if (!eventListenersRef.current.has(eventName)) {
      eventListenersRef.current.set(eventName, new Set());
    }
    eventListenersRef.current.get(eventName)!.add(handler);

    return () => {
      eventListenersRef.current.get(eventName)?.delete(handler);
    };
  }, []);

  // Send client message
  const send = useCallback((data: object) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let isMounted = true;

    const connect = () => {
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

      try {
        const url = getWsUrl();
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isMounted) return;
          setIsConnected(true);
          backoffDelayRef.current = 1500; // reset backoff
          console.log('[REALTIME] Connected to Smart Barangay Live Gateway.');
        };

        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);

            // Handle server ping / connection acks
            if (data.type === 'CONNECTED' || data.type === 'PONG') return;

            if (data.event) {
              const realtimeMsg: RealtimeEvent = {
                event: data.event,
                payload: data.payload,
                timestamp: data.timestamp || new Date().toISOString()
              };

              setLastEvent(realtimeMsg);

              if (onEventCallbackRef.current) {
                onEventCallbackRef.current(realtimeMsg);
              }

              // Dispatch to registered event listeners
              const listeners = eventListenersRef.current.get(data.event);
              if (listeners) {
                listeners.forEach(fn => fn(data.payload, realtimeMsg));
              }

              // Also dispatch to wildcard '*' listeners
              const wildcardListeners = eventListenersRef.current.get('*');
              if (wildcardListeners) {
                wildcardListeners.forEach(fn => fn(data.payload, realtimeMsg));
              }
            }
          } catch (err) {
            // Ignore non-JSON frames
          }
        };

        ws.onclose = () => {
          if (!isMounted) return;
          setIsConnected(false);
          wsRef.current = null;

          // Exponential backoff reconnect (max 15s)
          const delay = backoffDelayRef.current;
          backoffDelayRef.current = Math.min(delay * 1.5, 15_000);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            if (isMounted) connect();
          }, delay);
        };

        ws.onerror = () => {
          // Handled via onclose
        };
      } catch (err) {
        if (isMounted) {
          reconnectTimeoutRef.current = setTimeout(connect, 3000);
        }
      }
    };

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enabled, getWsUrl]);

  return {
    isConnected,
    lastEvent,
    subscribe,
    send
  };
}
