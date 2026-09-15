require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin from a service account JSON stored in an env var.
// On Render, set FIREBASE_SERVICE_ACCOUNT to the full JSON of the service account key.
let firebaseReady = false;
try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (raw && raw.trim().startsWith('{')) {
        admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
        firebaseReady = true;
    } else {
        console.warn('WARNING: FIREBASE_SERVICE_ACCOUNT not set or invalid — API auth will reject all requests until configured.');
    }
} catch (err) {
    console.warn('WARNING: Could not initialize Firebase Admin:', err.message);
}

// Verify the Firebase ID token sent by the frontend before any SAP call.
async function authenticate(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!firebaseReady) {
        return res.status(503).json({ error: 'Authentication not configured on the server.' });
    }
    if (!token) {
        return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }
    try {
        req.user = await admin.auth().verifyIdToken(token);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
    }
}

// Gate every /api route behind Firebase authentication.
app.use('/api', authenticate);

const SAP_BASE_URL = process.env.SAP_BASE_URL;
const sapAuth = { username: process.env.SAP_USER, password: process.env.SAP_PASS };

// SAP OData requires a CSRF token before any POST. Fetch it via a GET with x-csrf-token: Fetch.
async function fetchCsrfToken(url) {
    const response = await axios.get(url, {
        auth: sapAuth,
        headers: { 'x-csrf-token': 'Fetch', 'Accept': 'application/json' },
    });
    return {
        csrfToken: response.headers['x-csrf-token'],
        cookies: response.headers['set-cookie'],
    };
}

function todayIso() {
    return new Date().toISOString().split('T')[0] + 'T00:00:00';
}

// Everything already received against an order by goods receipt (movement type
// 101): the total quantity, and every serial value that came with it.
//
// Both come from one query. A_MaterialDocumentItem has no IsReversed/IsReversal
// fields (selecting them makes SAP answer 404, which used to look like "nothing
// received"); cancelled receipts are flagged by GoodsMovementIsCancelled instead.
// No $select at all, because it drops the expanded navigations. An order with no
// documents returns 200 with an empty result set, so any error here is a real
// error and must propagate rather than be read as a count of zero.
//
// The scanned value is written to BOTH the document header text and the item's
// serial numbers. Serial-managed materials populate to_SerialNumbers; materials
// that are not serial-managed (the battery packs) keep it only in the header
// text, so both sources are collected.
async function fetchOrderReceipts(orderId) {
    const filter = `ManufacturingOrder eq '${orderId}' and GoodsMovementType eq '101'`;
    // Encode spaces only - percent-encoding the '/' in a nav path makes SAP
    // silently return an empty set.
    let url = `${SAP_BASE_URL}/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem`
        + `?$filter=${filter.replace(/ /g, '%20')}`
        + `&$expand=to_SerialNumbers,to_MaterialDocumentHeader&$format=json&$top=500`;

    let received = 0;
    const serials = [];
    for (let page = 0; page < 100 && url; page++) {
        const response = await axios.get(url, { auth: sapAuth, headers: { 'Accept': 'application/json' } });
        for (const item of (response.data?.d?.results || [])) {
            if (item.GoodsMovementIsCancelled === true) continue; // reversed receipt
            const qty = parseFloat(item.QuantityInEntryUnit);
            if (Number.isFinite(qty)) received += qty;
            const headerText = item.to_MaterialDocumentHeader?.MaterialDocumentHeaderText;
            if (headerText && String(headerText).trim()) serials.push(String(headerText).trim());
            for (const serial of (item.to_SerialNumbers?.results || [])) {
                if (serial?.SerialNumber) serials.push(String(serial.SerialNumber).trim());
            }
        }
        url = response.data?.d?.__next || null;
    }
    return { received, serials };
}

