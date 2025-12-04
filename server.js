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

// === FIX ČASU: HARD MATH (UTC+1) ===
// Server na Renderu je v UTC. Pro ČR (zima) přičteme 1 hodinu.
function getCzechDateObj() {
    const serverNow = new Date();
    // Přičteme 1 hodinu (60 min * 60 sec * 1000 ms)
    return new Date(serverNow.getTime() + (3600000)); 
}

function getCurrentTimeMinutes() {
    const d = getCzechDateObj();
    return d.getHours() * 60 + d.getMinutes();
}

function getFormattedDate() {
    const d = getCzechDateObj();
    return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

function getFormattedTime() {
    const d = getCzechDateObj();
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
}

// Funkce pro formát data YYYY-MM-DD (pro porovnání s rezervací)
function getIsoDateCheck() {
    const d = getCzechDateObj();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getArduinoData() {
    const now = getCzechDateObj();
    const currentMinutes = getCurrentTimeMinutes();
    const todayCheck = getIsoDateCheck();

    // Filtrujeme rezervace: Musí se shodovat datum podle českého času
    const sortedBookings = todayBookings
        .filter(b => b.date === todayCheck)
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

    console.log(`[CHECK] ServerČas: ${baseResponse.currentTime} | DatumCheck: ${todayCheck} | Nalezeno rezervací: ${sortedBookings.length}`);
    
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
    // Jednoduchá ochrana proti duplicitám
    const exists = todayBookings.some(b => b.id === data.id);
    if (!exists) {
        todayBookings.push(data);
        console.log(`[NOVÁ REZERVACE] ${data.roomName} (${data.startTime})`);
    }
    res.json({ status: 'success' });
});

app.post('/sync-bookings', (req, res) => {
    const bookings = req.body;
    if (Array.isArray(bookings)) {
        todayBookings = bookings;
        console.log(`[SYNC] Klient poslal ${todayBookings.length} rezervací.`);
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
