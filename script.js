/**
 * VR Commuter & Train Timetable Application
 * Uses native JavaScript (AJAX) to fetch live railway schedules from Fintraffic Digitraffic API.
 * No external JS libraries used. All event handlers are attached dynamically.
 */

// Base API endpoints for Digitraffic Railway API
const API_BASE = "https://rata.digitraffic.fi/api/v1";
const STATIONS_ENDPOINT = `${API_BASE}/metadata/stations`;

// Application state variables to store fetched API data
let stationMap = {};       // Maps stationShortCode -> stationName (e.g., "HKI" -> "Helsinki")
let currentTrainsData = []; // Stores raw live train objects for the currently selected station

// DOM element references
const stationSelect = document.getElementById("station-select");
const customSearchInput = document.getElementById("custom-search");
const refreshBtn = document.getElementById("refresh-btn");
const timetableBody = document.getElementById("timetable-body");
const statusMessage = document.getElementById("status-message");
const resultCount = document.getElementById("result-count");

/**
 * Helper function to perform an AJAX GET request using native XMLHttpRequest.
 * Returns a Promise resolving to parsed JSON data.
 * @param {string} url - The API endpoint to fetch
 * @returns {Promise<any>}
 */
function ajaxGet(url) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        // Digitraffic recommends identifying the client or accepting JSON
        xhr.setRequestHeader("Accept", "application/json");

        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        resolve(data);
                    } catch (parseError) {
                        reject(new Error("Failed to parse JSON response from server."));
                    }
                } else {
                    reject(new Error(`HTTP Error ${xhr.status}: ${xhr.statusText}`));
                }
            }
        };

        xhr.onerror = function () {
            reject(new Error("Network error occurred while connecting to Digitraffic API."));
        };

        xhr.send();
    });
}

/**
 * Fetches all passenger train stations from Digitraffic metadata API,
 * populates the dropdown menu, and triggers the initial timetable load.
 */
async function loadStations() {
    updateStatus("Fetching passenger train stations from Digitraffic...");

    try {
        const stations = await ajaxGet(STATIONS_ENDPOINT);

        // Filter only stations that serve passenger traffic and sort alphabetically
        const passengerStations = stations
            .filter((station) => station.passengerTraffic === true)
            .sort((a, b) => a.stationName.localeCompare(b.stationName, "fi"));

        // Clear existing dropdown options
        stationSelect.innerHTML = "";

        // Populate stationMap lookup dictionary and <select> options
        passengerStations.forEach((station) => {
            // Clean up "asema" suffix for cleaner display while keeping full name
            const cleanName = station.stationName.replace(" asema", "");
            stationMap[station.stationShortCode] = cleanName;

            const option = document.createElement("option");
            option.value = station.stationShortCode;
            option.textContent = `${cleanName} (${station.stationShortCode})`;
            stationSelect.appendChild(option);
        });

        // Default to Helsinki (HKI) if available, otherwise first station
        if (stationMap["HKI"]) {
            stationSelect.value = "HKI";
        }

        // Fetch live trains for the default selected station
        fetchLiveTrains(stationSelect.value);
    } catch (error) {
        updateStatus(`Error loading stations: ${error.message}`);
        stationSelect.innerHTML = `<option value="">Failed to load stations</option>`;
    }
}

/**
 * Fetches live departing and arriving trains for a specific station short code.
 * @param {string} stationCode - e.g., "HKI", "TPE", "PSL"
 */
async function fetchLiveTrains(stationCode) {
    if (!stationCode) return;

    const stationName = stationMap[stationCode] || stationCode;
    updateStatus(`Loading live schedules for ${stationName}...`);
    timetableBody.innerHTML = `<tr><td colspan="7" class="empty-state">Fetching live train data...</td></tr>`;

    // Live trains endpoint: fetches upcoming departures & arrivals for the station
    const liveUrl = `${API_BASE}/live-trains/station/${stationCode}?arrived_trains=0&arriving_trains=5&departed_trains=0&departing_trains=25&include_nonstopping=false`;

    try {
        // Save the API result into our state variable
        const trains = await ajaxGet(liveUrl);
        currentTrainsData = trains;

        // Render the filtered/processed data to the DOM
        processAndRenderTrains();
        updateStatus(`Showing live timetable for ${stationName} (${stationCode}) • Updated at ${formatTime(new Date())}`);
    } catch (error) {
        updateStatus(`Failed to load trains: ${error.message}`);
        timetableBody.innerHTML = `<tr><td colspan="7" class="empty-state">Error retrieving data from Digitraffic API.</td></tr>`;
    }
}

/**
 * Processes raw train objects from `currentTrainsData`, applies custom search filters,
 * extracts relevant fields, and builds the HTML table rows.
 */