// Total confirmed yield posted against an order, summed over every confirmation
// (all operations). This is the ceiling for how many serials may be received.
async function sumConfirmedYield(orderId) {
    // An order with no confirmations returns 200 and an empty result set, so
    // errors are real errors here too and are left to propagate.
    const url = `${SAP_BASE_URL}/sap/opu/odata/sap/API_PROD_ORDER_CONFIRMATION_2_SRV/ProdnOrdConf2`
        + `?$filter=OrderID eq '${orderId}'&$select=ConfirmationYieldQuantity&$format=json`;
    const response = await axios.get(url, { auth: sapAuth, headers: { 'Accept': 'application/json' } });
    const results = response.data?.d?.results || [];
    return results.reduce((sum, conf) => {
        const qty = parseFloat(conf.ConfirmationYieldQuantity);
        return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0);
}

// ---------------------------------------------------------------------------
// Cutover serial numbers
//
// Serials are issued per production month as `MO-YYYYMM NNNNN` (e.g.
// `MO-202609 45678`). Packs built before the cutover were backflushed by the old
// process, and when one of them comes back for rework an operator can scan it
// again — receiving it a second time and writing a stale serial into the
// material document header text. The duplicate check does not catch those,
// because the original receipt was never posted through this app (and may be
// outside the duplicate look-back window).
//
// So: for a material with a cutover configured, only serials issued AFTER the
// cutover serial may be received. The cutover serial itself is the last one used
// before the switch, so it is excluded too.
//
// Configure via the SERIAL_CUTOVER env var, `material=serial` separated by `;`.
// `*` sets a default for every material not listed:
//     SERIAL_CUTOVER=221000022=MO-202609 45678;201000021=MO-202609 12000
// Leave it unset and nothing is enforced (current behaviour).
// ---------------------------------------------------------------------------

// Accepts MO-2609 44290, MO-202609 44200, MO-202609-44200, MO20260944200 — the
// labels on the line write the production month with a two-digit year, the
// cutover values handed over by the team use four, and separators vary between
// scanners and hand-typed entries. Every spelling of the same serial has to read
// alike, so the month is normalised to YYYYMM.
function parseMoSerial(value) {
    const text = String(value || '').trim().toUpperCase();
    // A separator between the month and the sequence settles the split outright.
    const separated = /^MO[\s-]*(\d{4}|\d{6})[\s-]+(\d{1,12})$/.exec(text);
    if (separated) return buildMoSerial(separated[1], separated[2]);
    // Run together there is nothing to split on, so take whichever leading width
    // gives a real month: MO260944290 is 2609 + 44290, MO20260944200 is 202609 +
    // 44200, and the wrong reading of either lands outside the 2000-2099 range.
    const joined = /^MO[\s-]*(\d{5,18})$/.exec(text);
    if (!joined) return null;
    const digits = joined[1];
    return buildMoSerial(digits.slice(0, 6), digits.slice(6))
        || buildMoSerial(digits.slice(0, 4), digits.slice(4));
}

// A month block (YYMM or YYYYMM) plus a sequence, or null when that is not a real
// month. A two-digit year means 20YY, which is what the labels intend.
function buildMoSerial(monthDigits, sequenceDigits) {
    if (!/^(\d{4}|\d{6})$/.test(monthDigits)) return null;
    if (!/^\d{1,12}$/.test(sequenceDigits)) return null;
    const year = monthDigits.length === 6
        ? Number(monthDigits.slice(0, 4))
        : 2000 + Number(monthDigits.slice(0, 2));
    const month = Number(monthDigits.slice(-2));
    if (month < 1 || month > 12) return null;
    if (year < 2000 || year > 2099) return null;
    return { period: year * 100 + month, sequence: Number(sequenceDigits) };
}

// Does this read as an MO- serial at all? Everything else belongs to the older
// numbering, which carries no month to compare and is left alone.
function isMoSerial(value) {
    return /^MO[\s-]*\d/.test(String(value || '').trim().toUpperCase());
}

// Serial ordering: production month first, then the sequence within that month.
// Compared numerically, so a shorter sequence (9999) still sorts below a longer
// one (45678) — a plain string comparison would get that wrong.
function isSerialAfter(candidate, cutover) {
    if (candidate.period !== cutover.period) return candidate.period > cutover.period;
    return candidate.sequence > cutover.sequence;
}

function parseCutoverConfig(raw) {
    const map = new Map();
    for (const entry of String(raw || '').split(';')) {
        const text = entry.trim();
        if (!text) continue;
        const at = text.indexOf('=');
        if (at < 0) {
            console.warn(`WARNING: SERIAL_CUTOVER entry "${text}" is not material=serial — ignored.`);
            continue;
        }
        const material = text.slice(0, at).trim();
        const serial = text.slice(at + 1).trim();
        const parsed = parseMoSerial(serial);
        if (!material || !parsed) {
            console.warn(`WARNING: SERIAL_CUTOVER entry "${text}" has no usable MO-YYYYMM NNNNN serial — ignored.`);
            continue;
        }
        map.set(material, { raw: serial, parsed });
    }
    return map;
}

const SERIAL_CUTOVERS = parseCutoverConfig(process.env.SERIAL_CUTOVER);
if (SERIAL_CUTOVERS.size === 0) {
    console.log('SERIAL_CUTOVER not configured — legacy serials are not blocked.');
} else {
    for (const [material, { raw }] of SERIAL_CUTOVERS) {
        console.log(`Serial cutover for material ${material}: receiving only serials after ${raw}`);
    }
}

// The floor an order's serials sit above: the lowest serial it has already
// received. The first serial scanned sets it, and it never moves, because no
// serial below it can be received afterwards. Null when the order has nothing
// that reads as MO-YYYYMM NNNNN.
//
// Values not in that pattern (a VIN, a document header note such as "GR") are
// ignored rather than blocking the order, which keeps lines that do not use
// MO- serials out of this rule.
function orderSerialFloor(serials) {
    let floor = null;
    for (const value of serials || []) {
        const parsed = parseMoSerial(value);
        if (!parsed) continue;
        if (!floor || isSerialAfter(floor.parsed, parsed)) floor = { raw: String(value).trim(), parsed };
    }
    return floor;
}

// The floor that applies to a scan. One floor per material, and it never climbs.
//
// It cannot be tied to an order, and it cannot follow the most recent scanning.
// IT's case: the line ends a day at 46500, starts the next day at 46503, then
// comes back for 46502 and 46501 - packs pulled for a leak test or a fault, days
// later, possibly on a different order. Those must go through. Only serials from
// before the line's floor - 45899 against a floor of 45900 - must not.
//
// So: the lowest serial received for the material is the floor, and a receipt can
// only ever confirm it, never raise it. Where SERIAL_CUTOVER names a floor for the
// material that value wins outright, which is what makes it exact rather than
// whatever the receipt history happens to hold (checkSerialCutover enforces it,
// and it is also the way to sit above test data left in a system).
//
// Returns { raw, parsed } or null when nothing comparable has been received yet.
function effectiveSerialFloor(orderSerials, materialFloor) {
    // The order's own receipts are not date-filtered, so they count even if they
    // fall outside the material look-back window.
    const own = orderSerialFloor(orderSerials);
    if (!materialFloor) return own;
    if (!own) return materialFloor;
    return isSerialAfter(own.parsed, materialFloor.parsed) ? materialFloor : own;
}

// A serial must sit above the floor. Anything below it came off the line before
// this order's range started, so it is a pack being received a second time.
//
// Deliberately NOT a running sequence check: the line scans out of order all the
// time - a pack pulled for a leak test or a fault rejoins the run later - so
// 45455 then 45454 is normal and allowed. Only going below the floor is refused.
// Returns null when the scan is fine, otherwise a bilingual message.
//
// Only applies when the scanned serial is in the MO-YYYYMM NNNNN pattern - there
// is no meaningful order between two VINs.
function checkSerialAboveFloor(serialNumber, floor) {
    const value = String(serialNumber || '').trim();
    const parsed = parseMoSerial(value);
    if (!parsed) return null; // not an MO- serial: the cutover rule handles the rest
    if (!floor) return null;  // nothing comparable received for this material yet
    if (isSerialAfter(parsed, floor.parsed)) return null;
    return `Serial ${value} is below ${floor.raw}, the lowest serial received for this material. / Serial ${value} thấp hơn ${floor.raw}, serial thấp nhất đã nhập kho cho vật tư này.`;
}

function cutoverForMaterial(material) {
    return SERIAL_CUTOVERS.get(String(material || '').trim()) || SERIAL_CUTOVERS.get('*') || null;
}

// Returns null when the serial may be received, otherwise a bilingual message.
function checkSerialCutover(material, serialNumber) {
    const cutover = cutoverForMaterial(material);
    if (!cutover) return null; // no cutover for this material -> nothing to enforce
    const value = String(serialNumber || '').trim();
    // Serials outside the MO- scheme are from the older numbering and carry no
    // month to compare against, so the cutover lets them through (IT, Sep 2026).
    if (!isMoSerial(value)) return null;
    const parsed = parseMoSerial(value);
    if (!parsed) {
        return `Serial ${value} is not in the current format (MO-YYMM NNNNN), so it cannot be received. / Serial ${value} không đúng định dạng hiện tại (MO-YYMM NNNNN), không thể nhập kho.`;
    }
    if (!isSerialAfter(parsed, cutover.parsed)) {
        return `Legacy serial ${value}: only serials issued after ${cutover.raw} can be received. / Serial cũ ${value}: chỉ nhận serial phát hành sau ${cutover.raw}.`;
    }
    return null;
}

// How far back to look for other orders when working out a material's floor.
// Longer than the duplicate window, which only has to cover recent rescans: this
// one has to reach the previous order for the material, which on a slow-moving
// material can be months old.
const SERIAL_FLOOR_MONTHS = Number(process.env.SERIAL_FLOOR_MONTHS) > 0 ? Number(process.env.SERIAL_FLOOR_MONTHS) : 6;

// Lowest serial received for a material across every order: {raw, parsed} or null.
// Same query shape as the duplicate check - encode spaces only, no $select, or
// the expanded navigations come back empty.
async function fetchMaterialSerialFloor(material, months = SERIAL_FLOOR_MONTHS) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    cutoff.setHours(0, 0, 0, 0);
    const since = cutoff.toISOString().split('.')[0];

    const filter = `Material eq '${material}' and GoodsMovementType eq '101'`
        + ` and to_MaterialDocumentHeader/PostingDate ge datetime'${since}'`;
    let url = `${SAP_BASE_URL}/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem`
        + `?$filter=${filter.replace(/ /g, '%20')}`
        + `&$expand=to_SerialNumbers,to_MaterialDocumentHeader&$format=json&$top=500`;

    const values = [];
    for (let page = 0; page < 100 && url; page++) {
        const response = await axios.get(url, { auth: sapAuth, headers: { 'Accept': 'application/json' } });
        for (const item of (response.data?.d?.results || [])) {
            if (item.GoodsMovementIsCancelled === true) continue;
            const headerText = item.to_MaterialDocumentHeader?.MaterialDocumentHeaderText;
            if (headerText && String(headerText).trim()) values.push(String(headerText).trim());
            for (const serial of (item.to_SerialNumbers?.results || [])) {
                if (serial?.SerialNumber) values.push(String(serial.SerialNumber).trim());
            }
        }
        url = response.data?.d?.__next || null;
    }
    return orderSerialFloor(values);
}

