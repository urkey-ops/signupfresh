// ================================================================================================
// LOOKUP.JS (UPDATED FOR PHONE NUMBER LOOKUP + TOGGLE BEHAVIOR + FIXES)
// ================================================================================================

import { 
    API_URL, 
    CONFIG, 
    API_CACHE 
} from './config.js';
import { 
    sanitizeInput, 
    sanitizeHTML, 
    getErrorMessage,
    isValidPhone,
    debounce
} from './utils.js';

// ================================================================================================
// STATE MANAGEMENT
// ================================================================================================
let isSearching = false;
let isCancelling = false;

// ================================================================================================
// HELPER FUNCTIONS
// ================================================================================================
function showLoadingState(displayEl, message = '⏳ Loading...') {
    displayEl.innerHTML = '';
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'msg-box info';
    loadingDiv.style.textAlign = 'center';
    loadingDiv.style.padding = '20px';
    loadingDiv.textContent = message;
    displayEl.appendChild(loadingDiv);
}

function showError(displayEl, message) {
    displayEl.innerHTML = '';
    const errorDiv = document.createElement('div');
    errorDiv.className = 'msg-box error';
    errorDiv.textContent = `⚠️ ${message}`;
    displayEl.appendChild(errorDiv);
}

function showInfo(displayEl, message) {
    displayEl.innerHTML = '';
    const infoDiv = document.createElement('div');
    infoDiv.className = 'msg-box';
    infoDiv.textContent = message;
    displayEl.appendChild(infoDiv);
}

