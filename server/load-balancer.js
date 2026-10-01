
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import chalk from 'chalk';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
const LB_PORT = parseInt(process.env.LB_PORT || '8000', 10);
const HEALTH_CHECK_INTERVAL_MS = 10_000;
const HEALTH_CHECK_TIMEOUT_MS = 4_000;
const STRATEGY = (process.env.LB_STRATEGY || 'round-robin').toLowerCase();

// Upstream Target Nodes Configuration
// Format in env: UPSTREAMS="http://127.0.0.1:8001,http://127.0.0.1:8002"
const rawUpstreams = process.env.UPSTREAMS 
    ? process.env.UPSTREAMS.split(',').map(s => s.trim()) 
    : [
        'http://127.0.0.1:8001',
        'http://127.0.0.1:8002'
    ];

// Initial Upstream Node Pool State
const nodes = rawUpstreams.map((urlStr, index) => {
    const parsed = new URL(urlStr);
    return {
        id: `node-${index + 1}`,
        url: urlStr,
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        status: 'UNKNOWN', // 'ONLINE' | 'OFFLINE' | 'UNKNOWN'
        activeConnections: 0,
        totalServed: 0,
        failedRequests: 0,
        lastLatencyMs: 0,
        lastHealthCheck: null
    };
});

let roundRobinIndex = 0;

const checkNodeHealth = (node) => {
    return new Promise((resolve) => {
        const client = node.protocol === 'https:' ? https : http;
        const startTime = Date.now();
        
        const req = client.request({
            protocol: node.protocol,
            hostname: node.hostname,
            port: node.port,
            path: '/api/system/diagnostics',
            method: 'GET',
            timeout: HEALTH_CHECK_TIMEOUT_MS,
            headers: { 'User-Agent': 'SmartBarangay-LoadBalancer-HealthCheck/1.0' }
        }, (res) => {
            const latency = Date.now() - startTime;
            node.lastLatencyMs = latency;
            node.lastHealthCheck = new Date().toISOString();

            if (res.statusCode >= 200 && res.statusCode < 400) {
                if (node.status !== 'ONLINE') {
                    console.log(chalk.green(`[LB HEALTH] Node ${node.id} (${node.url}) is now `) + chalk.bgGreen.black.bold(' ONLINE ') + chalk.gray(` (${latency}ms)`));
                }
                node.status = 'ONLINE';
                resolve(true);
            } else {
                if (node.status !== 'OFFLINE') {
                    console.warn(chalk.yellow(`[LB HEALTH] Node ${node.id} (${node.url}) returned HTTP ${res.statusCode} -> `) + chalk.bgRed.white.bold(' OFFLINE '));
                }
                node.status = 'OFFLINE';
                resolve(false);
            }
            res.resume(); // Consume stream
        });

        req.on('timeout', () => {
            req.destroy();
            node.status = 'OFFLINE';
            node.lastHealthCheck = new Date().toISOString();
            resolve(false);
        });

        req.on('error', () => {
            node.status = 'OFFLINE';
            node.lastHealthCheck = new Date().toISOString();
            resolve(false);
        });

        req.end();
    });
};

const runHealthChecks = async () => {
    await Promise.all(nodes.map(checkNodeHealth));
};

const selectNode = (req) => {
    const onlineNodes = nodes.filter(n => n.status === 'ONLINE');
    
    // Fallback: If all are marked offline/unknown, try any node to avoid complete refusal
    const candidatePool = onlineNodes.length > 0 ? onlineNodes : nodes;

    if (candidatePool.length === 0) return null;

    if (STRATEGY === 'least-connections') {
        // Find node with fewest concurrent in-flight requests
        return candidatePool.reduce((prev, curr) => 
            curr.activeConnections < prev.activeConnections ? curr : prev
        , candidatePool[0]);
    }

    if (STRATEGY === 'ip-hash') {
        // Hash client IP to pin requests to the same node
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        let hash = 0;
        for (let i = 0; i < ip.length; i++) {
            hash = ((hash << 5) - hash) + ip.charCodeAt(i);
            hash |= 0;
        }
        const index = Math.abs(hash) % candidatePool.length;
        return candidatePool[index];
    }

    // Default: Round-Robin
    const selected = candidatePool[roundRobinIndex % candidatePool.length];
    roundRobinIndex = (roundRobinIndex + 1) % candidatePool.length;
    return selected;
};