// One scan should not pay for a material-wide read every time. The floor never
// rises, so a stale cache cannot refuse a scan it should have allowed, and a
// successful receipt drops the entry so the next scan sees fresh data.
const FLOOR_CACHE_MS = 60000;
const materialFloorCache = new Map();

async function getMaterialSerialFloor(material) {
    const key = String(material || '').trim();
    if (!key) return null;
    const hit = materialFloorCache.get(key);
    if (hit && Date.now() - hit.at < FLOOR_CACHE_MS) return hit.floor;
    const floor = await fetchMaterialSerialFloor(key);
    materialFloorCache.set(key, { at: Date.now(), floor });
    return floor;
}

// Endpoint 0: Fetch Order Details
app.post('/api/orders/details', async (req, res) => {
    try {
        const { orderId } = req.body;
        if (!orderId) return res.status(400).json({ error: 'Missing required field: orderId' });

        console.log('Fetching order details from SAP for order:', orderId);

        const url = `${SAP_BASE_URL}/sap/opu/odata/sap/API_PRODUCTION_ORDER_2_SRV/A_ProductionOrder_2('${orderId}')?$expand=to_ProductionOrderOperation&$format=json`;
        const response = await axios.get(url, {
            auth: sapAuth,
            headers: { 'Accept': 'application/json' },
        });

        const header = response.data?.d || null;
        const opResults = header?.to_ProductionOrderOperation?.results || [];
        const op = opResults[0] || {};

        console.log('SAP ManufacturingOrder:', header?.ManufacturingOrder);
        console.log('SAP Material:', header?.Material);
        console.log('SAP StorageLocation:', header?.StorageLocation);
        console.log('SAP operations count:', opResults.length);
        console.log('SAP first op WorkCenter:', op?.WorkCenter);

        if (!header || !header.ManufacturingOrder) {
            return res.status(404).json({ error: `Order ${orderId} not found in SAP. Check the order number.` });
        }

        // Serials already received for this order. Read from SAP (not kept in the
        // browser) so reloading the page cannot reset the scan counter, and the
        // highest serial so far so the UI can refuse a lower one straight away.
        const [{ received: receivedQuantity, serials: receivedSerials }, materialFloor] = await Promise.all([
            fetchOrderReceipts(orderId),
            // Only powers the warning shown before scanning; the goods-receipt
            // endpoint reads it again and refuses the post if it cannot.
            getMaterialSerialFloor(header.Material).catch((err) => {
                console.warn('Could not read the material serial floor:', err.message);
                return null;
            }),
        ]);
        // A configured cutover is the exact floor for the material; otherwise fall
        // back to the lowest serial the receipt history holds.
        const configured = cutoverForMaterial(header.Material);
        const serialFloor = configured || effectiveSerialFloor(receivedSerials, materialFloor);
        console.log('SAP goods receipts already posted:', receivedQuantity,
            '| serial floor:', serialFloor ? `${serialFloor.raw}${configured ? ' (SERIAL_CUTOVER)' : ' (lowest received)'}` : '(none)');

        return res.status(200).json({
            success: true,
            orderDetails: {
                material: header.Material || '',
                operation: op.ManufacturingOrderOperation || '',
                quantity: header.MfgOrderPlannedTotalQty || op.OpPlannedTotalQuantity || '',
                storageLocation: header.StorageLocation || '',
                workCenter: op.WorkCenter || '',
                receivedQuantity,
                serialCutover: cutoverForMaterial(header.Material)?.raw || '',
                serialFloor: serialFloor?.raw || '',
                serialFloorIsCutover: Boolean(configured),
            },
        });
    } catch (error) {
        console.error('Error fetching order details:', error.message);
        return res.status(500).json({ error: error.message, details: error.response?.data });
    }
});

