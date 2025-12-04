const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
// Tady se drží data pro všechna zařízení
let allBookings = [];
function removeAccents(str) {
    return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
}
function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}
// === ROBUSTNÍ ČASOVÁ ZÓNA (Europe/Prague) ===
function getCzechDateObj() {
    const now = new Date();
    const czString = now.toLocaleString("en-US", {timeZone: "Europe/Prague"});
    return new Date(czString);
}
function getCurrentTimeMinutes() {
    const d = getCzechDateObj();
    return d.getHours() * 60 + d.getMinutes();
}
function getIsoDateCheck() {
    const d = getCzechDateObj();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function getFormattedDate() {
    const d = getCzechDateObj();
    return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}
function getFormattedTime() {
    const d = getCzechDateObj();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}
function getArduinoData() {
    const currentMinutes = getCurrentTimeMinutes();
    const todayISO = getIsoDateCheck();
    // 1. Vybereme jen dnešní schůzky a seřadíme je
    const todaysBookings = allBookings
        .filter(b => b.date === todayISO)
        .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    // 2. Zjistíme, jestli nějaká právě běží
    const current = todaysBookings.find(booking => {
        const start = timeToMinutes(booking.startTime);
        const end = timeToMinutes(booking.endTime);
        return currentMinutes >= start && currentMinutes < end;
    });
    // 3. Zjistíme, která je další (startuje později než teď)
    const next = todaysBookings.find(booking => {
        return timeToMinutes(booking.startTime) > currentMinutes;
    });
    const formattedTime = getFormattedTime();
    // Debug log
    console.log(`[CHECK] Čas: ${formattedTime} (${currentMinutes}) | Dnes: ${todayISO} | Rezervací: ${todaysBookings.length}`);
    const baseResponse = {
        currentDate: getFormattedDate(),
        currentTime: formattedTime
    };
    if (current) {
        // --- STAV: OBSAZENO ---
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
        // --- STAV: VOLNO ---
        let nextInfoText = "zadna dalsi";
        let nextTimeText = "volno cely den";
        if (next) {
            const startMins = timeToMinutes(next.startTime);
            const diff = startMins - currentMinutes;
            // Tady byla chyba - Arduino potřebuje vědět, ZA JAK DLOUHO to začne
            nextInfoText = `dalsi za ${diff} min`; 
            // A vpravo nahoře ukážeme, kdy začíná ta další
            nextTimeText = `dalsi v ${next.startTime}`;
        }
        return {
            ...baseResponse,

            status: "FREE",

            mainText: "VOLNO",

            roomName: "Ucel schuzky", // Default text

            rangeTime: nextTimeText,

            footerRightText: nextInfoText
        };
    }
}

// --- ENDPOINTY ---
app.post('/booking', (req, res) => {
    const data = req.body;
    // Uložíme do společného pole na serveru
    const exists = allBookings.some(b => b.id === data.id);
    if (!exists) {
        allBookings.push(data);
        console.log(`[REQ] Uloženo: ${data.roomName} (${data.date} ${data.startTime})`);
    }
    res.json({ status: 'success' });
});
// Tento endpoint slouží pro web - vrátí mu aktuální data ze serveru
app.get('/bookings/all', (req, res) => {
    res.json(allBookings);
});

// Pro Arduino
app.get('/arduino-status', (req, res) => {

    res.json(getArduinoData());
});
app.listen(PORT, () => {
    console.log(`Server běží na portu ${PORT}`);
});

