// ================================================================================================
// CONFIG.JS - APPLICATION CONFIGURATION (UPDATED FOR PHONE-BASED SIGNUP + FIXES)
// ================================================================================================

export const API_URL = "/api/signup";

export const CONFIG = {
    MAX_SLOTS_PER_BOOKING: 10,
    MAX_NAME_LENGTH: 100,
    MAX_EMAIL_LENGTH: 254,
    MAX_PHONE_LENGTH: 20,
    MAX_NOTES_LENGTH: 500,
    MAX_CATEGORY_LENGTH: 50,   // ✅ FIX: Increased from 20 to 50 to match signup.js
    API_COOLDOWN: 5000,        // 5 seconds - prevents rapid repeat submissions
    RETRY_DELAY: 3000,         // 3 seconds - delay before retry
    CLIENT_CACHE_TTL: 30000,   // 30 seconds - cache duration for slot data
    MESSAGE_DURATION: 4000,    // 4 seconds - default message display duration
    SUCCESS_REDIRECT_DELAY: 1500, // 1.5 seconds - delay before redirecting after success
};

// ✅ FIX: Validate configuration on load
(function validateConfig() {
    const requiredNumbers = [
        'MAX_SLOTS_PER_BOOKING',
        'MAX_NAME_LENGTH',
        'MAX_EMAIL_LENGTH',
        'MAX_PHONE_LENGTH',
        'MAX_NOTES_LENGTH',
        'MAX_CATEGORY_LENGTH',
        'API_COOLDOWN',
        'RETRY_DELAY',
        'CLIENT_CACHE_TTL'
    ];
    
    for (const key of requiredNumbers) {
        if (typeof CONFIG[key] !== 'number' || CONFIG[key] <= 0) {
            console.error(`Invalid config value for ${key}: ${CONFIG[key]}`);
            throw new Error(`Configuration error: ${key} must be a positive number`);
        }
    }
    
    // Validate specific constraints
    if (CONFIG.MAX_EMAIL_LENGTH > 254) {
        console.warn('MAX_EMAIL_LENGTH exceeds RFC 5321 limit (254). Setting to 254.');
        CONFIG.MAX_EMAIL_LENGTH = 254;
    }
    
    if (CONFIG.MAX_SLOTS_PER_BOOKING < 1 || CONFIG.MAX_SLOTS_PER_BOOKING > 50) {
        console.error('MAX_SLOTS_PER_BOOKING should be between 1 and 50');
    }
    
    console.log('✅ Configuration validated successfully');
})();

// ================================================================================================
// STATE MANAGEMENT
// ================================================================================================

export let selectedSlots = [];
export let lastApiCall = 0;
export let isSubmitting = false;

export const API_CACHE = {
    data: null,
    timestamp: 0,
    TTL: CONFIG.CLIENT_CACHE_TTL
};

// ================================================================================================
// STATE UPDATE FUNCTIONS (WITH VALIDATION)
// ================================================================================================

/**
 * Update selected slots array in a reference-safe way
 * @param {Array} newSlots - Array of slot objects with {id, date, label}
 */
export function updateSelectedSlots(newSlots) {
    // ✅ FIX: Validate input
    if (!Array.isArray(newSlots)) {
        console.error('updateSelectedSlots: newSlots must be an array');
        return;
    }
    
    // ✅ FIX: Validate slot objects
    const validSlots = newSlots.filter(slot => {
        if (!slot || typeof slot !== 'object') return false;
        if (!slot.id || !slot.date || !slot.label) {
            console.warn('Invalid slot object:', slot);
            return false;
        }
        return true;
    });
    
    // ✅ FIX: Enforce max slots limit
    if (validSlots.length > CONFIG.MAX_SLOTS_PER_BOOKING) {
        console.warn(`Too many slots (${validSlots.length}). Limiting to ${CONFIG.MAX_SLOTS_PER_BOOKING}`);
        validSlots.splice(CONFIG.MAX_SLOTS_PER_BOOKING);
    }
    
    // Clear and update using reference-safe mutation
    selectedSlots.length = 0;
    selectedSlots.push(...validSlots);
    
    // ✅ NEW: Trigger custom event for reactive updates
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('slotsUpdated', { 
            detail: { slots: [...selectedSlots] } 
        }));
    }
    
    console.log(`✅ Selected slots updated: ${selectedSlots.length} slot(s)`);
}

/**
 * Update last API call timestamp
 * @param {number} timestamp - Unix timestamp in milliseconds
 */