// Endpoint 1: Fetch Confirmation Details
app.post('/api/orders/confirmation-details', async (req, res) => {
    try {
        const { orderId } = req.body;
        if (!orderId) return res.status(400).json({ error: 'Missing required field: orderId' });

        console.log('Fetching confirmation details from SAP for order:', orderId);

        const url = `${SAP_BASE_URL}/sap/opu/odata/sap/API_PROD_ORDER_CONFIRMATION_2_SRV/ProdnOrdConf2?$filter=OrderID eq '${orderId}'&$format=json`;
        const response = await axios.get(url, {
            auth: sapAuth,
            headers: { 'Accept': 'application/json' },
        });

        const results = response.data?.d?.results || [];
        // No confirmations yet is a normal state, not an error — return an empty list.
        const confirmations = results.map(conf => ({
            confirmationGroup: conf.ConfirmationGroup || '',
            operation: conf.OrderOperation || '',
            confirmedQuantity: conf.ConfirmationYieldQuantity || '',
            unit: conf.ConfirmationUnit || '',
            postingDate: conf.PostingDate || '',
            enteredBy: conf.EnteredByUser || '',
        }));

        return res.status(200).json({ success: true, confirmations });
    } catch (error) {
        // SAP returns 404 when the filter matches no confirmations — that just
        // means none have been posted yet, so return an empty list rather than error.
        if (error.response?.status === 404) {
            return res.status(200).json({ success: true, confirmations: [] });
        }
        console.error('Error fetching confirmation details:', error.message);
        return res.status(500).json({ error: error.message, details: error.response?.data });
    }
});

