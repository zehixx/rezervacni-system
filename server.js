const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

let todayBookings = [];

function removeAccents(str) {
    return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
}

function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

// === ABSOLUTNÍ FIX ČASU (UTC+1 natvrdo) ===
function getCzechDateObj() {
    const now = new Date();
    // Render běží v UTC. Přičteme 1 hodinu (60 * 60 * 1000 ms) pro CET (zima)
    // Pokud je léto, změňte 1 na 2.
    return new Date(now.getTime() + (1 * 60 * 60 * 1000)); 
}

function getCurrentTimeMinutes() {
    const d = getCzechDateObj();
    return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function getIsoDateCheck() {
    const d = getCzechDateObj();
    // Pozor: getMonth() vrací 0-11
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getFormattedDate() {
    const d = getCzechDateObj();
    return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
}

function getFormattedTime() {
    const d = getCzechDateObj();
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

function getArduinoData() {
    const currentMinutes = getCurrentTimeMinutes();
    const todayISO = getIsoDateCheck();

    // Filtrujeme rezervace jen pro DNEŠNÍ DEN (podle českého času)
    const sortedBookings = todayBookings
        .filter(b => b.date === todayISO)
        .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    // Hledáme aktuální schůzku
    const current = sortedBookings.find(booking => {
        const start = timeToMinutes(booking.startTime);
        const end = timeToMinutes(booking.endTime);
        // Je aktuální čas uvnitř intervalu?
        return currentMinutes >= start && currentMinutes < end;
    });

    const next = sortedBookings.find(booking => {
        return timeToMinutes(booking.startTime) > currentMinutes;
    });

    const formattedTime = getFormattedTime();
    console.log(`[DEBUG] ServerTime: ${formattedTime} (${currentMinutes}m) | Dnes: ${todayISO} | Rezervací: ${sortedBookings.length}`);
    
    // Odpověď pro Arduino
    const baseResponse = {
        currentDate: getFormattedDate(),
        currentTime: formattedTime
    };

    if (current) {
        console.log(`   -> STAV: OBSAZENO (${current.roomName})`);
        const endMins = timeToMinutes(current.endTime);
        const remaining = endMins - currentMinutes;

        return {
            ...baseResponse,
            status: "OCCUPIED",
            mainText: "OBSAZENO",
            roomName: removeAccents(current.roomName),
            rangeTime: `${current.startTime} - ${current.endTime}`,
            footerRightText: `zbyva ${remaining} min`
        };
    } else {
        console.log(`   -> STAV: VOLNO`);
        let nextInfoText = "zadna dalsi";
        let nextTimeText = "volno cely den";

        if (next) {
            const startMins = timeToMinutes(next.startTime);
            const diff = startMins - currentMinutes;
            nextInfoText = `dalsi za ${diff} min`;
            nextTimeText = `dalsi v ${next.startTime}`;
        }

        return {
            ...baseResponse,
            status: "FREE",
            mainText: "VOLNO",
            roomName: "Ucel schuzky",
            rangeTime: nextTimeText,
            footerRightText: nextInfoText
        };
    }
}

// --- ENDPOINTY ---

app.post('/booking', (req, res) => {
    const data = req.body;
    const exists = todayBookings.some(b => b.id === data.id);
    if (!exists) {
        todayBookings.push(data);
        console.log(`[NOVÁ REZERVACE] ${data.roomName} (${data.date} ${data.startTime})`);
    }
    res.json({ status: 'success' });
});

app.post('/sync-bookings', (req, res) => {
    const bookings = req.body;
    if (Array.isArray(bookings)) {
        todayBookings = bookings;
        console.log(`[SYNC] Načteno ${todayBookings.length} rezervací.`);
    }
    res.json({ status: 'synced' });
});

app.get('/bookings/today', (req, res) => {
    const today = getIsoDateCheck();
    res.json(todayBookings.filter(b => b.date === today));
});

app.get('/arduino-status', (req, res) => {
    const data = getArduinoData();
    res.json(data);
});

app.listen(PORT, () => {
    console.log(`Server běží na portu: ${PORT}`);
});
