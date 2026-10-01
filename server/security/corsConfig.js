/**
 * Unified CORS & Cross-Origin Configuration
 * Protects APIs while seamlessly permitting local development, LAN/VM penetration testing,
 * and production deployments across Cloudflare Pages and Render.
 */

const ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:8080',
    'http://127.0.0.1:8080'
];

const CLOUDFLARE_DOMAINS = [
    'barangay-eng-shill.pages.dev',
    'barangay-engineer-s-hill.pages.dev',
    'barangay-engineers-hill.pages.dev',
];

/**
 * Checks whether the incoming hostname belongs to local loopback,
 * private LAN, or VM subnets (VirtualBox, VMware, WSL, Kali).
 */
const isPrivateNetworkHost = (host) => {
    // 127.0.0.0/8 (Loopback)
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    // 10.0.0.0/8 (Private / VM NAT)
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    // 172.16.0.0/12 (Docker / Private)
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    // 192.168.0.0/16 (LAN / VirtualBox Host-Only)
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    // 169.254.0.0/16 (Link-local)
    if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;

    // Local / Dev hostnames
    if (
        host === 'localhost' ||
        host === '0.0.0.0' ||
        host === '[::1]' ||
        host.endsWith('.local') ||
        host.endsWith('.lan') ||
        host.endsWith('.internal')
    ) {
        return true;
    }

    return false;
};

/**
 * Comprehensive origin validator.
 */
export const isAllowedOrigin = (origin) => {
    // Non-browser clients (curl, Postman, Burp Repeater without Origin header, mobile)
    if (!origin) return true;

    try {
        const u = new URL(origin);
        const host = u.hostname;

        // 1. Direct match with static allowed origins list
        if (ALLOWED_ORIGINS.includes(origin)) return true;

        // 2. Private LAN / VM / Localhost networks (Kali Linux, VirtualBox, LAN devices)
        if (isPrivateNetworkHost(host)) return true;

        // 3. Cloudflare Pages production & preview deployments
        if (CLOUDFLARE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return true;

        // 4. Any Pages.dev and Render deployment subdomains
        if (host.endsWith('.pages.dev') || host.endsWith('.onrender.com')) return true;

        // 5. Explicitly specified origins from environment variable (comma-delimited)
        if (process.env.ALLOWED_ORIGINS) {
            const envOrigins = process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
            if (envOrigins.includes(origin) || envOrigins.includes(host)) return true;
        }

        // 6. In non-production, allow tunnel/proxy testing domains (ngrok, localtunnel)
        if (process.env.NODE_ENV !== 'production') {
            if (host.endsWith('.ngrok-free.app') || host.endsWith('.ngrok.io') || host.endsWith('.loca.lt')) {
                return true;
            }
        }
    } catch {
        return false;
    }

    return false;
};

export const corsOptions = {
    origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) {
            callback(null, true);
        } else {
            console.warn(`[CORS REJECTED]: Origin ${origin} not permitted.`);
            // Using callback(null, false) allows CORS middleware to naturally decline
            // without raising an unhandled exception that causes Express to respond with 500.
            callback(null, false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'x-user-role',
        'x-resident-id',
        'X-XSRF-TOKEN',
        'X-Requested-With',
        'Accept',
        'Origin',
        'Cache-Control',
        'Pragma',
        'X-Trace-Id',
        'baguio-client-version',
        'baguio-client-app'
    ],
    exposedHeaders: ['X-Trace-Id', 'Retry-After', 'Content-Disposition', 'X-Total-Count'],
    optionsSuccessStatus: 200
};
