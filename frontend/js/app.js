const API_BASE = 'http://127.0.0.1:5000';
const LOCAL_RADIUS_KM = 50;
const DEFAULT_CENTER = { lat: 19.0760, lng: 72.8777 }; // Mumbai

let authToken = localStorage.getItem('token') || '';
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');
let currentPosition = null;

let discoverMap = null;
let organizerMap = null;
let discoverMarker = null;
let organizerMarker = null;
let discoverGeocoder = null;
let organizerGeocoder = null;

const messageEl = document.getElementById('message');
const authStatusEl = document.getElementById('auth-status');
const logoutBtn = document.getElementById('logout-btn');
const organizerTabBtn = document.getElementById('organizer-tab-btn');
const discoverLocationInput = document.getElementById('discover-location');
const discoverLatInput = document.getElementById('discover-lat');
const discoverLngInput = document.getElementById('discover-lng');
const applyDiscoverCoordsBtn = document.getElementById('apply-discover-coords');
const organizerLocationInput = document.getElementById('t-location');
const organizerCoordsEl = document.getElementById('t-location-coords');

// New filter elements
const tournamentSearchInput = document.getElementById('tournament-search');
const sportFilterSelect = document.getElementById('sport-filter');
const feeFilterSelect = document.getElementById('fee-filter');
const clearFiltersBtn = document.getElementById('clear-filters');

function setMessage(text, isError = false) {
    messageEl.textContent = text;
    messageEl.className = isError ? 'message error' : 'message';
}

function getApiError(data, fallback) {
    if (data && typeof data === 'object') {
        return data.error || data.msg || fallback;
    }
    return fallback;
}

async function readApiPayload(res) {
    const text = await res.text();
    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch (_) {
        return { error: text };
    }
}

function handleAuthFailure(status, data) {
    if (status === 401 || status === 422) {
        clearAuth();
        setMessage(getApiError(data, 'Session expired. Please login again.'), true);
        switchTab('auth-view');
        return true;
    }
    return false;
}

function authHeaders() {
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
    };
}

function switchTab(tabId) {
    document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.remove('active'));

    const targetView = document.getElementById(tabId);
    const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);

    if (targetView) {
        targetView.classList.add('active');
    }
    if (targetBtn) {
        targetBtn.classList.add('active');
    }
}

function updateAuthUI() {
    if (currentUser) {
        authStatusEl.textContent = `Logged in as ${currentUser.name} (${currentUser.role})`;
        logoutBtn.classList.remove('hidden');
    } else {
        authStatusEl.textContent = 'Not logged in';
        logoutBtn.classList.add('hidden');
    }

    if (currentUser && currentUser.role === 'organizer') {
        organizerTabBtn.classList.remove('hidden');
    } else {
        organizerTabBtn.classList.add('hidden');
        if (document.getElementById('organizer-view').classList.contains('active')) {
            switchTab('discover-view');
        }
    }
}

function persistAuth(token, user) {
    authToken = token;
    currentUser = user;
    localStorage.setItem('token', authToken);
    localStorage.setItem('user', JSON.stringify(currentUser));
    updateAuthUI();
}

function clearAuth() {
    authToken = '';
    currentUser = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    updateAuthUI();
}

function cardTournament(t, index) {
    const distanceText = t.distance === null || t.distance === undefined ? 'Distance unavailable' : `${t.distance} km away`;
    const entryFeeText = t.entry_fee === 0 ? 'FREE' : `₹${t.entry_fee}`;

    return `
        <div class="card fade-in" style="animation-delay:${Math.min(index * 0.08, 0.5)}s">
            <h3>${t.name}</h3>
            <p><strong>${t.sport}</strong> | ${t.mode}</p>
            <p>📍 ${distanceText}</p>
            <p>📅 ${t.date}</p>
            <p>💰 ${entryFeeText}</p>
            <button onclick="registerTournament(${t.id})" class="primary-btn">Register</button>
        </div>
    `;
}