// Endpoint 2: Operational Activity Confirmation
app.post('/api/operations/confirm', async (req, res) => {
    try {
        const { orderId, operationNumber, confirmedQuantity, yieldQuantity, confirmationText, workCenter } = req.body;
        if (!orderId || !operationNumber) {
            return res.status(400).json({ error: 'Missing required fields: orderId, operationNumber' });
        }

        const csrfBase = `${SAP_BASE_URL}/sap/opu/odata/sap/API_PROD_ORDER_CONFIRMATION_2_SRV/`;
        const { csrfToken, cookies } = await fetchCsrfToken(csrfBase);

      

        const now = new Date();
const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const hours = now.getHours();
const minutes = now.getMinutes();
const seconds = now.getSeconds();



        const payload = {
            OrderID: orderId,
            Sequence: '0',
            OrderOperation: operationNumber,
            OrderSuboperation: '',
            ConfirmationText: confirmationText || '',
            ProductionUnit: 'PCE',
            IsFinalConfirmation: true,
            OpenReservationsIsCleared: false,
            IsReversed: false,
            IsReversal: false,
           ConfirmationEntryDate: `/Date(${startOfDay.getTime()})/`,
            ConfirmationEntryTime: `PT${String(hours).padStart(2, '0')}H${String(minutes).padStart(2, '0')}M${String(seconds).padStart(2, '0')}S`,
            Plant: '1000',
            WorkCenter: workCenter || '',
            ConfirmationUnit: 'PCE',
            ConfirmationUnitISOCode: 'PCE',
            ConfirmationUnitSAPCode: 'ST',
            ConfirmationYieldQuantity: String(yieldQuantity || confirmedQuantity || '1'),
            ConfirmationScrapQuantity: '0.000',
            ConfirmationReworkQuantity: '0.000',
        };

        console.log('Posting confirmation to SAP:', payload);

        const postUrl = `${SAP_BASE_URL}/sap/opu/odata/sap/API_PROD_ORDER_CONFIRMATION_2_SRV/ProdnOrdConf2`;
        const sapResponse = await axios.post(postUrl, payload, {
            auth: sapAuth,
            headers: {
                'x-csrf-token': csrfToken,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Cookie': Array.isArray(cookies) ? cookies.join('; ') : (cookies || ''),
            },
        });

        return res.status(200).json({ success: true, sapResponse: sapResponse.data });
    } catch (error) {
        console.error('Error posting confirmation to SAP:', error.message);
        const sapMessage = error.response?.data?.error?.message?.value
            || error.response?.data?.error?.message
            || error.message;
        const status = error.response?.status || 500;
        return res.status(status).json({ error: sapMessage, details: error.response?.data });
    }
});