// ================================================================================================
// LOOKUP BOOKINGS BY PHONE NUMBER (FIXED)
// ================================================================================================
export async function lookupBookings() {
    // ✅ FIX: Prevent duplicate searches
    if (isSearching) {
        console.warn('Search already in progress');
        return;
    }

    const phoneInput = document.getElementById("lookupPhone");
    const phone = sanitizeInput(phoneInput.value, CONFIG.MAX_PHONE_LENGTH);
    const displayEl = document.getElementById("userBookingsDisplay");
    // ✅ FIX: Use specific ID instead of generic class selector
    const searchBtn = document.getElementById("lookupSearchBtn");

    if (!phone) {
        showError(displayEl, 'Please enter your phone number.');
        phoneInput?.focus();
        return;
    }

    // ✅ FIX: Better phone validation
    if (!isValidPhone(phone)) {
        showError(displayEl, 'Please enter a valid phone number (10-15 digits).');
        phoneInput?.focus();
        return;
    }

    isSearching = true;
    if (searchBtn) {
        searchBtn.disabled = true;
        const originalBtnText = searchBtn.textContent;
        searchBtn.textContent = '🔍 Searching...';
    }
    
    showLoadingState(displayEl, '🔍 Searching for your bookings...');

    try {
        const res = await fetch(`${API_URL}?phone=${encodeURIComponent(phone)}`);
        
        if (!res.ok) {
            const errorMsg = getErrorMessage(res.status, "Failed to look up bookings.");
            showError(displayEl, errorMsg);
            return;
        }
        
        const data = await res.json();

        if (!data.ok) {
            showError(displayEl, data.error || 'Failed to retrieve bookings.');
            return;
        }

        const bookings = data.bookings || [];

        if (bookings.length === 0) {
            showInfo(displayEl, '📭 No active bookings found for this phone number.');
            return;
        }

        // ✅ FIX: Build DOM nodes with better structure and sorting
        displayEl.innerHTML = '';
        
        // Sort bookings by date (earliest first)
        const sortedBookings = [...bookings].sort((a, b) => {
            return new Date(a.date) - new Date(b.date);
        });
        
        const listDiv = document.createElement('div');
        listDiv.className = 'bookings-list';

        sortedBookings.forEach((booking, index) => {
            const item = document.createElement('div');
            item.className = 'booking-item';
            item.style.marginBottom = '16px';
            item.style.padding = '16px';
            item.style.border = '1px solid #e0e0e0';
            item.style.borderRadius = '8px';
            item.style.backgroundColor = '#fafafa';

            // Date and time header
            const title = document.createElement('div');
            title.style.marginBottom = '10px';
            title.style.fontSize = '1.05rem';
            
            const dateStrong = document.createElement('strong');
            dateStrong.textContent = `📅 ${booking.date}`;
            title.appendChild(dateStrong);
            
            title.appendChild(document.createTextNode(' at '));
            
            const timeStrong = document.createElement('strong');
            timeStrong.textContent = `🕰️ ${booking.slotLabel}`;
            title.appendChild(timeStrong);
            
            item.appendChild(title);

            // Details container
            const detailsDiv = document.createElement('div');
            detailsDiv.style.marginBottom = '12px';
            detailsDiv.style.color = '#64748b';

            // Name
            const nameDiv = document.createElement('div');
            nameDiv.style.marginBottom = '4px';
            const nameSmall = document.createElement('small');
            nameSmall.textContent = `Name: ${booking.name}`;
            nameDiv.appendChild(nameSmall);
            detailsDiv.appendChild(nameDiv);

            // Category (if available)
            if (booking.category) {
                const catDiv = document.createElement('div');
                catDiv.style.marginBottom = '4px';
                const catSmall = document.createElement('small');
                catSmall.textContent = `Category: ${booking.category}`;
                catDiv.appendChild(catSmall);
                detailsDiv.appendChild(catDiv);
            }

            // Notes (optional)
            if (booking.notes) {
                const notesDiv = document.createElement('div');
                notesDiv.style.marginBottom = '4px';
                const notesSmall = document.createElement('small');
                notesSmall.textContent = `Notes: ${booking.notes}`;
                notesDiv.appendChild(notesSmall);
                detailsDiv.appendChild(notesDiv);
            }

            item.appendChild(detailsDiv);

            // Cancel booking button
            const btn = document.createElement('button');
            btn.className = 'btn secondary-btn';
            btn.style.marginTop = '8px';
            btn.style.background = '#ef4444';
            btn.style.color = 'white';
            btn.style.border = 'none';
            btn.style.cursor = 'pointer';
            btn.textContent = '❌ Cancel This Booking';
            btn.setAttribute('aria-label', `Cancel booking for ${booking.date} at ${booking.slotLabel}`);

            btn.dataset.signup_row_id = booking.signupRowId;
            btn.dataset.slot_row_id = booking.slotRowId;
            btn.dataset.date = booking.date;
            btn.dataset.slot_label = booking.slotLabel;

            btn.addEventListener('click', (ev) => {
                const sId = Number(ev.currentTarget.dataset.signup_row_id);
                const slId = Number(ev.currentTarget.dataset.slot_row_id);
                const date = ev.currentTarget.dataset.date;
                const label = ev.currentTarget.dataset.slot_label;
                cancelBooking(sId, slId, date, label, ev.currentTarget);
            });

            // Hover effect
            btn.addEventListener('mouseenter', () => {
                btn.style.background = '#dc2626';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = '#ef4444';
            });

            item.appendChild(btn);
            listDiv.appendChild(item);
        });

        displayEl.appendChild(listDiv);

    } catch (err) {
        console.error("Lookup error:", err);
        const errorMsg = err.message === 'Failed to fetch'
            ? 'Unable to connect to the server. Please check your internet connection.'
            : 'An unexpected error occurred. Please try again.';
        showError(displayEl, errorMsg);
    } finally {
        isSearching = false;
        if (searchBtn) {
            searchBtn.disabled = false;
            searchBtn.textContent = 'Search';
        }
    }
}

// ✅ FIX: Debounced version for keypress events
export const lookupBookingsDebounced = debounce(lookupBookings, 500);

