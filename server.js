const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Data (v paměti)
let allBookings = [];
// Čas poslední rezervace (pro anti-spam)
let lastBookingTime = 0;

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
    // Render je v UTC. Přičteme 1 hodinu (3600000ms) pro CET (zima)
    // Pokud bude letní čas, bude třeba +2h.
    return new Date(now.getTime() + 3600000); 
}

function getCurrentTimeMinutes() {
    const d = getCzechDateObj();
    return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function getIsoDateCheck() {
    const d = getCzechDateObj();
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

    // 1. Filtrujeme rezervace pro dnešek
    const sortedBookings = allBookings
        .filter(b => b.date === todayISO)
        .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    // 2. Hledáme aktuální schůzku
    const current = sortedBookings.find(booking => {
        const start = timeToMinutes(booking.startTime);
        const end = timeToMinutes(booking.endTime);
        return currentMinutes >= start && currentMinutes < end;
    });

    // 3. Hledáme následující
    const next = sortedBookings.find(booking => {
        return timeToMinutes(booking.startTime) > currentMinutes;
    });

    const formattedTime = getFormattedTime();
    
    // Debug log
    console.log(`[CHECK] Čas: ${formattedTime} (${currentMinutes}) | Dnes: ${todayISO} | Rezervací: ${sortedBookings.length}`);

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

    // 1. OCHRANA: Anti-spam (1 minuta pauza mezi jakýmikoliv rezervacemi)
    if (now - lastBookingTime < 60000) {
        const waitSec = Math.ceil((60000 - (now - lastBookingTime)) / 1000);
        return res.status(429).json({ 
            status: 'error', 
            message: `Prosím počkejte ${waitSec} sekund před další rezervací.` 
        });
    }

    // 2. OCHRANA: Validace časů
    const newStart = timeToMinutes(data.startTime);
    const newEnd = timeToMinutes(data.endTime);
    
    if (newStart >= newEnd) {
        return res.status(400).json({ status: 'error', message: 'Čas konce musí být až po začátku.' });
    }

    // 3. OCHRANA: Detekce kolizí (překrývání termínů)
    const conflict = allBookings.find(b => {
        // Kontrolujeme jen stejný den
        if (b.date !== data.date) return false;

        const existingStart = timeToMinutes(b.startTime);
        const existingEnd = timeToMinutes(b.endTime);

        // Matematika překryvu: (StartA < EndB) a (StartB < EndA)
        return (newStart < existingEnd && existingStart < newEnd);
    });

    if (conflict) {
        console.log(`[COLISION] Pokus o ${data.startTime}-${data.endTime} koliduje s ${conflict.startTime}-${conflict.endTime}`);
        return res.status(409).json({ 
            status: 'error', 
            message: `V tomto čase už je rezervace: ${conflict.roomName} (${conflict.startTime}-${conflict.endTime})` 
        });
    }

    // Vše OK - Uložíme
    const exists = allBookings.some(b => b.id === data.id);
    if (!exists) {
        allBookings.push(data);
        lastBookingTime = now; // Aktualizujeme čas poslední rezervace
        console.log(`[REQ] Uloženo: ${data.roomName} (${data.date} ${data.startTime})`);
    }
    
    res.json({ status: 'success' });
});

// Endpoint pro web - vrátí všechna data
app.get('/bookings/all', (req, res) => {
    res.json(allBookings);
});

// Synchronizace z klienta (pro obnovu po restartu serveru, pokud klient má data)
app.post('/sync-bookings', (req, res) => {
    const bookings = req.body;
    if (Array.isArray(bookings)) {
        // Pokud je server prázdný (po restartu), načteme data
        if (allBookings.length === 0) {
             allBookings = bookings;
             console.log(`[SYNC] Načteno ${allBookings.length} rezervací.`);
        }
    }
    res.json({ status: 'synced' });
});

// Endpoint pro Arduino
app.get('/arduino-status', (req, res) => {
    res.json(getArduinoData());
});

app.listen(PORT, () => {
    console.log(`Server běží na portu ${PORT}`);
});
