// ================================================================================================
// UTILS.JS - HELPER FUNCTIONS (UPDATED FOR SAFE SANITIZATION + IMPROVEMENTS)
// ================================================================================================

// Escape HTML so it's safe to insert via innerHTML
export function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"'\/]/g, function (s) {
        return ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '/': '&#x2F;'
        })[s];
    });
}

// Sanitize HTML (alias to escapeHTML) - returns a string safe for innerHTML
export function sanitizeHTML(str) {
    return escapeHTML(str);
}

// Sanitize user input for free-text fields (strip obvious dangerous pieces)
// This client-side sanitization reduces attack surface; ALWAYS validate again on the server.
export function sanitizeInput(str, maxLength = 1000) {
    if (str === null || str === undefined) return '';
    let s = String(str).trim().substring(0, maxLength);

    // Remove angle brackets
    s = s.replace(/[<>]/g, '');

    // Remove javascript: pseudo-protocol
    s = s.replace(/javascript:/gi, '');

    // Remove inline handlers like onmouseover="..." or onload='...'
    s = s.replace(/on\w+\s*=\s*(['"]).*?\1/gi, '');

    // Remove unprintable/control characters
    s = s.replace(/[\x00-\x1F\x7F]/g, '');

    return s;
}

// Validate email format
export function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254;
}

// ✅ FIX: Completely rewritten showMessage to support both signatures
// Can be called as: showMessage('text', 'type') OR showMessage(element, 'text', 'type')
export function showMessage(arg1, arg2, arg3, arg4) {
    let container, message, type, duration;
    
    // Detect which signature is being used
    if (typeof arg1 === 'string' && (typeof arg2 === 'string' || arg2 === undefined)) {
        // Called as: showMessage(message, type, duration)
        // Auto-create or find a global message container
        container = document.getElementById('globalMessageContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'globalMessageContainer';
            container.className = 'msg-box';
            container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                max-width: 400px;
                padding: 12px 20px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 10000;
                font-size: 14px;
                transition: opacity 0.3s ease;
            `;
            document.body.appendChild(container);
        }
        message = arg1;
        type = arg2 || 'info';
        duration = typeof arg3 === 'number' ? arg3 : 4000;
    } else {
        // Called as: showMessage(container, message, type, duration)
        container = arg1;
        message = arg2;
        type = arg3 || 'info';
        duration = typeof arg4 === 'number' ? arg4 : 4000;
    }
    
    // Validate container is a DOM element
    if (!container || !(container instanceof Element)) {
        console.error('showMessage: Invalid container element');
        return;
    }
    
    container.textContent = message;
    container.style.display = 'block';
    container.style.opacity = '1';

    // Ensure the base class and the type class are present; remove other type classes
    container.classList.add('msg-box', type);
    ['info', 'success', 'error', 'warning'].forEach(t => {
        if (t !== type) container.classList.remove(t);
    });
    
    // Apply color based on type
    const colors = {
        success: { bg: '#10b981', text: 'white' },
        error: { bg: '#ef4444', text: 'white' },
        warning: { bg: '#f59e0b', text: 'white' },
        info: { bg: '#3b82f6', text: 'white' }
    };
    
    const color = colors[type] || colors.info;
    container.style.backgroundColor = color.bg;
    container.style.color = color.text;

    // ✅ FIX: Clear previous timeout to prevent premature clearing
    if (container._messageTimeout) {
        clearTimeout(container._messageTimeout);
    }

    if (duration > 0) {
        // ✅ FIX: Store current message text for accurate comparison
        const currentMessage = message;
        container._messageTimeout = setTimeout(() => {
            // Only clear if the message hasn't changed
            if (container.textContent === currentMessage) {
                container.style.opacity = '0';
                setTimeout(() => {
                    if (container.textContent === currentMessage) {
                        container.textContent = '';
                        container.style.display = 'none';
                        container.classList.remove(type);
                    }
                }, 300); // Match opacity transition
            }
        }, duration);
    }
}

// ✅ FIX: Improved parseTimeForSorting with better range handling
export function parseTimeForSorting(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 0;

    // Normalize spaces around dash: "10am - 12pm" or "10am-12pm" -> consistent format
    const normalized = timeStr.replace(/\s*-\s*/g, '-').trim();
    
    // Take the first part before any dash, e.g. "10am-12pm" -> "10am"
    const firstPart = normalized.split('-')[0].trim().toLowerCase();

    // Match patterns like "10", "10am", "10:30", "10:30am", "10:30 am"
    const m = firstPart.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!m) return 0;

    let hour = Number(m[1]);
    const minutes = m[2] ? Number(m[2]) : 0;
    const period = m[3] ? m[3].toLowerCase() : null; // "am" or "pm" or null

    if (Number.isNaN(hour) || Number.isNaN(minutes)) return 0;

    // Validate ranges
    if (hour < 0 || hour > 23 || minutes < 0 || minutes > 59) return 0;

    // Handle 12-hour format conversion
    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;

    return hour * 60 + minutes;
}

// Map HTTP status codes to friendly error messages
export function getErrorMessage(status, defaultMsg = 'An error occurred') {
    switch (status) {
        case 400: return 'Bad request. Please try again.';
        case 401: return 'Unauthorized access.';
        case 403: return 'Forbidden. You do not have permission.';
        case 404: return 'Resource not found.';
        case 409: return 'Booking conflict. Please try again.';
        case 429: return 'Too many requests. Please wait a moment.';
        case 500: return 'Internal server error. Please try later.';
        case 502: return 'Bad gateway. Server unreachable.';
        case 503: return 'Service unavailable. Try again later.';
        default: return defaultMsg;
    }
}

// Debounce function to limit rapid function calls
export function debounce(func, wait = 300) {
    let timeout;
    return function (...args) {
        const ctx = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(ctx, args), wait);
    };
}

// Deep clone an object (uses structuredClone if available)
export function deepClone(obj) {
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(obj);
        } catch (e) {
            // fallback to JSON below
        }
    }
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch (e) {
        // fallback shallow copy
        if (obj && typeof obj === 'object') return Object.assign(Array.isArray(obj) ? [] : {}, obj);
        return obj;
    }
}

// Check if an element is visible in viewport
export function isElementInViewport(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
}

// Simple delay / sleep
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Format number with commas using locale
export function formatNumber(num) {
    const n = Number(num);
    if (Number.isNaN(n)) return String(num);
    return n.toLocaleString();
}

// ✅ FIX: Improved date validation with better error handling
export function isValidDate(dateStr) {
    if (!dateStr) return false;
    
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;

        // Strict check for ISO date (YYYY-MM-DD)
        const isoMatch = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) {
            const y = Number(isoMatch[1]);
            const m = Number(isoMatch[2]);
            const day = Number(isoMatch[3]);
            
            // Validate month and day ranges
            if (m < 1 || m > 12 || day < 1 || day > 31) return false;
            
            return d.getUTCFullYear() === y && (d.getUTCMonth() + 1) === m && d.getUTCDate() === day;
        }

        return true;
    } catch (e) {
        return false;
    }
}

// Generate a random ID (for slots or temporary elements)
export function generateRandomId(prefix = 'id') {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// ✅ NEW: Helper to safely get element by ID with error logging
export function getElementByIdSafe(id) {
    const el = document.getElementById(id);
    if (!el) {
        console.warn(`Element with ID "${id}" not found in DOM`);
    }
    return el;
}

// ✅ NEW: Helper to validate phone numbers (basic)
export function isValidPhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    // Remove common formatting characters
    const cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
    // Check if it's 10-15 digits
    return /^\+?\d{10,15}$/.test(cleaned);
}