// ================================================================================================
// CANCEL BOOKING BY PHONE (FIXED)
// ================================================================================================
export async function cancelBooking(signupRowId, slotRowId, date, slotLabel, buttonElement) {
    // ✅ FIX: Prevent multiple simultaneous cancellations
    if (isCancelling) {
        console.warn('Cancellation already in progress');
        return;
    }

    const phoneInput = document.getElementById("lookupPhone");
    const phone = phoneInput ? phoneInput.value.trim() : '';

    if (!phone) {
        alert('❌ Error: Phone number is required for cancellation. Please ensure it is entered above.');
        phoneInput?.focus();
        return;
    }

    if (!confirm(`⚠️ Are you sure you want to cancel your booking for:\n\n📅 ${date}\n🕰️ ${slotLabel}\n\nThis action cannot be undone.`)) {
        return;
    }

    const displayEl = document.getElementById("userBookingsDisplay");
    const originalHTML = displayEl.innerHTML;
    
    // ✅ FIX: Show loading on the specific button
    if (buttonElement) {
        buttonElement.disabled = true;
        const originalText = buttonElement.textContent;
        buttonElement.textContent = '⏳ Cancelling...';
        buttonElement._originalText = originalText;
    }

    isCancelling = true;

    try {
        showLoadingState(displayEl, '⏳ Cancelling your booking...');
        
        const res = await fetch(API_URL, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                signupRowId, 
                slotRowId,
                phone
            })
        });

        const data = await res.json();

        if (res.ok && data.ok) {
            // ✅ FIX: Show success message in DOM instead of alert
            const successDiv = document.createElement('div');
            successDiv.className = 'msg-box success';
            successDiv.style.padding = '20px';
            successDiv.style.textAlign = 'center';
            successDiv.style.marginBottom = '20px';
            successDiv.textContent = `✅ ${data.message || "Booking cancelled successfully!"}`;
            
            displayEl.innerHTML = '';
            displayEl.appendChild(successDiv);
            
            // ✅ FIX: Invalidate cache properly
            API_CACHE.data = null;
            API_CACHE.timestamp = 0;
            
            // ✅ FIX: Wait before refreshing to let user see success message
            setTimeout(() => {
                lookupBookings();
            }, 1500);
            
        } else {
            const errorMsg = data.error || getErrorMessage(res.status, "Failed to cancel booking.");
            
            // Show error in DOM
            const errorDiv = document.createElement('div');
            errorDiv.className = 'msg-box error';
            errorDiv.style.padding = '20px';
            errorDiv.style.textAlign = 'center';
            errorDiv.style.marginBottom = '20px';
            errorDiv.textContent = `❌ ${errorMsg}`;
            
            displayEl.innerHTML = originalHTML;
            displayEl.insertBefore(errorDiv, displayEl.firstChild);
            
            // Auto-remove error after 5 seconds
            setTimeout(() => {
                errorDiv.style.opacity = '0';
                errorDiv.style.transition = 'opacity 0.3s';
                setTimeout(() => errorDiv.remove(), 300);
            }, 5000);
        }

    } catch (err) {
        console.error("Cancel error:", err);
        const errorMsg = err.message === 'Failed to fetch'
            ? 'Unable to connect to the server. Please check your internet connection.'
            : 'An unexpected error occurred. Please try again.';
        
        showError(displayEl, errorMsg);
        
        // Restore original HTML after showing error briefly
        setTimeout(() => {
            displayEl.innerHTML = originalHTML;
        }, 3000);
        
    } finally {
        isCancelling = false;
        
        // ✅ FIX: Restore button state
        if (buttonElement && buttonElement._originalText) {
            buttonElement.disabled = false;
            buttonElement.textContent = buttonElement._originalText;
        }
    }
}

// ================================================================================================
// TOGGLE LOOKUP SECTION (Fixed: Better state management)
// ================================================================================================
export function toggleLookup() {
    const content = document.getElementById('lookupContent');
    const displayEl = document.getElementById('userBookingsDisplay');
    const phoneInput = document.getElementById('lookupPhone');
    const toggleButton = document.getElementById('lookupToggle');

    if (!content) return;

    const wasHidden = content.classList.contains('hidden');
    content.classList.toggle('hidden');
    
    // ✅ FIX: Keep aria-hidden in sync with visibility
    content.setAttribute('aria-hidden', content.classList.contains('hidden').toString());
    
    const isExpanded = !content.classList.contains('hidden');
    toggleButton?.setAttribute('aria-expanded', isExpanded.toString());

    if (isExpanded) {
        // Opening: focus input and scroll into view
        setTimeout(() => {
            phoneInput?.focus();
            content.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
    } else {
        // ✅ FIX: Clear everything properly when closing
        if (phoneInput) phoneInput.value = '';
        if (displayEl) displayEl.innerHTML = '';
        
        // Reset state flags
        isSearching = false;
        isCancelling = false;
    }
}

// ================================================================================================
// INITIALIZATION
// ================================================================================================
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById("lookupToggle");
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleLookup);
        toggleBtn.setAttribute('aria-expanded', 'false');
    }

    // ✅ FIX: Use specific ID selector
    const searchBtn = document.getElementById('lookupSearchBtn');
    if (searchBtn) {
        searchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            lookupBookings();
        });
    }

    const lookupPhone = document.getElementById('lookupPhone');
    if (lookupPhone) {
        // ✅ FIX: Use debounced version for keypress
        lookupPhone.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                lookupBookings(); // Immediate on Enter
            }
        });
        
        // ✅ NEW: Clear error styling on input
        lookupPhone.addEventListener('input', () => {
            lookupPhone.style.borderColor = '';
        });
    }
});
