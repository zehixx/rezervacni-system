const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose'); 
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI; 

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- 1. PŘIPOJENÍ K DATABÁZI ---
if (!MONGO_URI) {
    console.error("CHYBA: Chybí MONGO_URI v nastavení Renderu!");
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('✅ MongoDB připojeno. Data jsou v bezpečí.'))
        .catch(err => console.error('❌ MongoDB chyba:', err));
}

// --- 2. SCHÉMA DATABÁZE ---
const meetingSchema = new mongoose.Schema({
    roomName: String,
    date: String,
    startTime: String,
    endTime: String,
    createdAt: { type: Date, default: Date.now }
});
const Meeting = mongoose.model('Meeting', meetingSchema);

// Proměnná pro anti-spam (drží se v paměti běžícího serveru)
let lastBookingTime = 0;

// --- POMOCNÉ FUNKCE ---
function removeAccents(str) {
    return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
}

function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

// === ČASOVÁ ZÓNA (Hard Fix UTC+1 pro ČR) ===
function getCzechDateObj() {
    const now = new Date();
    // Render je v UTC. Přičteme 1 hodinu (3600000 ms).
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

// --- LOGIKA PRO ARDUINO ---
async function getArduinoData() {
    const currentMinutes = getCurrentTimeMinutes();
    const todayISO = getIsoDateCheck();

    // Načteme dnešní rezervace z DB
    const todaysBookings = await Meeting.find({ date: todayISO }).lean();
    
    // Seřadíme
    todaysBookings.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

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

app.post('/booking', async (req, res) => {
    const data = req.body;
    const now = Date.now();

    // 1. OCHRANA: Anti-spam (1 minuta pauza)
    if (now - lastBookingTime < 60000) {
        const wait = Math.ceil((60000 - (now - lastBookingTime)) / 1000);
        return res.status(429).json({ 
            status: 'error', 
            message: `Moc rychle! Počkejte ${wait}s před další rezervací.` 
        });
    }

    // 2. OCHRANA: Čas
    const newStart = timeToMinutes(data.startTime);
    const newEnd = timeToMinutes(data.endTime);
    if (newStart >= newEnd) {
        return res.status(400).json({ status: 'error', message: 'Čas konce musí být až po začátku.' });
    }

    // 3. OCHRANA: Kolize v DB
    // Hledáme v DB jakýkoliv záznam ve stejný den, který se překrývá
    try {
        const conflict = await Meeting.findOne({
            date: data.date,
            $or: [
                // (StartA < EndB) a (EndA > StartB) = překrytí
                { startTime: { $lt: data.endTime }, endTime: { $gt: data.startTime } },
                { startTime: data.startTime }
            ]
        });

        if (conflict) {
            return res.status(409).json({ 
                status: 'error', 
                message: `KOLIZE: V tomto čase už je: ${conflict.roomName} (${conflict.startTime}-${conflict.endTime})` 
            });
        }

        // 4. Uložení do MongoDB
        await Meeting.create({
            roomName: data.roomName,
            date: data.date,
            startTime: data.startTime,
            endTime: data.endTime
        });

        lastBookingTime = now; // Reset časovače
        console.log(`[DB] Uloženo: ${data.roomName}`);
        res.json({ status: 'success' });

    } catch (e) {
        console.error(e);
        res.status(500).json({ status: 'error', message: 'Chyba databáze.' });
    }
});

// Získání všech rezervací z DB (pro Web)
app.get('/bookings/all', async (req, res) => {
    const bookings = await Meeting.find({}).lean();
    res.json(bookings);
});

// Synchronizace z klienta (Už není potřeba, protože máme DB, ale endpoint necháme, aby web nepadal)
app.post('/sync-bookings', (req, res) => {
    res.json({ status: 'synced' });
});

// Data pro Arduino
app.get('/arduino-status', async (req, res) => {
    const data = await getArduinoData();
    res.json(data);
});

app.listen(PORT, () => {
    console.log(`Server běží na portu ${PORT}`);
});
