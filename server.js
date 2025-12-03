const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

let todayBookings = [];

// Odstranění diakritiky pro Arduino
function removeAccents(str) {
    return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
}

function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

// Získání času ve formátu pro porovnání (H:MM)
function getCurrentTimeMinutes() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
}

function getFormattedDate() {
    const d = new Date();
    return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

function getFormattedTime() {
    const d = new Date();
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
}

// --- LOGIKA PRO ARDUINO ---
function getArduinoData() {
    const now = new Date();
    const currentMinutes = getCurrentTimeMinutes();
    const todayDateISO = now.toISOString().split('T')[0];

    // Seřadíme rezervace podle času
    const sortedBookings = todayBookings
        .filter(b => b.date === todayDateISO)
        .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    // Hledáme aktuální schůzku
    const current = sortedBookings.find(booking => {
        const start = timeToMinutes(booking.startTime);
        const end = timeToMinutes(booking.endTime);
        // Logika: Je aktuální čas větší/roven začátku A ZÁROVEŇ menší než konec?
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

    // Debugging výpis do konzole (abychom viděli, co se děje)
    console.log(`[CHECK] Čas: ${baseResponse.currentTime} (${currentMinutes} min) | Rezervací dnes: ${sortedBookings.length}`);
    
    if (current) {
        console.log(`   -> STAV: OBSAZENO (${current.roomName})`);
        const endMins = timeToMinutes(current.endTime);
        const remaining = endMins - currentMinutes;

        return {
            ...baseResponse,
            status: "OCCUPIED",
            mainText: "OBSAZENO",
            roomName: removeAccents(current.roomName),
            rangeTime: `${current.startTime} - ${current.endTime}`, // Zkráceno pro lepší fit
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

// 1. Přidání rezervace
app.post('/booking', (req, res) => {
    const data = req.body;
    // Kontrola duplicity (aby se tam nepřidávalo to samé pořád dokola při refresh)
    const exists = todayBookings.some(b => b.id === data.id);
    if (!exists) {
        todayBookings.push(data);
        console.log(`[NOVÁ REZERVACE] ${data.roomName} (${data.startTime}-${data.endTime})`);
    }
    res.json({ status: 'success' });
});

// 2. Synchronizace všech rezervací (volá se při načtení stránky)
app.post('/sync-bookings', (req, res) => {
    const bookings = req.body; // Pole rezervací z localStorage
    if (Array.isArray(bookings)) {
        // Přepíšeme pole na serveru tím, co poslal klient (zajistí shodu)
        // Filtrujeme jen ty, co mají datum
        todayBookings = bookings.filter(b => b.date);
        console.log(`[SYNC] Synchronizováno ${todayBookings.length} rezervací z klienta.`);
    }
    res.json({ status: 'synced' });
});

// 3. Pro web - seznam
app.get('/bookings/today', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    res.json(todayBookings.filter(b => b.date === today));
});

// 4. Pro Arduino
app.get('/arduino-status', (req, res) => {
    const data = getArduinoData();
    res.json(data);
});

app.listen(PORT, () => {
    console.log(`--------------------------------------------------`);
    console.log(`Server běží na: http://192.168.90.55:${PORT}`); // <-- Zkontroluj IP!
    console.log(`Čas serveru je: ${new Date().toLocaleTimeString()}`);
    console.log(`--------------------------------------------------`);
});