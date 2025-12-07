const { google } = require("googleapis");

// ================================================================================================
// CONFIGURATION & CONSTANTS (UPDATED FOR PHONE-BASED BOOKING)
// ================================================================================================

const CONFIG = {
    MAX_SLOTS_PER_BOOKING: 10,
    MAX_NAME_LENGTH: 100,
    MAX_EMAIL_LENGTH: 254,
    MAX_PHONE_LENGTH: 20,
    MAX_NOTES_LENGTH: 500,
    MAX_CATEGORY_LENGTH: 20,
    RATE_LIMIT_WINDOW: 60000,   // 1 minute
    RATE_LIMIT_MAX_REQUESTS: 50,
    CACHE_TTL: 30000,           // 30 seconds
    MAX_CONCURRENT_BOOKINGS: 3, // Prevent booking spam
};

// Sheet column mappings (added CATEGORY column)
const SHEETS = {
    SLOTS: {
        NAME: 'Slots',
        RANGE: 'A2:E',
        COLS: {
            DATE: 0,
            LABEL: 1,
            CAPACITY: 2,
            TAKEN: 3,
            AVAILABLE: 4
        }
    },
    SIGNUPS: {
        NAME: 'Signups',
        RANGE: 'A2:J',
        COLS: {
            TIMESTAMP: 0,
            DATE: 1,
            SLOT_LABEL: 2,
            NAME: 3,
            EMAIL: 4,
            PHONE: 5,
            CATEGORY: 6,  // ✅ new column
            NOTES: 7,
            SLOT_ROW_ID: 8,
            STATUS: 9
        }
    }
};

// Environment validation
const REQUIRED_ENV = ['SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT', 'SIGNUPS_GID', 'SLOTS_GID'];
REQUIRED_ENV.forEach(key => {
    if (!process.env[key]) {
        console.error(`❌ CRITICAL: Missing environment variable: ${key}`);
        throw new Error(`Missing required environment variable: ${key}`);
    }
});

const SIGNUPS_GID = parseInt(process.env.SIGNUPS_GID);
const SLOTS_GID = parseInt(process.env.SLOTS_GID);
const SHEET_ID = process.env.SHEET_ID;
const TIMEZONE = process.env.TIMEZONE || 'America/New_York';

// ================================================================================================
// SERVER CACHE
// ================================================================================================

const cache = { slots: null, timestamp: 0, TTL: CONFIG.CACHE_TTL };

function getCachedSlots() {
    const now = Date.now();
    if (cache.slots && (now - cache.timestamp) < cache.TTL) return cache.slots;
    return null;
}
function setCachedSlots(data) { cache.slots = data; cache.timestamp = Date.now(); }
function invalidateCache() { cache.slots = null; cache.timestamp = 0; }

// ================================================================================================
// RATE LIMITING
// ================================================================================================

const rateLimitMap = new Map();
const activeBookingsMap = new Map();

function cleanupRateLimitMap() {
    const now = Date.now();
    for (const [key, timestamps] of rateLimitMap.entries()) {
        const valid = timestamps.filter(t => now - t < CONFIG.RATE_LIMIT_WINDOW);
        valid.length ? rateLimitMap.set(key, valid) : rateLimitMap.delete(key);
    }
}

function checkRateLimit(identifier) {
    const now = Date.now();
    const reqs = rateLimitMap.get(identifier) || [];
    const recent = reqs.filter(t => now - t < CONFIG.RATE_LIMIT_WINDOW);
    if (recent.length >= CONFIG.RATE_LIMIT_MAX_REQUESTS) return false;
    recent.push(now);
    rateLimitMap.set(identifier, recent);
    return true;
}

function checkConcurrentBookings(phone) {
    const count = activeBookingsMap.get(phone) || 0;
    return count < CONFIG.MAX_CONCURRENT_BOOKINGS;
}
function incrementActiveBookings(phone) {
    const count = activeBookingsMap.get(phone) || 0;
    activeBookingsMap.set(phone, count + 1);
}
function decrementActiveBookings(phone) {
    const count = activeBookingsMap.get(phone) || 0;
    if (count > 0) activeBookingsMap.set(phone, count - 1);
}

// Clean up maps periodically
setInterval(() => {
    cleanupRateLimitMap();
    activeBookingsMap.clear();
}, 300000);

// ================================================================================================
// VALIDATION & SANITIZATION
// ================================================================================================

function sanitizeInput(str, maxLength) {
    if (!str) return '';
    return str.toString().trim().replace(/[<>]/g, '').substring(0, maxLength);
}

function isValidEmail(email) {
    if (!email) return true; // Optional now
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= CONFIG.MAX_EMAIL_LENGTH;
}