// Endpoint 3: Goods Receipt — one serial number at a time
app.post('/api/inventory/goods-receipt', async (req, res) => {
    try {
        const { orderId, material, storageLocation, serialNumber } = req.body;
        if (!orderId || !material || !serialNumber) {
            return res.status(400).json({ error: 'Missing mandatory fields: orderId, material, serialNumber' });
        }

        // Legacy serials from before the cutover must not be received again (a
        // reworked pack coming back through the line would otherwise post a stale
        // serial into the document header text).
        const cutoverError = checkSerialCutover(material, serialNumber);
        if (cutoverError) {
            return res.status(409).json({ error: cutoverError });
        }

        // Hard limit, enforced here rather than only in the UI: the number of
        // serials received for an order may never exceed its confirmed yield.
        // Browser state resets on refresh, SAP's does not — so both numbers are
        // read back from SAP immediately before every post.
        const [confirmedYield, receipts, materialFloor] = await Promise.all([
            sumConfirmedYield(orderId),
            fetchOrderReceipts(orderId),
            // Skip the read when SERIAL_CUTOVER already fixes the floor for this
            // material - checkSerialCutover above has enforced it.
            cutoverForMaterial(material) ? null : getMaterialSerialFloor(material),
        ]);
        const alreadyReceived = receipts.received;
        if (!(confirmedYield > 0)) {
            return res.status(409).json({ error: `Confirm the operation first — order ${orderId} has no confirmed quantity yet. / Hãy xác nhận công đoạn trước — lệnh ${orderId} chưa có SL đã xác nhận.` });
        }
        if (alreadyReceived >= confirmedYield) {
            return res.status(409).json({ error: `Goods receipt already complete: ${alreadyReceived}/${confirmedYield} received for order ${orderId}. / Đã nhập kho đủ: ${alreadyReceived}/${confirmedYield} cho lệnh ${orderId}.` });
        }

        // A serial below the material's floor belongs to a pack built before the
        // line reached that point. Scanning above the floor out of sequence, days
        // later, on any order, is normal work and stays allowed.
        //
        // Only when SERIAL_CUTOVER does not already fix the floor: with a cutover
        // configured, checkSerialCutover above is the whole rule. Falling through
        // to here would measure against this order's own lowest serial and refuse
        // a pack the line legitimately comes back to later in the run.
        if (!cutoverForMaterial(material)) {
            const floorError = checkSerialAboveFloor(serialNumber, effectiveSerialFloor(receipts.serials, materialFloor));
            if (floorError) {
                return res.status(409).json({ error: floorError });
            }
        }

        // Use confirmation service as CSRF token source (same as original n8n flow)
        const csrfBase = `${SAP_BASE_URL}/sap/opu/odata/sap/API_PROD_ORDER_CONFIRMATION_2_SRV/ProdnOrdConf2?$top=1&$format=json`;
        const { csrfToken, cookies } = await fetchCsrfToken(csrfBase);

        const grDate = todayIso();

        const payload = {
            PostingDate: grDate,
            DocumentDate: grDate,
            GoodsMovementCode: '02',
               VersionForPrintingSlip: '1',        
    ManualPrintIsTriggered: 'X',         
            MaterialDocumentHeaderText: serialNumber,
            to_MaterialDocumentItem: [
                {
                    Material: material,
                    Plant: '1000',
                    StorageLocation: storageLocation || '',
                    GoodsMovementType: '101',
                    GoodsMovementRefDocType: 'F',
                    ManufacturingOrder: orderId,
                    EntryUnit: 'PCE',
                    QuantityInEntryUnit: '1',
                    to_SerialNumbers: [{ SerialNumber: serialNumber }],
                },
            ],
        };

        console.log('Posting Goods Receipt to SAP:', payload);

        const postUrl = `${SAP_BASE_URL}/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader`;
        const sapResponse = await axios.post(postUrl, payload, {
            auth: sapAuth,
            headers: {
                'x-csrf-token': csrfToken,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Cookie': Array.isArray(cookies) ? cookies.join('; ') : (cookies || ''),
            },
        });

        materialFloorCache.delete(String(material || '').trim()); // this receipt may raise the floor
        return res.status(200).json({ success: true, sapResponse: sapResponse.data });
    } catch (error) {
        console.error('Error posting GR to SAP:', error.message);
        const sapMessage = error.response?.data?.error?.message?.value
            || error.response?.data?.error?.message
            || error.message;
        const status = error.response?.status || 500;
        return res.status(status).json({ error: sapMessage, details: error.response?.data });
    }
});

