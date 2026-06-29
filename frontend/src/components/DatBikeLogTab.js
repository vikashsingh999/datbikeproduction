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
  const [grStatus, setGrStatus] = useState({ loading: false, success: null, message: '' });

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');

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
        const { material: mat, operation: op, quantity: qty, storageLocation: sl } = data.orderDetails;
        setOrderDetails(data.orderDetails);
        if (mat) setMaterial(mat);
        if (op) setOperation(op);
        if (qty) setYieldQuantity(qty);
        if (sl) setStorageLocation(sl);

        setOrderFetchStatus({ loading: false, error: '' });
      } else {
        setOrderFetchStatus({ loading: false, error: data.error || 'Could not fetch order details. / Không thể tải thông tin lệnh.' });
      }
    } catch {
      setOrderFetchStatus({ loading: false, error: 'Server connection error. / Lỗi kết nối máy chủ.' });
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
    if (!value || serials.includes(value)) {
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
              onChange={(e) => { setOrder(e.target.value); setOrderDetails(null); setOrderFetchStatus({ loading: false, error: '' }); setConfirmations([]); setConfirmStatus({ loading: false, success: null, message: '' }); setGrStatus({ loading: false, success: null, message: '' }); setSerials([]); lastFetchedOrderRef.current = ''; lastFetchedConfirmRef.current = ''; }}
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
            />
            <button type="button" onClick={addSerial} style={secondaryBtnStyle}>Add / Thêm</button>
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

export default DatBikeLogTab;
