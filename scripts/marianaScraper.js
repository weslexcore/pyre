// Session Data Scraper
// This script navigates through the schedule and extracts all session data to CSV

// ============================================
// CONFIGURATION - ADJUST THIS VALUE
// ============================================
const WEEKS_TO_SCRAPE = 52; // Set how many weeks back you want to scrape
// ============================================

async function scrapeMarianaSessions() {
	const allSessions = [];

	// Function to check if page shows "no classes" message
	function hasNoClassesMessage() {
		const pageText = document.body.textContent;
		return pageText.includes("There are no classes scheduled for today");
	}

	// Function to extract session data from the current page
	function extractSessionsFromPage() {
		const sessions = [];
		const rows = document.querySelectorAll("table tbody tr");

		// Get the current date from the heading - it's the second h1 on the page
		const dateHeadings = document.querySelectorAll("h1");
		const currentDate = dateHeadings[1]
			? dateHeadings[1].textContent.trim()
			: dateHeadings[0]
				? dateHeadings[0].textContent.trim()
				: "";

		rows.forEach((row) => {
			const cells = row.querySelectorAll("td");
			if (cells.length < 3) return;

			// Extract time and location from first cell
			const timeCell = cells[0];
			const timeParagraphs = timeCell.querySelectorAll("p");
			const time = timeParagraphs[0]
				? timeParagraphs[0].textContent.trim()
				: "";
			const duration = timeParagraphs[1]
				? timeParagraphs[1].textContent.trim()
				: "";
			const location = timeParagraphs[2]
				? timeParagraphs[2].textContent.trim()
				: "";

			// Extract session name and room from second cell
			const sessionCell = cells[1];
			const sessionButton = sessionCell.querySelector("button");
			const sessionName = sessionButton
				? sessionButton.textContent.trim().replace(/\.$/, "")
				: "";
			const roomParagraphs = sessionCell.querySelectorAll("p");
			const room = roomParagraphs[roomParagraphs.length - 1]
				? roomParagraphs[roomParagraphs.length - 1].textContent.trim()
				: "";

			// Extract instructor if available
			let instructor = "";
			if (roomParagraphs.length > 1) {
				instructor =
					roomParagraphs[roomParagraphs.length - 2].textContent.trim();
				// Only set instructor if it's not the same as room
				if (instructor === room) instructor = "";
			}

			// Extract spots available from third cell
			const spotsCell = cells[2];
			const spotsText = spotsCell.textContent.trim();
			const spotsMatch = spotsText.match(/(\d+)\/(\d+)/);
			const spotsAvailable = spotsMatch ? spotsMatch[1] : "";
			const totalSpots = spotsMatch ? spotsMatch[2] : "";

			sessions.push({
				date: currentDate,
				time: time,
				duration: duration,
				location: location,
				sessionName: sessionName,
				instructor: instructor,
				room: room,
				spotsAvailable: spotsAvailable,
				totalSpots: totalSpots,
				booked:
					totalSpots && spotsAvailable
						? parseInt(totalSpots) - parseInt(spotsAvailable)
						: "",
			});
		});

		return sessions;
	}

	// Function to click previous week button
	function clickPreviousWeek() {
		const prevButton = document.querySelector(
			'button[aria-label="Previous week"]',
		);
		if (prevButton) {
			prevButton.click();
			return true;
		}
		return false;
	}

	// Function to wait for page to load
	function waitForLoad(ms = 1000) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	// Function to wait for sessions to load on the page
	async function waitForSessionsToLoad() {
		const maxWaitTime = 5000; // Maximum 5 seconds
		const checkInterval = 100; // Check every 100ms
		const startTime = Date.now();

		// Wait for the table and actual content to appear
		while (Date.now() - startTime < maxWaitTime) {
			const rows = document.querySelectorAll("table tbody tr");
			const dateHeadings = document.querySelectorAll("h1");

			if (hasNoClassesMessage()) {
				return true;
			}
			// Check if we have rows, a proper date heading, and actual content
			if (rows.length > 0 && dateHeadings.length >= 2) {
				// Additional check: make sure the first row has actual content
				const firstRow = rows[0];
				const cells = firstRow.querySelectorAll("td");
				if (cells.length >= 3 && cells[0].textContent.trim() !== "") {
					// Sessions are loaded - add small delay for stability
					await waitForLoad(200);
					return true;
				}
			}

			await waitForLoad(checkInterval);
		}

		console.warn("Timeout waiting for sessions to load");
		return false;
	}

	// Main scraping loop
	console.log("Starting to scrape sessions...");
	console.log(`Configuration: Scraping ${WEEKS_TO_SCRAPE} weeks of data`);

	for (let week = 0; week < WEEKS_TO_SCRAPE; week++) {
		console.log(`Scraping week ${week + 1}...`);

		// Get all days in the current week
		// const weekDates = getCurrentWeekDates();

		// Click through each day in the week
		const dayButtons = document.querySelectorAll("nav ul li button");
		for (let day = 0; day < dayButtons.length; day++) {
			// Re-query buttons in case DOM changed
			const currentDayButtons = document.querySelectorAll("nav ul li button");
			currentDayButtons[day].click();

			// Wait for sessions to load
			const loaded = await waitForSessionsToLoad();
			if (!loaded) {
				console.warn(`Sessions failed to load for day ${day + 1}`);
				continue;
			}

			// Extract sessions with retry logic
			let sessions = [];
			let retryCount = 0;
			const maxRetries = 20; // Increased max retries
			let noClassesScheduled = false;

			while (retryCount < maxRetries) {
				// Check if there's a "no classes" message
				if (hasNoClassesMessage()) {
					noClassesScheduled = true;
					console.log(
						`  Detected "no classes scheduled" message - skipping retries`,
					);
					break;
				}

				sessions = extractSessionsFromPage();

				if (sessions.length > 0) {
					// Successfully found sessions
					break;
				}

				// No sessions found and no "no classes" message, keep retrying
				retryCount++;
				if (retryCount < maxRetries) {
					console.log(
						`  No sessions found yet, waiting 2 seconds before retry ${retryCount}/${maxRetries}...`,
					);
					await waitForLoad(2000);
				}
			}

			allSessions.push(...sessions);
			const dateHeadings = document.querySelectorAll("h1");
			const currentDateDisplay = dateHeadings[1]
				? dateHeadings[1].textContent.trim()
				: "Unknown";

			if (noClassesScheduled) {
				console.log(
					`  ${currentDateDisplay}: No classes scheduled for this day`,
				);
			} else if (sessions.length === 0) {
				console.log(
					`  ${currentDateDisplay}: No sessions found after ${maxRetries} attempts - giving up`,
				);
			} else {
				console.log(
					`  ${currentDateDisplay}: Found ${sessions.length} sessions`,
				);
			}
		}

		// Go to previous week
		if (week < WEEKS_TO_SCRAPE - 1) {
			const success = clickPreviousWeek();
			if (!success) {
				console.log("No more previous weeks available");
				break;
			}
			await waitForLoad(1000);
		}
	}

	console.log(`Total sessions collected: ${allSessions.length}`);

	// Calculate cumulative bookings by day
	const sessionsByDate = {};
	allSessions.forEach((session) => {
		if (!sessionsByDate[session.date]) {
			sessionsByDate[session.date] = [];
		}
		sessionsByDate[session.date].push(session);
	});

	// Add cumulative bookings for each day
	Object.keys(sessionsByDate).forEach((date) => {
		let cumulativeBookings = 0;
		sessionsByDate[date].forEach((session) => {
			const booked = session.booked !== "" ? parseInt(session.booked) : 0;
			cumulativeBookings += booked;
			session.cumulativeBookings = cumulativeBookings;
		});
	});

	console.log("Cumulative bookings calculated for each day");

	// Convert to CSV
	function convertToCSV(data) {
		if (data.length === 0) return "";

		const headers = [
			"Date",
			"Time",
			"Duration",
			"Location",
			"Session Name",
			"Instructor",
			"Room",
			"Spots Available",
			"Total Spots",
			"Booked",
			"Cumulative Bookings",
		];
		const csvRows = [headers.join(",")];

		data.forEach((session) => {
			const row = [
				`"${new Date(session.date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}"`,
				`"${session.time}"`,
				`"${session.duration}"`,
				`"${session.location}"`,
				`"${session.sessionName}"`,
				`"${session.instructor}"`,
				`"${session.room}"`,
				session.spotsAvailable,
				session.totalSpots,
				session.booked,
				session.cumulativeBookings || 0,
			];
			csvRows.push(row.join(","));
		});

		return csvRows.join("\n");
	}

	const csv = convertToCSV(allSessions);

	console.log("CSV generated!");
	console.log("Total sessions collected:", allSessions.length);
	console.log("CSV size:", csv.length, "characters");

	// Try to download first with better error handling
	let downloadSuccess = false;
	try {
		const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = "sessions.csv";
		link.style.visibility = "hidden";
		document.body.appendChild(link);

		// Click and wait longer before cleanup
		link.click();

		console.log("✅ Download initiated! Waiting for download to complete...");

		// Wait 2 seconds before cleanup to ensure download starts
		await new Promise((resolve) => setTimeout(resolve, 2000));

		document.body.removeChild(link);
		URL.revokeObjectURL(url);

		console.log(
			"✅ Download should be complete! Check your Downloads folder for sessions.csv",
		);
		downloadSuccess = true;
	} catch (downloadError) {
		console.log("❌ Download failed:", downloadError.message);
		downloadSuccess = false;
	}

	// If download didn't work, try clipboard as backup
	if (!downloadSuccess) {
		try {
			await navigator.clipboard.writeText(csv);
			console.log("\n✅ CSV data copied to clipboard as fallback!");
			console.log(
				"Paste (Ctrl+V or Cmd+V) into a text editor and save as sessions.csv",
			);
		} catch (clipboardError) {
			console.log("❌ Clipboard copy also failed:", clipboardError.message);
		}
	}

	// Always show the data as final fallback
	console.log("\n=== CSV DATA (manual copy if needed) ===");
	console.log(csv);

	// Store CSV in window for easy access
	window.lastScrapedCSV = csv;

	return {
		sessions: allSessions,
		csv: csv,
		success: downloadSuccess,
		message: downloadSuccess
			? "Download successful!"
			: "Download failed, data available in window.lastScrapedCSV",
	};
}

// Run the scraper
scrapeMarianaSessions();