function filterTournaments(tournaments) {
    const searchTerm = tournamentSearchInput.value.toLowerCase();
    const sportFilter = sportFilterSelect.value;
    const feeFilter = feeFilterSelect.value;

    return tournaments.filter(tournament => {
        // Search filter
        if (searchTerm && !tournament.name.toLowerCase().includes(searchTerm) && 
            !tournament.sport.toLowerCase().includes(searchTerm)) {
            return false;
        }

        // Sport filter
        if (sportFilter && tournament.sport.toLowerCase() !== sportFilter) {
            return false;
        }

        // Fee filter
        if (feeFilter) {
            switch (feeFilter) {
                case 'free':
                    if (tournament.entry_fee !== 0) {
                        return false;
                    }
                    break;
                case '0-500':
                    if (tournament.entry_fee < 0 || tournament.entry_fee > 500) {
                        return false;
                    }
                    break;
                case '500-1000':
                    if (tournament.entry_fee < 500 || tournament.entry_fee > 1000) {
                        return false;
                    }
                    break;
                case '1000-2000':
                    if (tournament.entry_fee < 1000 || tournament.entry_fee > 2000) {
                        return false;
                    }
                    break;
                case '2000+':
                    if (tournament.entry_fee <= 2000) {
                        return false;
                    }
                    break;
            }
        }

        return true;
    });
}

function clearFilters() {
    tournamentSearchInput.value = '';
    sportFilterSelect.value = '';
    feeFilterSelect.value = '';
    loadTournaments();
}

function renderTournaments(list) {
    const container = document.getElementById('tournament-list');
    if (!list.length) {
        container.innerHTML = '<p class="empty fade-in">No tournaments nearby.</p>';
        return;
    }
    container.innerHTML = list.map((item, idx) => cardTournament(item, idx)).join('');
}

function updateDiscoverMarker(lat, lng, shouldPan = true) {
    if (!discoverMap) {
        return;
    }

    const point = [lat, lng];
    if (!discoverMarker) {
        discoverMarker = L.marker(point).addTo(discoverMap);
    } else {
        discoverMarker.setLatLng(point);
    }
    if (shouldPan) {
        discoverMap.panTo(point);
    }
}

function updateOrganizerMarker(lat, lng, shouldPan = true) {
    if (!organizerMap) {
        return;
    }

    const point = [lat, lng];
    if (!organizerMarker) {
        organizerMarker = L.marker(point).addTo(organizerMap);
    } else {
        organizerMarker.setLatLng(point);
    }
    if (shouldPan) {
        organizerMap.panTo(point);
    }
}

function reverseGeocode(lat, lng, onAddress) {
    if (!discoverGeocoder) {
        return;
    }

    discoverGeocoder.reverse(
        { lat, lng },
        (results) => {
            if (results && results.length > 0) {
                onAddress(results[0].name || results[0].display_name || 'Unknown location');
            }
        }
    );
}

function setOrganizerLocation(lat, lng, shouldPan = true, address = '') {
    const latField = document.getElementById('t-lat');
    const lngField = document.getElementById('t-lng');

    latField.value = Number(lat).toFixed(6);
    lngField.value = Number(lng).toFixed(6);
    organizerCoordsEl.textContent = `Selected: ${latField.value}, ${lngField.value}`;

    if (address) {
        organizerLocationInput.value = address;
    }

    updateOrganizerMarker(Number(lat), Number(lng), shouldPan);
}

function syncOrganizerLocation(force = false) {
    if (!currentPosition) {
        return;
    }

    const latField = document.getElementById('t-lat');
    const lngField = document.getElementById('t-lng');

    if (force || !latField.value || !lngField.value) {
        setOrganizerLocation(currentPosition.latitude, currentPosition.longitude, true);
    }
}

function setCurrentPosition(latitude, longitude, shouldPan = true) {
    currentPosition = { latitude, longitude };
    discoverLatInput.value = Number(latitude).toFixed(6);
    discoverLngInput.value = Number(longitude).toFixed(6);

    updateDiscoverMarker(latitude, longitude, shouldPan);
    syncOrganizerLocation(false);
    loadTournaments();
}

function applyManualDiscoverCoords() {
    const latitude = Number(discoverLatInput.value);
    const longitude = Number(discoverLngInput.value);

    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        setMessage('Enter valid latitude and longitude.', true);
        return;
    }

    setCurrentPosition(latitude, longitude, true);
    setMessage('Manual coordinates applied.');
}