function isValidPhone(phone) {
    if (!phone) return false;
    return /^[\d\s\-\+\(\)]{8,20}$/.test(phone);
}

function validateBookingRequest(body) {
    const errors = [];

    if (!body.name?.trim() || body.name.length > CONFIG.MAX_NAME_LENGTH) {
        errors.push(`Name is required (max ${CONFIG.MAX_NAME_LENGTH} characters).`);
    }

    if (!body.phone?.trim() || !isValidPhone(body.phone)) {
        errors.push(`Valid phone number is required.`);
    }

    if (body.email && !isValidEmail(body.email)) {
        errors.push(`Invalid email address.`);
    }

    if (!body.category?.trim() || body.category.length > CONFIG.MAX_CATEGORY_LENGTH) {
        errors.push(`Valid category selection is required.`);
    }

    if (body.notes && body.notes.length > CONFIG.MAX_NOTES_LENGTH) {
        errors.push(`Notes must be less than ${CONFIG.MAX_NOTES_LENGTH} characters.`);
    }

    if (!Array.isArray(body.slotIds) || body.slotIds.length === 0) {
        errors.push(`At least one slot must be selected.`);
    }

    if (body.slotIds?.length > CONFIG.MAX_SLOTS_PER_BOOKING) {
        errors.push(`Only up to ${CONFIG.MAX_SLOTS_PER_BOOKING} slots allowed.`);
    }

    if (!body.slotIds.every(id => Number.isInteger(id) && id > 0)) {
        errors.push("Invalid slot IDs provided.");
    }

    return errors;
}

// ================================================================================================
// LOGGING
// ================================================================================================

function log(level, message, data = {}) {
    const entry = { timestamp: new Date().toISOString(), level, message, ...data };
    console[level === 'error' ? 'error' : 'log'](JSON.stringify(entry));
}

// ================================================================================================
// GOOGLE SHEETS HELPER
// ================================================================================================

let sheetsInstance;

async function getSheets() {
    if (sheetsInstance) return sheetsInstance;
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    sheetsInstance = google.sheets({ version: "v4", auth });
    return sheetsInstance;
}

// ================================================================================================
// MAIN HANDLER
// ================================================================================================

