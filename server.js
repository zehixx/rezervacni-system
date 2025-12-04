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

// === FIX ČASU: Použijeme systémový čas pro Europe/Prague ===
function getCzechNow() {
    // Vytvoříme datum a převedeme ho na string v české zóně, pak zpět na objekt
    const now = new Date();
    const czString = now.toLocaleString("en-US", {timeZone: "Europe/Prague"});
    return new Date(czString);
}

// Vrátí aktuální minuty od půlnoci v ČR
function getCurrentTimeMinutes() {
    const czNow = getCzechNow();
    return czNow.getHours() * 60 + czNow.getMinutes();
}

// Vrátí datum ve formátu YYYY-MM-DD podle ČR (pro porovnání s rezervací)
function getCzechDateISO() {
    const czNow = getCzechNow();
    const year = czNow.getFullYear();
    const month = String(czNow.getMonth() + 1).padStart(2, '0');
    const day = String(czNow.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Vrátí formátované datum pro displej (D.M.YYYY)
function getFormattedDate() {
    const d = getCzechNow();
    return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

// Vrátí formátovaný čas pro displej (HH:MM)
function getFormattedTime() {
    const d = getCzechNow();
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
}

// --- LOGIKA PRO ARDUINO ---
function getArduinoData() {
    const currentMinutes = getCurrentTimeMinutes();
    const todayISO = getCzechDateISO(); 

    // Vyfiltrujeme jen rezervace pro DNEŠNÍ ČESKÝ DEN
    const sortedBookings = todayBookings
        .filter(b => b.date === todayISO)
        .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    // Hledáme aktuální schůzku
    const current = sortedBookings.find(booking => {
        const start = timeToMinutes(booking.startTime);
        const end = timeToMinutes(booking.endTime);
        return currentMinutes >= start && currentMinutes < end;
    });

    // Hledáme následující schůzku
    const next = sortedBookings.find(booking => {
        return timeToMinutes(booking.startTime) > currentMinutes;
    });

    const baseResponse = {
        currentDate: getFormattedDate(),
        currentTime: getFormattedTime()
    };

    console.log(`[CHECK] CZ Čas: ${baseResponse.currentTime} | Dnes je: ${todayISO} | Rezervací: ${sortedBookings.length}`);
    
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
    console.log("Přijat požadavek na rezervaci:", data);
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
    const today = getCzechDateISO();
    res.json(todayBookings.filter(b => b.date === today));
});

app.get('/arduino-status', (req, res) => {
    const data = getArduinoData();
    res.json(data);
});

app.listen(PORT, () => {
    console.log(`Server běží na portu: ${PORT}`);
});
