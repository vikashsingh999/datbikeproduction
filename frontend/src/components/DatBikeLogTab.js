import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { API_URL, authHeaders } from '../firebase';

function DatBikeLogTab() {
  const [order, setOrder] = useState('');
  const [orderDetails, setOrderDetails] = useState(null);
  const [orderFetchStatus, setOrderFetchStatus] = useState({ loading: false, error: '' });
  const [confirmations, setConfirmations] = useState([]);
  const [confirmationText, setConfirmationText] = useState('');
  const [operation, setOperation] = useState('0010');
  const [yieldQuantity, setYieldQuantity] = useState('1');
  const [confirmUnit, setConfirmUnit] = useState('PCE');
  const [confirmStatus, setConfirmStatus] = useState({ loading: false, success: null, message: '' });

  const [material, setMaterial] = useState('');
  const [storageLocation, setStorageLocation] = useState('0175W');
  const [serialInput, setSerialInput] = useState('');
  const [serials, setSerials] = useState([]);
  const [receivedQuantity, setReceivedQuantity] = useState(0);
  const [grStatus, setGrStatus] = useState({ loading: false, success: null, message: '' });
  // Serial numbers already received for this material in the last 2 months
  // (uppercased, from SAP) — used to block duplicates. null = not loaded yet.
  const [usedSerials, setUsedSerials] = useState(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');

  // Custom warning modal shown when a confirmation would exceed the order quantity.
  // null = hidden; otherwise { newTotal, planned }.
  const [qtyWarning, setQtyWarning] = useState(null);

  const orderInputRef = useRef(null);
  const operationInputRef = useRef(null);
  const serialInputRef = useRef(null);
  const videoRef = useRef(null);
  const codeReaderRef = useRef(null);
  const controlsRef = useRef(null);
  const lastFetchedOrderRef = useRef('');
  const lastFetchedConfirmRef = useRef('');

  const stopCamera = () => {
    if (controlsRef.current) {
      controlsRef.current.stop();
      controlsRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => stopCamera, []);

  const startCamera = async () => {
    setCameraError('');
    if (!codeReaderRef.current) {
      codeReaderRef.current = new BrowserMultiFormatReader();
    }
    setCameraActive(true);
    try {
      controlsRef.current = await codeReaderRef.current.decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current,
        (result) => {
          if (result) {
            setOrder(result.getText());
            stopCamera();
            operationInputRef.current?.focus();
          }
        }
      );
    } catch (err) {
      setCameraError('Could not access camera / Không thể truy cập camera: ' + err.message);
      setCameraActive(false);
    }
  };

  const fetchOrderDetails = async (orderId) => {
    const trimmed = orderId.trim();
    if (!trimmed || trimmed === lastFetchedOrderRef.current) return;
    lastFetchedOrderRef.current = trimmed;
    setOrderDetails(null);
    setOrderFetchStatus({ loading: true, error: '' });
    try {
      const response = await fetch(`${API_URL}/api/orders/details`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ orderId: trimmed }),
      });
      const data = await response.json();
      if (response.ok && data.orderDetails) {
        const { material: mat, operation: op, quantity: qty, storageLocation: sl, receivedQuantity: rq } = data.orderDetails;
        setOrderDetails(data.orderDetails);
        if (mat) setMaterial(mat);
        if (op) setOperation(op);
        if (qty) setYieldQuantity(qty);
        if (sl) setStorageLocation(sl);
        setReceivedQuantity(Number(rq) || 0);
        if (mat) fetchUsedSerials(mat);

        setOrderFetchStatus({ loading: false, error: '' });
      } else {
        setOrderFetchStatus({ loading: false, error: data.error || 'Could not fetch order details. / Không thể tải thông tin lệnh.' });
      }
    } catch {
      setOrderFetchStatus({ loading: false, error: 'Server connection error. / Lỗi kết nối máy chủ.' });
    }
  };

  // Load the serials already received for this material in the last 2 months so
  // we can block duplicates. Stored uppercased for case-insensitive matching.
  const fetchUsedSerials = async (mat) => {
    if (!mat) return;
    try {
      const response = await fetch(`${API_URL}/api/inventory/used-serials`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ material: mat }),
      });
      const data = await response.json();
      if (response.ok && Array.isArray(data.serials)) {
        setUsedSerials(new Set(data.serials.map((s) => String(s).trim().toUpperCase())));
      } else {
        setUsedSerials(new Set()); // fail open — SAP still rejects true duplicates on post
      }
    } catch {
      setUsedSerials(new Set());
    }
  };

  const fetchConfirmationDetails = async (orderId) => {
    const trimmed = orderId?.trim();
    if (!trimmed || trimmed === lastFetchedConfirmRef.current) return;
    lastFetchedConfirmRef.current = trimmed;
    try {
      const response = await fetch(`${API_URL}/api/orders/confirmation-details`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ orderId: trimmed }),
      });
      const data = await response.json();
      if (response.ok && data.confirmations) {
        setConfirmations(data.confirmations);
      }
    } catch {
      // silently ignore — confirmations may not exist yet
    }
  };

  const handleOrderKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fetchOrderDetails(order);
      fetchConfirmationDetails(order);
      operationInputRef.current?.focus();
    }
  };

  const handleOrderBlur = () => {
    fetchOrderDetails(order);
    fetchConfirmationDetails(order);
  };

  const addSerial = async () => {
    const value = serialInput.trim();
    if (!value) {
      setSerialInput('');
      return;
    }
    const normalized = value.toUpperCase();
    // Duplicate guard: block (but keep the typed value) if this serial was already
    // received for this material in the last 2 months, or already entered in this
    // session. Operator can edit the value but cannot continue with a duplicate.
    if (serials.some((s) => s.toUpperCase() === normalized)) {
      setGrStatus({ loading: false, success: false, message: `Duplicate: serial ${value} was already entered in this session. / Trùng lặp: serial ${value} đã được nhập trong phiên này.` });
      return;
    }
    if (usedSerials && usedSerials.has(normalized)) {
      setGrStatus({ loading: false, success: false, message: `Duplicate serial number: ${value} already exists for this material. Cannot continue. / Số serial trùng lặp: ${value} đã tồn tại cho vật tư này. Không thể tiếp tục.` });
      return;
    }
    // Restrict serial scans to the confirmed yield quantity (not the planned
    // order quantity). Must confirm the operation first, then only that many
    // serials may be scanned. serials.length counts in-flight GRs too, so a fast
    // scanner can't slip past the limit.
    const confirmedYield = confirmations.reduce((sum, c) => sum + (parseFloat(c.confirmedQuantity) || 0), 0);
    if (!(confirmedYield > 0)) {
      setGrStatus({ loading: false, success: false, message: `Confirm the operation first — no confirmed quantity yet. / Hãy xác nhận công đoạn trước — chưa có SL đã xác nhận.` });
      setSerialInput('');
      return;
    }
    if (serials.length >= confirmedYield) {
      setGrStatus({ loading: false, success: false, message: `Cannot scan more than the confirmed quantity: ${serials.length}/${confirmedYield} serials. / Không thể quét vượt quá SL đã xác nhận: ${serials.length}/${confirmedYield} serial.` });
      setSerialInput('');
      return;
    }
    setSerials((prev) => [...prev, value]);
    setSerialInput('');
    serialInputRef.current?.focus();
    setGrStatus({ loading: true, success: null, message: `Posting GR for ${value}... / Đang nhập kho cho ${value}...` });
    try {
      const response = await fetch(`${API_URL}/api/inventory/goods-receipt`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          orderId: order,
          material,
          storageLocation,
          serialNumber: value,
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setReceivedQuantity((prev) => prev + 1);
        setUsedSerials((prev) => new Set(prev || []).add(normalized));
        setGrStatus({ loading: false, success: true, message: `GR posted for serial ${value} / Đã nhập kho cho serial ${value}` });
      } else {
        setGrStatus({ loading: false, success: false, message: data.error || `GR failed for ${value} / Nhập kho thất bại cho ${value}` });
      }
    } catch (err) {
      setGrStatus({ loading: false, success: false, message: `Server error posting GR for ${value} / Lỗi máy chủ khi nhập kho cho ${value}` });
    }
  };

  const handleSerialKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSerial();
    }
  };

  const removeSerial = (value) => {
    setSerials(serials.filter((s) => s !== value));
  };

  const handleConfirmOperation = async () => {
    if (!order || !operation) {
      setConfirmStatus({ loading: false, success: false, message: 'Order and Operation are required. / Cần nhập lệnh và công đoạn.' });
      return;
    }
    // Hard block: if this confirmation would push the total over the order
    // quantity, show a branded warning modal and stop. The user can only cancel.
    const planned = parseFloat(orderDetails?.quantity);
    const alreadyConfirmed = confirmations.reduce((sum, c) => sum + (parseFloat(c.confirmedQuantity) || 0), 0);
    const newTotal = alreadyConfirmed + (parseFloat(yieldQuantity) || 0);
    if (Number.isFinite(planned) && planned > 0 && newTotal > planned) {
      setQtyWarning({ newTotal, planned });
      return;
    }
    setConfirmStatus({ loading: true, success: null, message: '' });
    try {
      const response = await fetch(`${API_URL}/api/operations/confirm`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ orderId: order, operationNumber: operation, yieldQuantity, unit: confirmUnit, confirmationText, workCenter: orderDetails?.workCenter || '' }),
      });
      const data = await response.json();
      if (response.ok) {
        setConfirmStatus({ loading: false, success: true, message: `Operation confirmed for the order ${order} / Đã xác nhận công đoạn cho lệnh ${order}` });
        lastFetchedConfirmRef.current = '';
        fetchConfirmationDetails(order);
      } else {
        setConfirmStatus({ loading: false, success: false, message: data.error || 'Confirmation failed. / Xác nhận thất bại.' });
      }
    } catch (err) {
      setConfirmStatus({ loading: false, success: false, message: 'Server connection error. / Lỗi kết nối máy chủ.' });
    }
  };


  const plannedQty = parseFloat(orderDetails?.quantity);
  const hasPlannedQty = Number.isFinite(plannedQty) && plannedQty > 0;
  const totalConfirmedQty = confirmations.reduce((sum, c) => sum + (parseFloat(c.confirmedQuantity) || 0), 0);
  // Serial scanning is capped by the confirmed yield, not the planned order quantity.
  const grComplete = totalConfirmedQty > 0 && receivedQuantity >= totalConfirmedQty;
  const scanLimitReached = totalConfirmedQty > 0 && serials.length >= totalConfirmedQty;

  return (
    <div style={pageStyle}>
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>1. Scan Order<span style={sectionTitleViStyle}>Quét mã lệnh</span></div>
        <div style={formGroup}>
          <label style={labelStyle}>Manufacturing Order / Lệnh sản xuất *</label>
          <div style={scanRowStyle}>
            <input
              ref={orderInputRef}
              type="text"
              value={order}
              onChange={(e) => { setOrder(e.target.value); setOrderDetails(null); setOrderFetchStatus({ loading: false, error: '' }); setConfirmations([]); setConfirmStatus({ loading: false, success: null, message: '' }); setGrStatus({ loading: false, success: null, message: '' }); setSerials([]); setReceivedQuantity(0); setUsedSerials(null); lastFetchedOrderRef.current = ''; lastFetchedConfirmRef.current = ''; }}
              onKeyDown={handleOrderKeyDown}
              onBlur={handleOrderBlur}
              style={inputStyle}
              placeholder="Scan with handheld scanner or type order / Quét bằng máy quét hoặc nhập lệnh"
              autoFocus
            />
            {!cameraActive ? (
              <button type="button" onClick={startCamera} style={secondaryBtnStyle}>Scan with Camera / Quét bằng camera</button>
            ) : (
              <button type="button" onClick={stopCamera} style={secondaryBtnStyle}>Stop Camera / Dừng camera</button>
            )}
          </div>
          {cameraError && <div style={errorTextStyle}>{cameraError}</div>}
          <video ref={videoRef} style={cameraActive ? videoStyle : videoHiddenStyle} muted playsInline />
          {orderFetchStatus.loading && (
            <div style={orderLoadingStyle}>Fetching order details... / Đang tải thông tin lệnh...</div>
          )}
          {orderFetchStatus.error && (
            <div style={errorTextStyle}>{orderFetchStatus.error}</div>
          )}
          {orderDetails && (
            <div style={orderDetailsCardStyle}>
              <div style={orderDetailsTitle}>Order Details / Chi tiết lệnh</div>
              <div style={orderDetailsGrid}>
                <div style={orderDetailItem}>
                  <span style={orderDetailLabel}>Material / Vật tư</span>
                  <span style={orderDetailValue}>{material || '—'}</span>
                </div>
                <div style={orderDetailItem}>
                  <span style={orderDetailLabel}>Operation / Công đoạn</span>
                  <span style={orderDetailValue}>{operation || '—'}</span>
                </div>
                <div style={orderDetailItem}>
                  <span style={orderDetailLabel}>Quantity / Số lượng</span>
                  <span style={orderDetailValue}>{orderDetails.quantity || '—'}</span>
                </div>
                <div style={orderDetailItem}>
                  <span style={orderDetailLabel}>Work Center / Khu vực sản xuất</span>
                  <span style={orderDetailValue}>{orderDetails.workCenter || '—'}</span>
                </div>
                <div style={orderDetailItem}>
                  <span style={orderDetailLabel}>Storage Location / Vị trí kho</span>
                  <span style={orderDetailValue}>{orderDetails.storageLocation || '—'}</span>
                </div>
              </div>
            </div>
          )}
          {confirmations.length > 0 && (
            <div style={confirmDetailsCardStyle}>
              <div style={orderDetailsTitle}>Confirmation Details / Chi tiết xác nhận ({confirmations.length})</div>
              <div style={confirmTotalStyle}>
                Total Confirmed Qty / Tổng SL đã xác nhận:&nbsp;
                <strong>
                  {totalConfirmedQty}{hasPlannedQty ? ` / ${plannedQty}` : ''}
                  {confirmations[0]?.unit ? ` ${confirmations[0].unit}` : ''}
                </strong>
              </div>
              {confirmations.map((conf, idx) => (
                <div key={idx} style={idx < confirmations.length - 1 ? { ...confirmRowStyle, borderBottom: '1px solid #b5d6a7' } : confirmRowStyle}>
                  <div style={orderDetailsGrid}>
                    <div style={orderDetailItem}><span style={orderDetailLabel}>Confirmation No. / Số xác nhận</span><span style={orderDetailValue}>{conf.confirmationGroup || '—'}</span></div>
                    <div style={orderDetailItem}><span style={orderDetailLabel}>Operation / Công đoạn</span><span style={orderDetailValue}>{conf.operation || '—'}</span></div>
                    <div style={orderDetailItem}><span style={orderDetailLabel}>Confirmed Qty / SL đã xác nhận</span><span style={orderDetailValue}>{conf.confirmedQuantity ? `${conf.confirmedQuantity} ${conf.unit}` : '—'}</span></div>
                    <div style={orderDetailItem}><span style={orderDetailLabel}>Entered By / Người nhập</span><span style={orderDetailValue}>{conf.enteredBy || '—'}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>2. Confirm Operation<span style={sectionTitleViStyle}>Xác nhận công đoạn</span></div>
        <div style={formGroup}>
          <label style={labelStyle}>Confirmation Text / Ghi chú xác nhận</label>
          <textarea
            value={confirmationText}
            onChange={(e) => setConfirmationText(e.target.value)}
            style={textareaStyle}
            placeholder="Enter confirmation notes or remarks... / Nhập ghi chú hoặc nhận xét..."
            rows={3}
          />
        </div>
        <div style={rowStyle}>
          <div style={formGroup}>
            <label style={labelStyle}>Yield Quantity / Số lượng sản phẩm</label>
            <input type="number" value={yieldQuantity} onChange={(e) => setYieldQuantity(e.target.value)} style={inputStyle} />
          </div>
          <div style={formGroup}>
            <label style={labelStyle}>Unit / Đơn vị</label>
            <input type="text" value={confirmUnit} onChange={(e) => setConfirmUnit(e.target.value)} style={inputStyle} />
          </div>
        </div>
        <button type="button" onClick={handleConfirmOperation} disabled={confirmStatus.loading} style={btnStyle}>
          {confirmStatus.loading ? 'Confirming... / Đang xác nhận...' : 'Confirm Operation / Xác nhận công đoạn'}
        </button>
        {confirmStatus.success === false && confirmStatus.message && (
          <div style={{ ...statusBox, backgroundColor: '#fce4d6', color: '#c65911' }}>
            {confirmStatus.message}
          </div>
        )}
      </div>

      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>3. Goods Receipt by Serial Number<span style={sectionTitleViStyle}>Nhập kho theo số Serial</span></div>
        {totalConfirmedQty > 0 && (
          <div style={grComplete ? grProgressDoneStyle : grProgressStyle}>
            Received / Đã nhập kho: <strong>{receivedQuantity} / {totalConfirmedQty}</strong>
            <span style={{ opacity: 0.7 }}> (confirmed / đã xác nhận)</span>
            {grComplete && ' — Complete / Hoàn tất'}
          </div>
        )}
        <div style={formGroup}>
          <label style={labelStyle}>Serial Number / Số Serial *</label>
          <div style={scanRowStyle}>
            <input
              ref={serialInputRef}
              type="text"
              value={serialInput}
              onChange={(e) => setSerialInput(e.target.value)}
              onKeyDown={handleSerialKeyDown}
              style={inputStyle}
              placeholder="Scan or type serial number, press Enter to add / Quét hoặc nhập số serial, nhấn Enter để thêm"
              disabled={scanLimitReached}
            />
            <button type="button" onClick={addSerial} style={scanLimitReached ? { ...secondaryBtnStyle, opacity: 0.5, cursor: 'not-allowed' } : secondaryBtnStyle} disabled={scanLimitReached}>Add / Thêm</button>
          </div>
        </div>
        {serials.length > 0 && (
          <div style={chipListStyle}>
            {serials.map((s) => (
              <span key={s} style={chipStyle}>
                {s}
                <button type="button" onClick={() => removeSerial(s)} style={chipRemoveStyle}>x</button>
              </span>
            ))}
          </div>
        )}
        {grStatus.message && (
          <div style={{ ...statusBox, backgroundColor: grStatus.success ? '#e2f0d9' : '#fce4d6', color: grStatus.success ? '#385723' : '#c65911' }}>
            {grStatus.message}
          </div>
        )}
      </div>

      {qtyWarning && (
        <div style={modalOverlayStyle} onClick={() => setQtyWarning(null)}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <span style={modalIconStyle}>!</span>
              <span style={modalTitleStyle}>Quantity Exceeded / Vượt quá số lượng</span>
            </div>
            <div style={modalBodyStyle}>
              <p style={modalTextStyle}>
                Total confirmed quantity would be <strong>{qtyWarning.newTotal}</strong>, which exceeds
                the order quantity (<strong>{qtyWarning.planned}</strong>). This confirmation is not allowed.
              </p>
              <p style={modalTextViStyle}>
                Tổng SL đã xác nhận sẽ là <strong>{qtyWarning.newTotal}</strong>, vượt quá SL lệnh
                (<strong>{qtyWarning.planned}</strong>). Không thể thực hiện xác nhận này.
              </p>
            </div>
            <div style={modalFooterStyle}>
              <button type="button" style={modalCancelBtnStyle} onClick={() => setQtyWarning(null)}>
                Cancel / Hủy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const pageStyle = { display: 'flex', flexDirection: 'column', gap: '20px' };
const sectionStyle = { display: 'flex', flexDirection: 'column', gap: '15px', padding: '16px', border: '1px solid #e5e5e5', borderRadius: '4px' };
const sectionTitleStyle = { display: 'flex', flexDirection: 'column', gap: '2px', fontWeight: '600', color: '#32363a', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.3px' };
const sectionTitleViStyle = { fontWeight: '500', fontSize: '12px', color: '#EE6A1F', textTransform: 'none', letterSpacing: 'normal' };
const rowStyle = { display: 'flex', gap: '15px' };
const formGroup = { display: 'flex', flexDirection: 'column', gap: '5px', flex: 1 };
const labelStyle = { fontWeight: '600', fontSize: '13px', color: '#6a6d70' };
const inputStyle = { padding: '8px 10px', borderRadius: '4px', border: '1px solid #89919a', fontSize: '14px', flex: 1, color: '#32363a', backgroundColor: '#fff' };
const scanRowStyle = { display: 'flex', gap: '10px' };
const btnStyle = { padding: '10px', border: 'none', borderRadius: '4px', backgroundColor: '#EE6A1F', color: '#fff', fontSize: '14px', fontWeight: '600', cursor: 'pointer' };
const secondaryBtnStyle = { padding: '8px 14px', border: '1px solid #EE6A1F', borderRadius: '4px', backgroundColor: '#fff', color: '#EE6A1F', fontSize: '13px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' };
const statusBox = { padding: '12px', borderRadius: '4px', fontWeight: '500', fontSize: '14px' };
const errorTextStyle = { color: '#bb0000', fontSize: '13px' };
const videoStyle = { width: '100%', maxHeight: '280px', borderRadius: '4px', backgroundColor: '#000' };
const videoHiddenStyle = { display: 'none' };
const chipListStyle = { display: 'flex', flexWrap: 'wrap', gap: '8px' };
const chipStyle = { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 10px', backgroundColor: '#fdece0', borderRadius: '12px', fontSize: '13px', color: '#EE6A1F' };
const chipRemoveStyle = { border: 'none', background: 'transparent', color: '#EE6A1F', cursor: 'pointer', fontWeight: 'bold' };
const orderLoadingStyle = { fontSize: '13px', color: '#6a6d70', fontStyle: 'italic' };
const orderDetailsCardStyle = { backgroundColor: '#fdf3ec', border: '1px solid #f7d4bc', borderRadius: '4px', padding: '12px 16px' };
const confirmDetailsCardStyle = { backgroundColor: '#f4f9f0', border: '1px solid #b5d6a7', borderRadius: '4px', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '0' };
const confirmRowStyle = { padding: '8px 0' };
const orderDetailsTitle = { fontWeight: '600', fontSize: '12px', color: '#EE6A1F', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '10px' };
const orderDetailsGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' };
const orderDetailItem = { display: 'flex', flexDirection: 'column', gap: '4px' };
const orderDetailLabel = { fontSize: '11px', fontWeight: '600', color: '#6a6d70', textTransform: 'uppercase' };
const orderDetailValue = { fontSize: '14px', fontWeight: '500', color: '#32363a' };
const textareaStyle = { padding: '8px 10px', borderRadius: '4px', border: '1px solid #89919a', fontSize: '14px', color: '#32363a', backgroundColor: '#fff', resize: 'vertical', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const confirmTotalStyle = { fontSize: '13px', color: '#385723', backgroundColor: '#e2f0d9', borderRadius: '4px', padding: '6px 10px', marginBottom: '10px' };
const grProgressStyle = { fontSize: '13px', color: '#6a6d70', backgroundColor: '#f3f4f5', borderRadius: '4px', padding: '6px 10px' };
const grProgressDoneStyle = { fontSize: '13px', color: '#385723', backgroundColor: '#e2f0d9', borderRadius: '4px', padding: '6px 10px', fontWeight: '600' };

// --- Quantity warning modal (branded, replaces browser confirm) ---
const modalOverlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(10, 10, 10, 0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '16px', zIndex: 1000,
};
const modalCardStyle = {
  width: '100%', maxWidth: '440px',
  backgroundColor: '#fff', borderRadius: '8px', overflow: 'hidden',
  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.3)',
};
const modalHeaderStyle = {
  display: 'flex', alignItems: 'center', gap: '10px',
  padding: '14px 20px', backgroundColor: '#0A0A0A', borderBottom: '3px solid #EE6A1F',
};
const modalIconStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: '26px', height: '26px', borderRadius: '50%',
  backgroundColor: '#EE6A1F', color: '#fff', fontWeight: '800', fontSize: '16px', flexShrink: 0,
};
const modalTitleStyle = { color: '#fff', fontSize: '15px', fontWeight: '700' };
const modalBodyStyle = { padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '10px' };
const modalTextStyle = { margin: 0, fontSize: '14px', color: '#1A1A1A', lineHeight: 1.5 };
const modalTextViStyle = { margin: 0, fontSize: '13px', color: '#6A6D70', lineHeight: 1.5 };
const modalFooterStyle = { display: 'flex', justifyContent: 'flex-end', padding: '0 20px 18px' };
const modalCancelBtnStyle = {
  padding: '9px 22px', border: '1px solid #EE6A1F', borderRadius: '4px',
  backgroundColor: '#fff', color: '#EE6A1F', fontSize: '14px', fontWeight: '600', cursor: 'pointer',
};

export default DatBikeLogTab;