const server = http.createServer((req, res) => {
    // Built-in Load Balancer Health / Status Endpoint
    if (req.url === '/lb/status' || req.url === '/lb/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            loadBalancer: {
                status: 'ONLINE',
                port: LB_PORT,
                strategy: STRATEGY,
                timestamp: new Date().toISOString(),
                totalNodes: nodes.length,
                onlineNodes: nodes.filter(n => n.status === 'ONLINE').length
            },
            upstreams: nodes
        }, null, 2));
    }

    const target = selectNode(req);

    if (!target) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            error: 'Service Unavailable',
            message: 'All backend application instances are currently offline.'
        }));
    }

    // Update Node Counters
    target.activeConnections++;
    target.totalServed++;

    const client = target.protocol === 'https:' ? https : http;

    // Prepare proxy headers
    const proxyHeaders = {
        ...req.headers,
        'x-forwarded-for': (req.headers['x-forwarded-for'] ? `${req.headers['x-forwarded-for']}, ` : '') + req.socket.remoteAddress,
        'x-forwarded-proto': req.socket.encrypted ? 'https' : 'http',
        'x-forwarded-host': req.headers['host'] || '',
        'x-load-balancer': `SmartBarangay-LB/${target.id}`
    };

    const proxyReq = client.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: req.url,
        method: req.method,
        headers: proxyHeaders,
        timeout: 30_000
    }, (proxyRes) => {
        target.activeConnections = Math.max(0, target.activeConnections - 1);
        
        // Pass response headers and status code back to client
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        target.activeConnections = Math.max(0, target.activeConnections - 1);
        target.failedRequests++;
        console.error(chalk.red(`[LB PROXY ERROR] Failed forward to ${target.id} (${target.url}): ${err.message}`));

        if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: 'Bad Gateway',
                message: 'Error communicating with backend cluster node.'
            }));
        }
    });

    proxyReq.on('timeout', () => {
        proxyReq.destroy();
        target.activeConnections = Math.max(0, target.activeConnections - 1);
        target.failedRequests++;

        if (!res.headersSent) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: 'Gateway Timeout',
                message: 'Backend node timed out.'
            }));
        }
    });

    // Stream incoming request body (POST/PUT payloads) to target
    req.pipe(proxyReq);
});

// Start Load Balancer
server.listen(LB_PORT, '0.0.0.0', async () => {
    console.log(chalk.bold.cyan('\n============================================================'));
    console.log(chalk.bold.cyan('  ⚖️  SMART BARANGAY // HTTP REVERSE PROXY LOAD BALANCER'));
    console.log(chalk.bold.cyan('============================================================'));
    console.log(chalk.gray(`  • Listening Port       : `) + chalk.bold.white(LB_PORT));
    console.log(chalk.gray(`  • Balancing Strategy   : `) + chalk.bold.yellow(STRATEGY.toUpperCase()));
    console.log(chalk.gray(`  • Configured Upstreams : `) + chalk.bold.green(nodes.map(n => n.url).join(', ')));
    console.log(chalk.gray(`  • Telemetry Dashboard  : `) + chalk.bold.white(`http://localhost:${LB_PORT}/lb/status`));
    console.log(chalk.bold.cyan('============================================================\n'));

    // Initial health check probe
    await runHealthChecks();

    // Recurring health check loop
    setInterval(runHealthChecks, HEALTH_CHECK_INTERVAL_MS);
});