export function updateLastApiCall(timestamp) {
    // ✅ FIX: Validate timestamp
    if (typeof timestamp !== 'number' || timestamp < 0) {
        console.error('updateLastApiCall: Invalid timestamp');
        return;
    }
    
    lastApiCall = timestamp;
}

/**
 * Update submission state
 * @param {boolean} status - True if submitting, false otherwise
 */
export function updateIsSubmitting(status) {
    // ✅ FIX: Validate boolean
    if (typeof status !== 'boolean') {
        console.error('updateIsSubmitting: Status must be boolean');
        return;
    }
    
    isSubmitting = status;
    
    // ✅ NEW: Dispatch event for UI updates
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('submittingStateChanged', { 
            detail: { isSubmitting: status } 
        }));
    }
}

// ================================================================================================
// CACHE MANAGEMENT HELPERS
// ================================================================================================

/**
 * Invalidate API cache completely
 */
export function invalidateCache() {
    API_CACHE.data = null;
    API_CACHE.timestamp = 0;
    console.log('✅ API cache invalidated');
}

/**
 * Check if cache is still valid
 * @returns {boolean} True if cache is valid
 */
export function isCacheValid() {
    if (!API_CACHE.data) return false;
    const now = Date.now();
    const isValid = (now - API_CACHE.timestamp) < API_CACHE.TTL;
    return isValid;
}

/**
 * Update cache with new data
 * @param {Object} data - Data to cache
 */
export function updateCache(data) {
    if (!data) {
        console.warn('updateCache: No data provided');
        return;
    }
    
    API_CACHE.data = data;
    API_CACHE.timestamp = Date.now();
    console.log('✅ API cache updated');
}

/**
 * Get cached data if valid, null otherwise
 * @returns {Object|null} Cached data or null
 */
export function getCachedData() {
    if (isCacheValid()) {
        console.log('✅ Using cached data');
        return API_CACHE.data;
    }
    console.log('⚠️ Cache expired or empty');
    return null;
}

// ================================================================================================
// UTILITY HELPERS
// ================================================================================================

/**
 * Reset all application state (useful for logout/cleanup)
 */
export function resetAppState() {
    updateSelectedSlots([]);
    updateLastApiCall(0);
    updateIsSubmitting(false);
    invalidateCache();
    console.log('✅ Application state reset');
}

/**
 * Get current state snapshot (useful for debugging)
 * @returns {Object} Current state snapshot
 */
export function getStateSnapshot() {
    return {
        selectedSlots: [...selectedSlots],
        selectedSlotsCount: selectedSlots.length,
        lastApiCall,
        isSubmitting,
        cache: {
            hasData: !!API_CACHE.data,
            timestamp: API_CACHE.timestamp,
            isValid: isCacheValid(),
            age: Date.now() - API_CACHE.timestamp
        },
        config: { ...CONFIG }
    };
}

/**
 * Check if user can submit based on cooldown
 * @returns {Object} {canSubmit: boolean, waitTime: number}
 */
export function canSubmit() {
    const now = Date.now();
    const timeSinceLastCall = now - lastApiCall;
    const canSubmit = timeSinceLastCall >= CONFIG.API_COOLDOWN;
    const waitTime = canSubmit ? 0 : Math.ceil((CONFIG.API_COOLDOWN - timeSinceLastCall) / 1000);
    
    return { canSubmit, waitTime };
}

// ================================================================================================
// DEBUG MODE (Only in development)
// ================================================================================================

if (typeof window !== 'undefined') {
    // ✅ NEW: Expose debug helpers in development
    window.__APP_DEBUG__ = {
        getState: getStateSnapshot,
        resetState: resetAppState,
        invalidateCache,
        isCacheValid,
        selectedSlots: () => [...selectedSlots],
        config: CONFIG
    };
    
    console.log('💡 Debug helpers available at window.__APP_DEBUG__');
}

// ================================================================================================
// EXPORTS SUMMARY
// ================================================================================================
/*
Configuration:
- API_URL: API endpoint
- CONFIG: Application configuration object

State:
- selectedSlots: Array of selected slot objects
- lastApiCall: Timestamp of last API call
- isSubmitting: Boolean submission state
- API_CACHE: Cache object with data, timestamp, and TTL

State Updates:
- updateSelectedSlots(newSlots): Update selected slots
- updateLastApiCall(timestamp): Update last API call time
- updateIsSubmitting(status): Update submission state

Cache Management:
- invalidateCache(): Clear cache
- isCacheValid(): Check if cache is valid
- updateCache(data): Update cache with new data
- getCachedData(): Get cached data if valid

Utilities:
- resetAppState(): Reset all state
- getStateSnapshot(): Get current state for debugging
- canSubmit(): Check if user can submit based on cooldown
*/
