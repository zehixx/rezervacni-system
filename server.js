const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
// DŮLEŽITÉ: Render přiděluje port dynamicky, musíme použít process.env.PORT
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

// --- FIX ČASOVÉHO PÁSMA (CZECH TIME) ---
function getCzechDate() {
    const now = new Date();
    // Získáme UTC čas v milisekundách
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    // Přičteme 1 hodinu pro zimní čas (CET). V létě by to bylo +2.
    const czechTime = new Date(utc + (3600000 * 1)); 
    return czechTime;
}

function getCurrentTimeMinutes() {
    const now = getCzechDate(); 
    return now.getHours() * 60 + now.getMinutes();
}

function getFormattedDate() {
    const d = getCzechDate();
    return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

function getFormattedTime() {
    const d = getCzechDate();
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
}

// --- LOGIKA PRO ARDUINO ---
function getArduinoData() {
    const now = getCzechDate(); // Používáme fixnutý český čas
    const currentMinutes = getCurrentTimeMinutes();
    
    // Pro jednoduchost porovnáváme jen čas, datum bereme z rezervací, které nám poslal web
    // (Předpokládáme, že web posílá jen dnešní rezervace nebo je filtrujeme)
    const todayDateISO = now.toISOString().split('T')[0]; // Toto je sice UTC datum, ale pro ID to stačí

    const sortedBookings = todayBookings
        .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    // Hledáme aktuální schůzku
    const current = sortedBookings.find(booking => {
        const start = timeToMinutes(booking.startTime);
        const end = timeToMinutes(booking.endTime);
        return currentMinutes >= start && currentMinutes < end;
    });

    const next = sortedBookings.find(booking => {
        return timeToMinutes(booking.startTime) > currentMinutes;
    });

    const baseResponse = {
        currentDate: getFormattedDate(),
        currentTime: getFormattedTime()
    };

    console.log(`[CHECK] CZ Čas: ${baseResponse.currentTime} (${currentMinutes} min) | Rezervací: ${sortedBookings.length}`);
    
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
        console.log(`[NOVÁ REZERVACE] ${data.roomName}`);
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
    res.json(todayBookings);
});

app.get('/arduino-status', (req, res) => {
    const data = getArduinoData();
    res.json(data);
});

app.listen(PORT, () => {
    console.log(`Server běží na portu: ${PORT}`);
});