function processAndRenderTrains() {
    const selectedStation = stationSelect.value;
    const searchQuery = customSearchInput.value.trim().toLowerCase();

    // Transform raw train objects into clean display objects
    const processedTrains = currentTrainsData
        .map((train) => {
            // Find the specific timetable row for the currently selected station
            const stationRow = train.timeTableRows.find(
                (row) => row.stationShortCode === selectedStation && row.type === "DEPARTURE"
            ) || train.timeTableRows.find(
                (row) => row.stationShortCode === selectedStation
            );

            if (!stationRow) return null;

            // Determine Origin (first station) and Destination (last station)
            const firstRow = train.timeTableRows[0];
            const lastRow = train.timeTableRows[train.timeTableRows.length - 1];
            const originName = stationMap[firstRow.stationShortCode] || firstRow.stationShortCode;
            const destinationName = stationMap[lastRow.stationShortCode] || lastRow.stationShortCode;

            // Format train identifier (e.g., Commuter "P" or Long-distance "IC 23")
            const trainLabel = train.commuterLineID
                ? `Commuter ${train.commuterLineID}`
                : `${train.trainType} ${train.trainNumber}`;

            return {
                trainNumber: train.trainNumber,
                trainType: train.trainType,
                commuterLineID: train.commuterLineID || "",
                trainCategory: train.trainCategory,
                trainLabel: trainLabel,
                origin: originName,
                destination: destinationName,
                scheduledTime: new Date(stationRow.scheduledTime),
                liveEstimateTime: stationRow.liveEstimateTime ? new Date(stationRow.liveEstimateTime) : null,
                differenceInMinutes: stationRow.differenceInMinutes || 0,
                track: stationRow.commercialTrack || "-",
                cancelled: train.cancelled || stationRow.cancelled,
                stopType: stationRow.type // DEPARTURE or ARRIVAL
            };
        })
        .filter((item) => item !== null)
        // Sort chronologically by scheduled time
        .sort((a, b) => a.scheduledTime - b.scheduledTime)
        // Apply custom search filter (matches train name/number, category, origin, destination, or track)
        .filter((item) => {
            if (!searchQuery) return true;
            const searchableText = [
                item.trainLabel,
                item.trainCategory,
                item.origin,
                item.destination,
                item.track
            ].join(" ").toLowerCase();

            return searchableText.includes(searchQuery);
        });

    renderTableRows(processedTrains);
}

/**
 * Renders the array of processed train objects into the HTML table body.
 * @param {Array<Object>} trainsList
 */
function renderTableRows(trainsList) {
    timetableBody.innerHTML = "";
    resultCount.textContent = `${trainsList.length} train${trainsList.length === 1 ? "" : "s"}`;

    if (trainsList.length === 0) {
        timetableBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">
                    No matching trains found for your current selection or search filter.
                </td>
            </tr>
        `;
        return;
    }

    trainsList.forEach((train) => {
        const tr = document.createElement("tr");

        // 1. Train Identifier
        const tdTrain = document.createElement("td");
        tdTrain.innerHTML = `<span class="train-id">${train.trainLabel}</span>`;
        tr.appendChild(tdTrain);

        // 2. Category Badge
        const tdCategory = document.createElement("td");
        const isCommuter = train.trainCategory === "Commuter";
        const badgeClass = isCommuter ? "category-tag category-commuter" : "category-tag category-long";
        tdCategory.innerHTML = `<span class="${badgeClass}">${train.trainCategory}</span>`;
        tr.appendChild(tdCategory);

        // 3. Route (Origin -> Destination)
        const tdRoute = document.createElement("td");
        tdRoute.innerHTML = `${train.origin} &rarr; <strong>${train.destination}</strong>`;
        tr.appendChild(tdRoute);

        // 4. Scheduled Time
        const tdScheduled = document.createElement("td");
        tdScheduled.textContent = formatTime(train.scheduledTime);
        tr.appendChild(tdScheduled);

        // 5. Live Estimate Time
        const tdLive = document.createElement("td");
        if (train.liveEstimateTime && train.differenceInMinutes > 0) {
            tdLive.innerHTML = `<span class="status-delayed">${formatTime(train.liveEstimateTime)}</span>`;
        } else {
            tdLive.textContent = formatTime(train.scheduledTime);
        }
        tr.appendChild(tdLive);

        // 6. Track Number
        const tdTrack = document.createElement("td");
        tdTrack.innerHTML = `<span class="track-box">${train.track}</span>`;
        tr.appendChild(tdTrack);

        // 7. Status (On time, Delayed, or Cancelled)
        const tdStatus = document.createElement("td");
        if (train.cancelled) {
            tdStatus.innerHTML = `<span class="status-cancelled">CANCELLED</span>`;
        } else if (train.differenceInMinutes > 0) {
            tdStatus.innerHTML = `<span class="status-delayed">+${train.differenceInMinutes} min late</span>`;
        } else {
            tdStatus.innerHTML = `<span class="status-ontime">On time</span>`;
        }
        tr.appendChild(tdStatus);

        timetableBody.appendChild(tr);
    });
}

/**
 * Formats a Date object into HH:MM 24-hour string (Finnish locale).
 * @param {Date} dateObj
 * @returns {string}
 */
function formatTime(dateObj) {
    if (!(dateObj instanceof Date) || isNaN(dateObj)) return "--:--";
    return dateObj.toLocaleTimeString("fi-FI", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

/**
 * Updates the status bar text message.
 * @param {string} msg
 */
function updateStatus(msg) {
    statusMessage.textContent = msg;
}

/**
 * Dynamically attaches all event listeners to UI elements once DOM is loaded.
 */
function initEventListeners() {
    // 1. Station pulldown change event -> fetches new station data via AJAX
    stationSelect.addEventListener("change", function (event) {
        fetchLiveTrains(event.target.value);
    });

    // 2. Custom search input event -> filters current station trains in real time
    customSearchInput.addEventListener("input", function () {
        processAndRenderTrains();
    });

    // 3. Refresh button click event -> re-fetches live data for active station
    refreshBtn.addEventListener("click", function () {
        fetchLiveTrains(stationSelect.value);
    });
}

// Initialize the application when the DOM is fully parsed
document.addEventListener("DOMContentLoaded", function () {
    initEventListeners();
    loadStations();
});