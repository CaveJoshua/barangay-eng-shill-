
import { WebSocketServer, WebSocket } from 'ws';
import chalk from 'chalk';

let wss = null;
const HEARTBEAT_INTERVAL_MS = 30_000;

// Client connection metadata storage
const clientChannels = new Map(); // ws -> Set of channel strings

/**
 * Initializes and mounts WebSocket Server on the HTTP Server instance.
 * @param {import('http').Server} httpServer
 */
export const initWebSocketServer = (httpServer) => {
    wss = new WebSocketServer({ 
        noServer: true
    });

    console.log(chalk.bold.cyan('  ⚡ [WEBSOCKET] Real-Time Engine mounted on /ws & /api/ws'));

    httpServer.on('upgrade', (request, socket, head) => {
        try {
            const parsedUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
            const pathname = parsedUrl.pathname;
            
            if (pathname === '/ws' || pathname === '/api/ws' || pathname.startsWith('/ws') || pathname.startsWith('/api/ws')) {
                wss.handleUpgrade(request, socket, head, (ws) => {
                    wss.emit('connection', ws, request);
                });
            } else {
                socket.destroy();
            }
        } catch (err) {
            socket.destroy();
        }
    });

    wss.on('connection', (ws, req) => {
        ws.isAlive = true;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        // Parse initial channels from URL query if provided: /ws?channel=admin&channel=resident_123
        const url = new URL(req.url, 'http://localhost');
        const queryChannels = url.searchParams.getAll('channel');
        
        const channels = new Set(queryChannels.length > 0 ? queryChannels : ['public']);
        clientChannels.set(ws, channels);

        // Heartbeat response
        ws.on('pong', () => {
            ws.isAlive = true;
        });

        // Client Message Handler (subscribe/unsubscribe/ping)
        ws.on('message', (messageRaw) => {
            try {
                const data = JSON.parse(messageRaw.toString());

                if (data.type === 'SUBSCRIBE' && data.channel) {
                    const current = clientChannels.get(ws) || new Set(['public']);
                    current.add(data.channel);
                    clientChannels.set(ws, current);
                    ws.send(JSON.stringify({ type: 'SUBSCRIBED', channel: data.channel }));
                } else if (data.type === 'UNSUBSCRIBE' && data.channel) {
                    const current = clientChannels.get(ws);
                    if (current) {
                        current.delete(data.channel);
                        clientChannels.set(ws, current);
                    }
                } else if (data.type === 'PING') {
                    ws.send(JSON.stringify({ type: 'PONG', timestamp: new Date().toISOString() }));
                }
            } catch {
                // Ignore malformed client frames
            }
        });

        ws.on('close', () => {
            clientChannels.delete(ws);
        });

        ws.on('error', (err) => {
            console.error(chalk.red(`[WEBSOCKET ERROR] Client (${ip}): ${err.message}`));
            clientChannels.delete(ws);
        });

        // Send connection acknowledgment
        ws.send(JSON.stringify({
            type: 'CONNECTED',
            message: 'Connected to Smart Barangay Realtime Gateway',
            timestamp: new Date().toISOString(),
            channels: Array.from(channels)
        }));
    });

    // Proactive Heartbeat Interval to detect & terminate dropped connections
    const heartbeatTimer = setInterval(() => {
        if (!wss) return;
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                clientChannels.delete(ws);
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, HEARTBEAT_INTERVAL_MS);

    wss.on('close', () => {
        clearInterval(heartbeatTimer);
    });

    return wss;
};

/**
 * Broadcasts an event to all connected clients or specific channel subscribers.
 * @param {string} event - Event name (e.g. 'NEW_NOTIFICATION', 'BADGE_UPDATE', 'DOCUMENT_STATUS_UPDATE')
 * @param {object} payload - Event data payload
 * @param {string|null} targetChannel - Optional channel filter (e.g. 'admin', 'resident_123')
 */
export const broadcastRealtimeEvent = (event, payload = {}, targetChannel = null) => {
    if (!wss) return;

    const message = JSON.stringify({
        event,
        payload,
        timestamp: new Date().toISOString()
    });

    let sentCount = 0;

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            if (!targetChannel) {
                // Global broadcast to all clients
                client.send(message);
                sentCount++;
            } else {
                // Targeted channel broadcast
                const channels = clientChannels.get(client);
                if (channels && (channels.has(targetChannel) || channels.has('all'))) {
                    client.send(message);
                    sentCount++;
                }
            }
        }
    });

    return sentCount;
};

/**
 * Helper to get currently active connected WebSocket clients count.
 */
export const getActiveWebSocketClientsCount = () => {
    if (!wss) return 0;
    return wss.clients.size;
};