module.exports = async function handler(req, res) {
    const startTime = Date.now();

    // Security + CORS
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.headers['x-real-ip'] || 'unknown';
        if (!checkRateLimit(clientIP)) {
            log('warn', 'Rate limit exceeded', { ip: clientIP });
            return res.status(429).json({ ok: false, error: "Too many requests. Please try again later." });
        }

        const sheets = await getSheets();

        // ========================================================================================
        // GET: Lookup by phone number or fetch available slots
        // ========================================================================================
        if (req.method === "GET") {
            if (req.query.phone) {
                const lookupPhone = sanitizeInput(req.query.phone, CONFIG.MAX_PHONE_LENGTH);
                if (!isValidPhone(lookupPhone)) {
                    return res.status(400).json({ ok: false, error: "Invalid phone number format." });
                }

                try {
                    log('info', 'Looking up bookings by phone', { phone: lookupPhone });
                    const response = await sheets.spreadsheets.values.get({
                        spreadsheetId: SHEET_ID,
                        range: `${SHEETS.SIGNUPS.NAME}!${SHEETS.SIGNUPS.RANGE}`,
                    });
                    const rows = response.data.values || [];
                    const userBookings = rows
                        .map((row, idx) => ({
                            signupRowId: idx + 2,
                            timestamp: row[SHEETS.SIGNUPS.COLS.TIMESTAMP],
                            date: row[SHEETS.SIGNUPS.COLS.DATE],
                            slotLabel: row[SHEETS.SIGNUPS.COLS.SLOT_LABEL],
                            name: row[SHEETS.SIGNUPS.COLS.NAME],
                            email: row[SHEETS.SIGNUPS.COLS.EMAIL],
                            phone: row[SHEETS.SIGNUPS.COLS.PHONE],
                            category: row[SHEETS.SIGNUPS.COLS.CATEGORY],
                            notes: row[SHEETS.SIGNUPS.COLS.NOTES],
                            slotRowId: parseInt(row[SHEETS.SIGNUPS.COLS.SLOT_ROW_ID]) || null,
                            status: row[SHEETS.SIGNUPS.COLS.STATUS] || 'ACTIVE'
                        }))
                        .filter(b => b.phone?.trim() === lookupPhone && b.status === 'ACTIVE');

                    log('info', 'Phone lookup complete', { phone: lookupPhone, count: userBookings.length });
                    return res.status(200).json({ ok: true, bookings: userBookings });
                } catch (err) {
                    log('error', 'Phone lookup failed', { err: err.message });
                    return res.status(500).json({ ok: false, error: "Failed to fetch bookings." });
                }
            }

            // --- Load available slots (cached)
            try {
                const cached = getCachedSlots();
                if (cached) return res.status(200).json(cached);

                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: SHEET_ID,
                    range: `${SHEETS.SLOTS.NAME}!${SHEETS.SLOTS.RANGE}`,
                });

                const rows = response.data.values || [];
                const slots = rows.map((row, idx) => ({
                    id: idx + 2,
                    date: row[SHEETS.SLOTS.COLS.DATE] || "",
                    slotLabel: row[SHEETS.SLOTS.COLS.LABEL] || "",
                    capacity: parseInt(row[SHEETS.SLOTS.COLS.CAPACITY]) || 0,
                    taken: parseInt(row[SHEETS.SLOTS.COLS.TAKEN]) || 0,
                    available: Math.max(0, (parseInt(row[SHEETS.SLOTS.COLS.CAPACITY]) || 0) -
                        (parseInt(row[SHEETS.SLOTS.COLS.TAKEN]) || 0))
                }));

                const today = new Date(); today.setHours(0, 0, 0, 0);
                const grouped = {};
                slots.forEach(slot => {
                    const slotDate = new Date(slot.date);
                    if (slotDate >= today && slot.capacity > 0) {
                        if (!grouped[slot.date]) grouped[slot.date] = [];
                        grouped[slot.date].push(slot);
                    }
                });

                const result = { ok: true, dates: grouped };
                setCachedSlots(result);
                return res.status(200).json(result);
            } catch {
                return res.status(500).json({ ok: false, error: "Slots not available." });
            }
        }

        // ========================================================================================
        // POST: Create new booking
        // ========================================================================================
        if (req.method === "POST") {
            const errors = validateBookingRequest(req.body);
            if (errors.length) return res.status(400).json({ ok: false, error: errors.join('; ') });

            const name = sanitizeInput(req.body.name, CONFIG.MAX_NAME_LENGTH);
            const phone = sanitizeInput(req.body.phone, CONFIG.MAX_PHONE_LENGTH);
            const email = sanitizeInput(req.body.email, CONFIG.MAX_EMAIL_LENGTH).toLowerCase();
            const category = sanitizeInput(req.body.category, CONFIG.MAX_CATEGORY_LENGTH);
            const notes = sanitizeInput(req.body.notes, CONFIG.MAX_NOTES_LENGTH);
            const slotIds = req.body.slotIds;

            if (!checkConcurrentBookings(phone))
                return res.status(429).json({ ok: false, error: "Too many concurrent requests. Try again." });

            incrementActiveBookings(phone);
            try {
                const sheetsData = await sheets.spreadsheets.values.batchGet({
                    spreadsheetId: SHEET_ID,
                    ranges: slotIds.map(id => `${SHEETS.SLOTS.NAME}!A${id}:D${id}`)
                });

                const signupFetch = await sheets.spreadsheets.values.get({
                    spreadsheetId: SHEET_ID,
                    range: `${SHEETS.SIGNUPS.NAME}!${SHEETS.SIGNUPS.RANGE}`,
                });

                const slotRanges = sheetsData.data.valueRanges;
                const existing = signupFetch.data.values || [];
                const nowStr = new Date().toLocaleString("en-US", { timeZone: TIMEZONE });

                const signupRows = [];
                const updateRequests = [];

                for (let i = 0; i < slotIds.length; i++) {
                    const slotId = slotIds[i];
                    const row = slotRanges[i].values?.[0];
                    if (!row) return res.status(400).json({ ok: false, error: "Slot data missing." });

                    const date = row[SHEETS.SLOTS.COLS.DATE];
                    const label = row[SHEETS.SLOTS.COLS.LABEL];
                    const capacity = parseInt(row[SHEETS.SLOTS.COLS.CAPACITY]) || 0;
                    const taken = parseInt(row[SHEETS.SLOTS.COLS.TAKEN]) || 0;

                    const duplicate = existing.find(r =>
                        r[SHEETS.SIGNUPS.COLS.PHONE]?.trim() === phone &&
                        parseInt(r[SHEETS.SIGNUPS.COLS.SLOT_ROW_ID]) === slotId &&
                        (r[SHEETS.SIGNUPS.COLS.STATUS] || 'ACTIVE').startsWith('ACTIVE')
                    );
                    if (duplicate) return res.status(409).json({ ok: false, error: `Already booked ${label} on ${date}.` });

                    if (taken >= capacity)
                        return res.status(409).json({ ok: false, error: `Slot ${label} on ${date} is full.` });

                    signupRows.push([nowStr, date, label, name, email, phone, category, notes, slotId, 'ACTIVE']);
                    updateRequests.push({
                        range: `${SHEETS.SLOTS.NAME}!D${slotId}`,
                        values: [[taken + 1]]
                    });
                }

                // BatchWrite
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SHEET_ID,
                    requestBody: {
                        requests: [
                            {
                                appendCells: {
                                    sheetId: SIGNUPS_GID,
                                    rows: signupRows.map(r => ({
                                        values: r.map(c => ({ userEnteredValue: { stringValue: String(c) } }))
                                    })),
                                    fields: 'userEnteredValue'
                                }
                            },
                            ...updateRequests.map(u => ({
                                updateCells: {
                                    range: {
                                        sheetId: SLOTS_GID,
                                        startRowIndex: parseInt(u.range.match(/\d+/)[0]) - 1,
                                        endRowIndex: parseInt(u.range.match(/\d+/)[0]),
                                        startColumnIndex: 3,
                                        endColumnIndex: 4
                                    },
                                    rows: [{
                                        values: u.values.map(val => ({
                                            userEnteredValue: { numberValue: parseInt(val[0]) }
                                        }))
                                    }],
                                    fields: 'userEnteredValue'
                                }
                            }))
                        ]
                    }
                });

                invalidateCache();
                decrementActiveBookings(phone);
                return res.status(200).json({ ok: true, message: "Booking successful!" });
            } catch (err) {
                decrementActiveBookings(phone);
                log('error', 'Booking failed', { err: err.message });
                return res.status(500).json({ ok: false, error: "Booking could not be completed." });
            }
        }

        // ========================================================================================
        // PATCH: Cancel booking
        // ========================================================================================
        if (req.method === "PATCH") {
            const { signupRowId, slotRowId, phone } = req.body;
            if (!signupRowId || !slotRowId || !phone) {
                return res.status(400).json({ ok: false, error: "Missing cancellation parameters." });
            }

            try {
                const signupResp = await sheets.spreadsheets.values.get({
                    spreadsheetId: SHEET_ID,
                    range: `${SHEETS.SIGNUPS.NAME}!A${signupRowId}:J${signupRowId}`,
                });
                const row = signupResp.data.values?.[0];
                if (!row) return res.status(404).json({ ok: false, error: "Booking not found." });
                if (row[SHEETS.SIGNUPS.COLS.PHONE]?.trim() !== phone)
                    return res.status(403).json({ ok: false, error: "Phone number does not match booking." });

                const slotResp = await sheets.spreadsheets.values.get({
                    spreadsheetId: SHEET_ID,
                    range: `${SHEETS.SLOTS.NAME}!D${slotRowId}`
                });
                const currentTaken = parseInt(slotResp.data.values?.[0]?.[0] || 0);
                const newTaken = Math.max(0, currentTaken - 1);

                const ts = new Date().toISOString();

                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SHEET_ID,
                    requestBody: {
                        requests: [
                            {
                                updateCells: {
                                    range: {
                                        sheetId: SIGNUPS_GID,
                                        startRowIndex: signupRowId - 1,
                                        endRowIndex: signupRowId,
                                        startColumnIndex: 9,
                                        endColumnIndex: 10
                                    },
                                    rows: [{
                                        values: [{
                                            userEnteredValue: { stringValue: `CANCELLED:${ts}` }
                                        }]
                                    }],
                                    fields: 'userEnteredValue'
                                }
                            },
                            {
                                updateCells: {
                                    range: {
                                        sheetId: SLOTS_GID,
                                        startRowIndex: slotRowId - 1,
                                        endRowIndex: slotRowId,
                                        startColumnIndex: 3,
                                        endColumnIndex: 4
                                    },
                                    rows: [{
                                        values: [{
                                            userEnteredValue: { numberValue: newTaken }
                                        }]
                                    }],
                                    fields: 'userEnteredValue'
                                }
                            }
                        ]
                    }
                });

                invalidateCache();
                return res.status(200).json({ ok: true, message: "Booking cancelled successfully." });
            } catch (err) {
                log('error', 'Cancel booking failed', { err: err.message });
                return res.status(500).json({ ok: false, error: "Cancellation failed." });
            }
        }

        return res.status(405).json({ ok: false, error: "Method not allowed." });
    } catch (err) {
        log('error', 'Unhandled error', { err: err.message });
        return res.status(500).json({ ok: false, error: "Unexpected server error." });
    }
};