async function loadTournaments() {
    const radius = Number(document.getElementById('radius').value || LOCAL_RADIUS_KM);

    if (!currentPosition) {
        renderTournaments([]);
        return;
    }

    const { latitude, longitude } = currentPosition;

    try {
        const res = await fetch(`${API_BASE}/tournaments?lat=${latitude}&lng=${longitude}&radius=${radius}`);
        const data = await readApiPayload(res);
        if (!res.ok) {
            throw new Error(getApiError(data, 'Failed to load tournaments'));
        }
        
        // Apply filters
        const filteredTournaments = filterTournaments(data);
        renderTournaments(filteredTournaments);
        
        // Show results count
        if (filteredTournaments.length !== data.length) {
            setMessage(`Showing ${filteredTournaments.length} of ${data.length} tournaments`);
        } else {
            setMessage(`Found ${data.length} tournaments`);
        }
    } catch (err) {
        setMessage(err.message, true);
    }
}

function requestLocationAndLoad() {
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const latitude = pos.coords.latitude;
            const longitude = pos.coords.longitude;

            setCurrentPosition(latitude, longitude, true);

            reverseGeocode(latitude, longitude, (address) => {
                discoverLocationInput.value = address;
            });

            setMessage('Location updated for local tournaments.');
        },
        () => {
            setMessage('Location access denied. Search a location on Google Maps.', true);
        }
    );
}

function initMaps() {
    // Initialize discover map
    discoverMap = L.map('discover-map').setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(discoverMap);

    discoverGeocoder = L.Control.geocoder({
        defaultMarkGeocode: false,
        collapsed: true,
        placeholder: 'Search location...',
        errorMessage: 'Location not found.',
        showResultIcons: false,
        suggestMinLength: 3,
        suggestTimeout: 250,
        queryMinLength: 1
    }).on('markgeocode', function(e) {
        const latlng = e.geocode.center;
        const address = e.geocode.name;
        discoverLocationInput.value = address;
        setCurrentPosition(latlng.lat, latlng.lng, true);
    }).addTo(discoverMap);

    // Initialize organizer map
    organizerMap = L.map('organizer-map').setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(organizerMap);

    organizerGeocoder = L.Control.geocoder({
        defaultMarkGeocode: false,
        collapsed: true,
        placeholder: 'Search location...',
        errorMessage: 'Location not found.',
        showResultIcons: false,
        suggestMinLength: 3,
        suggestTimeout: 250,
        queryMinLength: 1
    }).on('markgeocode', function(e) {
        const latlng = e.geocode.center;
        organizerLocationInput.value = e.geocode.name;
        organizerCoordsEl.textContent = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
    }).addTo(organizerMap);

    // Map click handlers
    discoverMap.on('click', function(event) {
        const latitude = event.latlng.lat;
        const longitude = event.latlng.lng;
        setCurrentPosition(latitude, longitude, false);
    });

    organizerMap.on('click', function(event) {
        const latlng = event.latlng;
        organizerLocationInput.value = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
        organizerCoordsEl.textContent = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
        updateOrganizerMarker(latlng.lat, latlng.lng, false);
    });

    if (currentPosition) {
        setCurrentPosition(currentPosition.latitude, currentPosition.longitude, true);
        syncOrganizerLocation(true);
    }
}

// Initialize maps when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    initMaps();
});

