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
// Proměnná pro uložení času poslední rezervace (pro anti-spam)
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
    
    console.log(`[CHECK] Čas: ${formattedTime} (${currentMinutes}) | Dnes: ${todayISO} | Rezervací: ${todaysBookings.length}`);

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

    // 1. OCHRANA: Rate Limiting (1 minuta mezi rezervacemi celkově)
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

        // Logika překryvu: (StartA < EndB) a (StartB < EndA)
        return (newStart < existingEnd && existingStart < newEnd);
    });

    if (conflict) {
        console.log(`[COLISION] Pokus o rezervaci ${data.startTime}-${data.endTime} koliduje s ${conflict.startTime}-${conflict.endTime}`);
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

app.get('/bookings/all', (req, res) => {
    res.json(allBookings);
});

app.post('/sync-bookings', (req, res) => {
    const bookings = req.body;
    if (Array.isArray(bookings)) {
        // Při syncu ze strany klienta neřešíme kolize tak přísně, 
        // ale pro jistotu aktualizujeme seznam, pokud je server prázdný (po restartu)
        if (allBookings.length === 0) {
             allBookings = bookings;
             console.log(`[SYNC] Načteno ${allBookings.length} rezervací.`);
        }
    }
    res.json({ status: 'synced' });
});

app.get('/arduino-status', (req, res) => {
    res.json(getArduinoData());
});

app.listen(PORT, () => {
    console.log(`Server běží na portu ${PORT}`);
});
