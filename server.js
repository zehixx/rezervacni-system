const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Data
let allBookings = [];
// Čas poslední rezervace pro anti-spam
let lastBookingTime = 0;

function removeAccents(str) {
    return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
}

function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

// === ČASOVÁ ZÓNA ===
function getCzechDateObj() {
    const now = new Date();
    // Render je UTC. Přičteme 1 hodinu (zimní čas)
    return new Date(now.getTime() + 3600000); 
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

    const todaysBookings = allBookings
        .filter(b => b.date === todayISO)
        .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    const current = todaysBookings.find(booking => {
        const start = timeToMinutes(booking.startTime);
        const end = timeToMinutes(booking.endTime);
        return currentMinutes >= start && currentMinutes < end;
    });

    const next = todaysBookings.find(booking => {
        return timeToMinutes(booking.startTime) > currentMinutes;
    });

    const formattedTime = getFormattedTime();
    console.log(`[CHECK] Čas: ${formattedTime} | Rezervací: ${todaysBookings.length}`);

    const baseResponse = {
        currentDate: getFormattedDate(),
        currentTime: formattedTime
    };

    if (current) {
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
    const now = Date.now();

    // 1. OCHRANA: Anti-spam (1 minuta pauza)
    if (now - lastBookingTime < 60000) {
        const wait = Math.ceil((60000 - (now - lastBookingTime)) / 1000);
        return res.status(429).json({ 
            status: 'error', 
            message: `Pockejte prosim ${wait} sekund.` 
        });
    }

    // 2. OCHRANA: Konec musí být po začátku
    const newStart = timeToMinutes(data.startTime);
    const newEnd = timeToMinutes(data.endTime);
    if (newStart >= newEnd) {
        return res.status(400).json({ status: 'error', message: 'Cas konce musi byt po zacatku.' });
    }

    // 3. OCHRANA: Detekce překrytí
    const conflict = allBookings.find(b => {
        if (b.date !== data.date) return false;
        const existingStart = timeToMinutes(b.startTime);
        const existingEnd = timeToMinutes(b.endTime);
        // Logika překryvu
        return (newStart < existingEnd && existingStart < newEnd);
    });

    if (conflict) {
        return res.status(409).json({ 
            status: 'error', 
            message: `Kolize s: ${conflict.roomName} (${conflict.startTime}-${conflict.endTime})` 
        });
    }

    // Uložení
    const exists = allBookings.some(b => b.id === data.id);
    if (!exists) {
        allBookings.push(data);
        lastBookingTime = now;
        console.log(`[REQ] Uloženo: ${data.roomName}`);
    }
    
    res.json({ status: 'success' });
});

app.post('/sync-bookings', (req, res) => {
    const bookings = req.body;
    if (Array.isArray(bookings)) {
        // Pokud je server prázdný (po restartu), načteme data z klienta
        if (allBookings.length === 0) {
             allBookings = bookings;
             console.log(`[SYNC] Obnoveno ${allBookings.length} rezervací.`);
        }
    }
    res.json({ status: 'synced' });
});

app.get('/bookings/all', (req, res) => {
    res.json(allBookings);
});

app.get('/arduino-status', (req, res) => {
    res.json(getArduinoData());
});

app.listen(PORT, () => {
    console.log(`Server běží na portu ${PORT}`);
});