async function registerUser(event) {
    event.preventDefault();

    const payload = {
        name: document.getElementById('reg-name').value.trim(),
        email: document.getElementById('reg-email').value.trim(),
        password: document.getElementById('reg-password').value,
        role: document.getElementById('reg-role').value,
        latitude: currentPosition ? currentPosition.latitude : null,
        longitude: currentPosition ? currentPosition.longitude : null,
    };

    try {
        const res = await fetch(`${API_BASE}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await readApiPayload(res);
        if (!res.ok) {
            throw new Error(getApiError(data, 'Registration failed'));
        }

        setMessage('Account created. Login now.');
        document.getElementById('register-form').reset();
    } catch (err) {
        setMessage(err.message, true);
    }
}

async function loginUser(event) {
    event.preventDefault();

    const payload = {
        email: document.getElementById('login-email').value.trim(),
        password: document.getElementById('login-password').value,
    };

    try {
        const res = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await readApiPayload(res);
        if (!res.ok) {
            throw new Error(getApiError(data, 'Login failed'));
        }

        persistAuth(data.access_token, data.user);
        setMessage('Logged in successfully.');
        document.getElementById('login-form').reset();
        switchTab('discover-view');
    } catch (err) {
        setMessage(err.message, true);
    }
}

async function createTournament(event) {
    event.preventDefault();

    if (!authToken) {
        setMessage('Login as organizer first.', true);
        return;
    }

    const latitude = Number(document.getElementById('t-lat').value);
    const longitude = Number(document.getElementById('t-lng').value);

    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        setMessage('Select tournament location on the map.', true);
        return;
    }

    const payload = {
        name: document.getElementById('t-name').value.trim(),
        sport: document.getElementById('t-sport').value.trim(),
        date: document.getElementById('t-date').value,
        entry_fee: Number(document.getElementById('t-fee').value),
        mode: document.getElementById('t-mode').value,
        latitude,
        longitude,
    };

    try {
        const res = await fetch(`${API_BASE}/tournaments`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(payload),
        });
        const data = await readApiPayload(res);
        if (!res.ok) {
            if (handleAuthFailure(res.status, data)) {
                return;
            }
            throw new Error(getApiError(data, 'Tournament creation failed'));
        }

        setMessage('Tournament published.');
        document.getElementById('create-tournament-form').reset();
        document.getElementById('t-lat').value = '';
        document.getElementById('t-lng').value = '';
        organizerCoordsEl.textContent = 'No location selected';
        loadTournaments();
        switchTab('discover-view');
    } catch (err) {
        setMessage(err.message, true);
    }
}

async function loadRegistrations() {
    const container = document.getElementById('registration-list');

    if (!authToken) {
        container.innerHTML = '<p class="empty fade-in">Login to view registrations.</p>';
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/my-registrations`, {
            headers: { Authorization: `Bearer ${authToken}` },
        });
        const data = await readApiPayload(res);
        if (!res.ok) {
            if (handleAuthFailure(res.status, data)) {
                return;
            }
            throw new Error(getApiError(data, 'Failed to load registrations'));
        }

        if (!data.length) {
            container.innerHTML = '<p class="empty fade-in">No registrations yet.</p>';
            return;
        }

        container.innerHTML = data
            .map(
                (item, index) => `
                <div class="card fade-in" style="animation-delay:${Math.min(index * 0.08, 0.5)}s">
                    <h3>${item.name}</h3>
                    <p>${item.sport} | ${item.mode}</p>
                    <p>Date: ${item.date}</p>
                </div>
            `
            )
            .join('');
    } catch (err) {
        setMessage(err.message, true);
    }
}

async function registerTournament(tournamentId) {
    if (!authToken) {
        setMessage('Please login to register for tournaments.', true);
        switchTab('auth-view');
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/tournaments/${tournamentId}/register`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({}),
        });
        const data = await readApiPayload(res);
        if (!res.ok) {
            if (handleAuthFailure(res.status, data)) {
                return;
            }
            throw new Error(getApiError(data, 'Tournament registration failed'));
        }

        setMessage('Registered successfully.');
        loadRegistrations();
    } catch (err) {
        setMessage(err.message, true);
    }
}

window.registerTournament = registerTournament;

function attachEvents() {
    document.getElementById('register-form').addEventListener('submit', registerUser);
    document.getElementById('login-form').addEventListener('submit', loginUser);
    document.getElementById('create-tournament-form').addEventListener('submit', createTournament);
    document.getElementById('locate-btn').addEventListener('click', requestLocationAndLoad);
    document.getElementById('radius').addEventListener('change', loadTournaments);
    document.getElementById('load-registrations-btn').addEventListener('click', loadRegistrations);
    applyDiscoverCoordsBtn.addEventListener('click', applyManualDiscoverCoords);

    // New filter event listeners
    tournamentSearchInput.addEventListener('input', loadTournaments);
    sportFilterSelect.addEventListener('change', loadTournaments);
    feeFilterSelect.addEventListener('change', loadTournaments);
    clearFiltersBtn.addEventListener('click', clearFilters);

    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
            if (btn.dataset.tab === 'registrations-view') {
                loadRegistrations();
            }
        });
    });

    logoutBtn.addEventListener('click', () => {
        clearAuth();
        setMessage('Logged out.');
    });
}

(function init() {
    attachEvents();
    updateAuthUI();
    requestLocationAndLoad();
})();