// Default look-back window (months) for the duplicate-serial check. Configurable
// via env so QA (where GRs post with a fixed past date) can widen it without
// touching production, which posts with real dates and uses the 2-month default.
const DUP_CHECK_MONTHS = Number(process.env.DUP_CHECK_MONTHS) > 0 ? Number(process.env.DUP_CHECK_MONTHS) : 2;

// Fetch every "serial" value already received (goods movement 101) for a given
// material within the last `months` months. Used to block duplicate serials.
//
// IMPORTANT: the app writes the scanned value into BOTH the material-document
// Header Text and the item's serial number. Serial-managed materials keep it in
// to_SerialNumbers; NON-serial-managed materials keep it ONLY in the header text
// (to_SerialNumbers comes back empty). So we must collect from BOTH sources or
// duplicates on non-serial materials slip through (this was the reported bug).
//
// Filters the date on the material-document header via the nav path (verified
// working on tenant 416787) so SAP does the date scoping. Cancelled/reversed
// receipts are ignored so a reversed GR doesn't cause a false block.
async function fetchUsedSerials(material, months = DUP_CHECK_MONTHS) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    cutoff.setHours(0, 0, 0, 0);
    const since = cutoff.toISOString().split('.')[0]; // YYYY-MM-DDTHH:mm:ss

    const filter = `Material eq '${material}' and GoodsMovementType eq '101'`
        + ` and to_MaterialDocumentHeader/PostingDate ge datetime'${since}'`;
    // Encode spaces only. Do NOT full-encode: percent-encoding the '/' in the
    // header nav path makes SAP silently return an empty set. No $select here so
    // both expanded navs (serials + header) are returned intact.
    let url = `${SAP_BASE_URL}/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem`
        + `?$filter=${filter.replace(/ /g, '%20')}`
        + `&$expand=to_SerialNumbers,to_MaterialDocumentHeader`
        + `&$format=json&$top=500`;

    const used = new Set();
    const add = (v) => { if (v && String(v).trim()) used.add(String(v).trim().toUpperCase()); };
    // Follow SAP's server-side paging (d.__next) with a safety cap on pages.
    for (let page = 0; page < 100 && url; page++) {
        let response;
        try {
            response = await axios.get(url, { auth: sapAuth, headers: { Accept: 'application/json' } });
        } catch (error) {
            if (error.response?.status === 404) break; // no documents match -> nothing used
            throw error;
        }
        const items = response.data?.d?.results || [];
        for (const item of items) {
            if (item.GoodsMovementIsCancelled === true) continue;
            add(item.to_MaterialDocumentHeader?.MaterialDocumentHeaderText); // non-serial materials
            for (const s of (item.to_SerialNumbers?.results || [])) add(s?.SerialNumber); // serial materials
        }
        url = response.data?.d?.__next || null; // absolute URL to the next page, if any
    }
    return used;
}

// Endpoint 4: Used serial values for a material (last N months) — duplicate guard.
app.post('/api/inventory/used-serials', async (req, res) => {
    try {
        const { material, months } = req.body;
        if (!material) return res.status(400).json({ error: 'Missing required field: material' });
        // Body may override the window, else use the env-configured default.
        const window = Number(months) > 0 ? Number(months) : DUP_CHECK_MONTHS;
        const set = await fetchUsedSerials(material, window);
        return res.status(200).json({ success: true, material, months: window, serials: Array.from(set) });
    } catch (error) {
        console.error('Error fetching used serials:', error.message);
        return res.status(500).json({ error: error.message, details: error.response?.data });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend server running on port ${PORT}`));
