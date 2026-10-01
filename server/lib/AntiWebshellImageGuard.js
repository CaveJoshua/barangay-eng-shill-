
import chalk from 'chalk';
import crypto from 'crypto';

// Standard Binary Magic Bytes
const MAGIC_SIGNATURES = {
    PNG:   [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
    JPEG:  [0xFF, 0xD8, 0xFF],
    GIF87: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
    GIF89: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
    WEBP_RIFF: [0x52, 0x49, 0x46, 0x46],        // RIFF
    WEBP_TAG:  [0x57, 0x45, 0x42, 0x50],        // WEBP at offset 8
};

// Structural Server-Side Execution Patterns
const SCRIPT_INJECTION_PATTERNS = [
    /<\?php/i,
    /<\?=/i,
    /<script\s+language\s*=\s*["']?php["']?/i,
    /\b(eval|assert|passthru|shell_exec|exec|system|popen|proc_open|pcntl_exec)\s*\(/i,
    /\b(base64_decode|gzinflate|gzuncompress|str_rot13)\s*\(/i,
    /\$_(GET|POST|REQUEST|COOKIE|SERVER|FILES|ENV)\[/i,
    /\b(php:\/\/filter|php:\/\/input|phar:\/\/|data:\/\/text|zip:\/\/)/i,
    /auto_prepend_file|auto_append_file|allow_url_include/i,
    /\bchmod\s*\(.*0777\)/i,
    /\bcreate_function\s*\(/i,
    /\bcall_user_func(_array)?\s*\(/i
];

// Dangerous SVG Elements and Event Handlers
const SVG_THREAT_PATTERNS = [
    /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
    /<foreignobject[\s\S]*?>[\s\S]*?<\/foreignobject>/gi,
    /<object[\s\S]*?>[\s\S]*?<\/object>/gi,
    /<embed[\s\S]*?>[\s\S]*?<\/embed>/gi,
    /<applet[\s\S]*?>[\s\S]*?<\/applet>/gi,
    /<!ENTITY/gi,
    /<!DOCTYPE/gi,
    /SYSTEM\s+["'][^"']+["']/gi,
    /\bon\w+\s*=\s*["'][^"']*["']/gi, // onload, onerror, onclick, etc.
    /href\s*=\s*["']javascript:[^"']*["']/gi,
    /xlink:href\s*=\s*["']javascript:[^"']*["']/gi,
    /url\s*\(\s*["']?javascript:/gi
];

// Dangerous Executable File Extensions
const FORBIDDEN_EXTENSIONS = new Set([
    'php', 'php3', 'php4', 'php5', 'php7', 'phtml', 'phar', 'inc',
    'asp', 'aspx', 'jsp', 'jspx', 'cgi', 'pl', 'py', 'sh', 'bash',
    'exe', 'dll', 'so', 'bat', 'cmd', 'ps1', 'vbs', 'htaccess', 'user.ini'
]);

/**
 * Validates file extension and rejects double-extension attacks (e.g. image.php.png)
 */
export const validateFileExtension = (filename = '') => {
    if (!filename) return { valid: true };

    const clean = filename.toLowerCase().trim();
    const parts = clean.split('.');

    if (parts.length > 1) {
        for (let i = 1; i < parts.length; i++) {
            const ext = parts[i].trim();
            if (FORBIDDEN_EXTENSIONS.has(ext)) {
                return {
                    valid: false,
                    reason: `MALICIOUS_EXTENSION_DETECTED: Forbidden executable extension .${ext} in filename "${filename}"`
                };
            }
        }
    }

    return { valid: true };
};

/**
 * Checks magic byte sequence for binary image buffer
 */
export const checkMagicBytes = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
        return { valid: false, format: 'UNKNOWN', reason: 'BUFFER_TOO_SMALL' };
    }

    // 1. Check PNG
    let isPng = true;
    for (let i = 0; i < MAGIC_SIGNATURES.PNG.length; i++) {
        if (buffer[i] !== MAGIC_SIGNATURES.PNG[i]) {
            isPng = false;
            break;
        }
    }
    if (isPng) return { valid: true, format: 'image/png' };

    // 2. Check JPEG
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return { valid: true, format: 'image/jpeg' };
    }

    // 3. Check GIF
    const gifHeader = buffer.subarray(0, 6).toString('ascii');
    if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
        return { valid: true, format: 'image/gif' };
    }

    // 4. Check WebP
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    if (riff === 'RIFF' && webp === 'WEBP') {
        return { valid: true, format: 'image/webp' };
    }

    // 5. Check SVG (Text-based image)
    const textSample = buffer.subarray(0, 512).toString('utf8').trim().toLowerCase();
    if (textSample.includes('<svg') || (textSample.includes('<?xml') && textSample.includes('<svg'))) {
        return { valid: true, format: 'image/svg+xml' };
    }

    return { valid: false, format: 'UNKNOWN', reason: 'INVALID_MAGIC_BYTES' };
};

/**
 * Deep payload scanner for script injection signatures inside binary or base64 data
 */
export const scanForScriptInjection = (bufferOrString) => {
    let rawText = '';

    if (Buffer.isBuffer(bufferOrString)) {
        rawText = bufferOrString.toString('binary') + '\n' + bufferOrString.toString('utf8', 0, Math.min(bufferOrString.length, 1024 * 1024));
    } else if (typeof bufferOrString === 'string') {
        rawText = bufferOrString;
    }

    for (const pattern of SCRIPT_INJECTION_PATTERNS) {
        if (pattern.test(rawText)) {
            return {
                infected: true,
                reason: `SCRIPT_INJECTION_MATCHED: Found server-side executable pattern`
            };
        }
    }

    return { infected: false };
};

/**
 * Sanitizes SVG content by neutralizing all scripts, external entities, and event handlers
 */
export const sanitizeSvgContent = (svgString) => {
    let sanitized = svgString;

    for (const pattern of SVG_THREAT_PATTERNS) {
        sanitized = sanitized.replace(pattern, '');
    }

    return sanitized;
};

/**
 * MASTER INSPECTION ENGINE: Inspects, validates, and neutralizes Base64 or Binary image uploads
 * 
 * @param {string | Buffer} fileInput - Base64 Data URI or raw Buffer
 * @param {string} [originalFilename] - Original uploaded filename
 * @returns {{ safe: boolean, reason?: string, sanitizedData?: string | Buffer }}
 */
export const inspectAndSanitizeImage = (fileInput, originalFilename = '') => {
    // 1. Filename validation
    if (originalFilename) {
        const extCheck = validateFileExtension(originalFilename);
        if (!extCheck.valid) {
            console.error(chalk.red.bold(`[ANTI-WEBSHELL ALERT] ${extCheck.reason}`));
            return { safe: false, reason: extCheck.reason };
        }
    }

    if (!fileInput) {
        return { safe: true, sanitizedData: fileInput };
    }

    let buffer;
    let isDataUri = false;

    if (typeof fileInput === 'string') {
        if (fileInput.startsWith('http://') || fileInput.startsWith('https://')) {
            // Already hosted image URL
            return { safe: true, sanitizedData: fileInput };
        }

        if (fileInput.startsWith('data:image/')) {
            isDataUri = true;
            const matches = fileInput.match(/^data:([a-zA-Z0-9\/+-]+);base64,(.+)$/);
            if (!matches) {
                return { safe: false, reason: 'MALFORMED_DATA_URI: Invalid Base64 image structure' };
            }
            buffer = Buffer.from(matches[2], 'base64');
        } else {
            // Raw base64 or string
            buffer = Buffer.from(fileInput, 'base64');
        }
    } else if (Buffer.isBuffer(fileInput)) {
        buffer = fileInput;
    } else {
        return { safe: false, reason: 'UNSUPPORTED_PAYLOAD_TYPE' };
    }

    // 2. Validate Magic Bytes Header
    const magicCheck = checkMagicBytes(buffer);
    if (!magicCheck.valid) {
        console.warn(chalk.red(`[IMAGE_SECURITY] Header inspection failed: ${magicCheck.reason}`));
        return { safe: false, reason: `MAGIC_BYTE_MISMATCH: Payload is not a valid image format` };
    }

    // 3. Scan for Embedded Server Scripts / Polyglots
    const scriptCheck = scanForScriptInjection(buffer);
    if (scriptCheck.infected) {
        console.error(chalk.bgRed.white.bold(` [CRITICAL SCRIPT INJECTION INTERCEPTED] `));
        return {
            safe: false,
            reason: `SECURITY_BLOCK: Malicious server-side executable payload detected inside image stream.`
        };
    }

    // 4. If SVG, perform deep sanitization against XSS & XXE
    if (magicCheck.format === 'image/svg+xml') {
        const rawSvg = buffer.toString('utf8');
        const sanitizedSvg = sanitizeSvgContent(rawSvg);
        const newBuffer = Buffer.from(sanitizedSvg, 'utf8');

        if (isDataUri) {
            return { safe: true, sanitizedData: `data:image/svg+xml;base64,${newBuffer.toString('base64')}` };
        }
        return { safe: true, sanitizedData: newBuffer };
    }

    return { safe: true, sanitizedData: fileInput };
};
