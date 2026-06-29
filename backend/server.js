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

// Count how many units have already been received against an order via goods
// receipt (movement type 101). Each GR posts one serial with QuantityInEntryUnit
// '1', so we sum the received quantities to get the total already performed.
async function countGoodsReceipts(orderId) {
    const url = `${SAP_BASE_URL}/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem`
        + `?$filter=ManufacturingOrder eq '${orderId}' and GoodsMovementType eq '101'`
        + `&$select=QuantityInEntryUnit,IsReversed,IsReversal&$format=json`;
    const response = await axios.get(url, {
        auth: sapAuth,
        headers: { 'Accept': 'application/json' },
    });
    const items = response.data?.d?.results || [];
    // Ignore reversed/reversal items so cancelled receipts don't count.
    return items.reduce((sum, item) => {
        if (item.IsReversed === true || item.IsReversal === true) return sum;
        const qty = parseFloat(item.QuantityInEntryUnit);
        return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0);
}

// Fetch the planned total quantity for an order, used to cap goods receipts.
async function getOrderPlannedQuantity(orderId) {
    const url = `${SAP_BASE_URL}/sap/opu/odata/sap/API_PRODUCTION_ORDER_2_SRV/A_ProductionOrder_2('${orderId}')`
        + `?$select=MfgOrderPlannedTotalQty&$format=json`;
    const response = await axios.get(url, {
        auth: sapAuth,
        headers: { 'Accept': 'application/json' },
    });
    const qty = parseFloat(response.data?.d?.MfgOrderPlannedTotalQty);
    return Number.isFinite(qty) ? qty : 0;
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

        // How many units have already been received via goods receipt, so the UI
        // can show progress and block over-receipt.
        const receivedQuantity = await countGoodsReceipts(orderId);

        return res.status(200).json({
            success: true,
            orderDetails: {
                material: header.Material || '',
                operation: op.ManufacturingOrderOperation || '',
                quantity: header.MfgOrderPlannedTotalQty || op.OpPlannedTotalQuantity || '',
                storageLocation: header.StorageLocation || '',
                workCenter: op.WorkCenter || '',
                receivedQuantity,
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
        if (results.length === 0) {
            return res.status(404).json({ error: `No confirmations found for order ${orderId}.` });
        }

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

        const today = new Date();
        today.setHours(0, 0, 0, 0);

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
            ConfirmationEntryDate: `/Date(${today.getTime()})/`,
            ConfirmationEntryTime: 'PT08H04M34S',
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

        // Block goods receipt beyond the order's planned quantity. Each GR posts a
        // single unit, so a new receipt requires received + 1 <= planned.
        const [plannedQuantity, receivedQuantity] = await Promise.all([
            getOrderPlannedQuantity(orderId),
            countGoodsReceipts(orderId),
        ]);
        if (plannedQuantity > 0 && receivedQuantity + 1 > plannedQuantity) {
            return res.status(409).json({
                error: `Goods receipt already complete for order ${orderId}: ${receivedQuantity}/${plannedQuantity} units received. No further GR allowed.`,
            });
        }

        // Use confirmation service as CSRF token source (same as original n8n flow)
        const csrfBase = `${SAP_BASE_URL}/sap/opu/odata/sap/API_PROD_ORDER_CONFIRMATION_2_SRV/ProdnOrdConf2?$top=1&$format=json`;
        const { csrfToken, cookies } = await fetchCsrfToken(csrfBase);

        const grDate = '2026-04-15T00:00:00';
        const payload = {
            PostingDate: grDate,
            DocumentDate: grDate,
            GoodsMovementCode: '02',
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend server running on port ${PORT}`));
