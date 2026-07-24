const API_URL = "https://script.google.com/macros/s/AKfycbwsqH0xnZVk5g3BJDhro4B9rKcMqYi0kGIFJcPDSulsUpT0Vs_reZQH5Ufc2QVwZ1Fi4Q/exec";

let attendanceData = JSON.parse(localStorage.getItem('mfg5_attendance')) || [];
let restroomData = JSON.parse(localStorage.getItem('factoryRestroom')) || [];
const scanChannel = new BroadcastChannel('mfg5_scan_channel');

// 🛑 ตัวแปรสำหรับจำกัดเวลาการสแกนซ้ำ (Debounce Map)
let lastScanTimeMap = {};

// 🔊 ระบบสร้างเสียงแจ้งเตือน (Web Audio API - ไม่ต้องใช้ไฟล์เสียงภายนอก)
function playBeep(type) {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        if (type === 'success') {
            oscillator.frequency.setValueAtTime(800, audioCtx.currentTime); // เสียงสูงสำเร็จ
            gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.15);
        } else if (type === 'warning') {
            oscillator.frequency.setValueAtTime(400, audioCtx.currentTime); // เสียงต่ำเตือน
            gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.3);
        }
    } catch (e) {
        console.log("AudioContext not supported or blocked", e);
    }
}

// 🛡️ ป้องกัน XSS: escape ค่าก่อนแทรกลง innerHTML เพราะข้อมูลอาจมาจาก cloud API ที่ไม่มี auth หรือไฟล์นำเข้า/แก้ไขเองได้
function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 🛠️ ฟังก์ชันช่วยแปลงวันที่จาก ISO String ให้เป็นรูปแบบวันที่/เวลาไทย
function formatCloudDate(dateStr) {
    if (!dateStr || dateStr === '-') return '-';
    let d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
        let datePart = d.toLocaleDateString('th-TH');
        let timePart = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        return `${datePart} ${timePart}`;
    }
    return dateStr;
}

// 🛠️ ผสาน (merge) ข้อมูลจาก cloud กับ local โดยไม่ทิ้งแถวที่มีอยู่ใน local แต่ยังไม่ถูกซิงค์ขึ้น cloud สำเร็จ
// ใช้ id เป็นหลักในการจับคู่แถวเดียวกัน ถ้าไม่มี id ใช้ empCode+key รองลงมา
// แถวที่ตรงกันทั้งสองฝั่ง ใช้เวอร์ชันจาก cloud (ถือว่า cloud คือข้อมูลล่าสุดของแถวนั้น)
// แถวที่มีเฉพาะใน local (เช่น เพิ่งนำเข้า/สแกน แต่ยังส่งขึ้น cloud ไม่สำเร็จ) จะยังคงอยู่ ไม่ถูกลบทิ้ง
function mergeCloudWithLocal(cloudArr, localArr, keyFn) {
    const map = new Map();
    localArr.forEach(item => map.set(keyFn(item), item));
    cloudArr.forEach(item => map.set(keyFn(item), item));
    let merged = Array.from(map.values());
    merged.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
    return merged;
}
function attendanceKey(item) { return item.id ? `id:${item.id}` : `${item.empCode}|${item.date}|${item.checkIn}`; }
function restroomKey(item) { return item.id ? `id:${item.id}` : `${item.empCode}|${item.startTime}`; }

async function fetchCloudData() {
    try {
        let resAtt = await fetch(`${API_URL}?sheet=attendance`);
        let attJson = await resAtt.json();
        if (Array.isArray(attJson)) {
            // แปลงรูปแบบวันที่/เวลาที่ดึงมาจาก Cloud ให้แสดงผลเป็นรูปแบบไทย
            let cloudFormatted = attJson.map(item => {
                return {
                    ...item,
                    checkIn: formatCloudDate(item.checkIn),
                    checkOut: formatCloudDate(item.checkOut)
                };
            });
            if (cloudFormatted.length === 0) {
                // 🛠️ cloud ว่างจริง (เช่นเพิ่งกด "ล้างข้อมูล" จากเครื่องไหนก็ตาม) ให้เชื่อและล้าง local ตาม
                attendanceData = [];
            } else {
                // 🛠️ [แก้บัค] เดิมทับ local ด้วยของ cloud ตรงๆ ถ้า cloud มาไม่ครบ (เช่น backend รับพร้อมกันไม่ไหวตอนนำเข้าไฟล์ใหญ่)
                // ข้อมูลที่เพิ่งนำเข้า/สแกนแต่ยังไม่ถูกบันทึกขึ้น cloud จะหายไปทันที — ตอนนี้ผสาน (merge) แทนการทับ
                let currentLocal = JSON.parse(localStorage.getItem('mfg5_attendance')) || [];
                attendanceData = mergeCloudWithLocal(cloudFormatted, currentLocal, attendanceKey);
            }
            localStorage.setItem('mfg5_attendance', JSON.stringify(attendanceData));
        }

        let resRest = await fetch(`${API_URL}?sheet=restroom`);
        let restJson = await resRest.json();
        if (Array.isArray(restJson)) {
            if (restJson.length === 0) {
                restroomData = [];
            } else {
                let currentLocalRestroom = JSON.parse(localStorage.getItem('factoryRestroom')) || [];
                restroomData = mergeCloudWithLocal(restJson, currentLocalRestroom, restroomKey);
            }
            localStorage.setItem('factoryRestroom', JSON.stringify(restroomData));
        }

        loadDashboard();
        showSummary();
        renderTable();
        renderRestroom();
        renderDisplayTable();
    } catch (err) {
        console.error("ใช้ข้อมูล Local แทน", err);
    }
}

async function sendToCloud(payload) {
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) });
        return res.ok;
    } catch (err) {
        console.error("บันทึก Cloud ไม่สำเร็จ", err);
        return false;
    }
}

function updateClock() {
    let now = new Date();
    let timeEl = document.getElementById("time");
    let dateEl = document.getElementById("date");
    if(timeEl) timeEl.innerHTML = now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    if(dateEl) dateEl.innerHTML = now.toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric", weekday: 'long' });
}
setInterval(updateClock, 1000);
updateClock();

document.addEventListener('click', function(e) {
    const empInput = document.getElementById('employee') || document.getElementById('employeeRestroom');
    if (empInput && !e.target.closest('button') && !e.target.closest('input') && !e.target.closest('.modal')) {
        empInput.focus();
    }
});

function loadDashboard() {
    attendanceData = JSON.parse(localStorage.getItem("mfg5_attendance")) || [];
    let sumTotal = document.getElementById("sumTotal");
    let sumIn = document.getElementById("sumIn");
    let sumLate = document.getElementById("sumLate");
    let sumOT = document.getElementById("sumOT");

    if(sumTotal) sumTotal.innerHTML = new Set(attendanceData.map(x => x.empCode)).size;
    if(sumIn) sumIn.innerHTML = attendanceData.filter(x => x.checkIn && x.checkIn !== '-').length;
    if(sumLate) sumLate.innerHTML = attendanceData.filter(x => x.status && x.status.includes("สาย")).length;
    if(sumOT) sumOT.innerHTML = attendanceData.filter(x => x.ot && x.ot === "ทำ").length;
}

let isScanning = false;
let currentShift = 'กะเช้า';

function convertThaiToEng(str) {
    const numMap = { 'ๅ': '1', '/': '2', '-': '3', 'ภ': '4', 'ถ': '5', 'ุ': '6', 'ึ': '7', 'ค': '8', 'ต': '9', 'จ': '0' };
    const charMap = { 'ะ': 'a', 'ั': 'b', 'ี': 'c', 'ิ': 'd', 'ำ': 'e', 'โ': 'f', 'เ': 'g', '้': 'h', '่': 'j', 'า': 'k', 'ส': 'l', 'ื': 'm', 'ท': 'n', 'ม': 'o', 'ย': 'p', 'น': 'q', 'ร': 'r', 'ห': 's', 'ก': 't', 'ไ': 'w', 'ป': 'x', 'ผ': 'y', 'ฝ': 'z', 'ช': 'c', 'ข': 'x', 'ฟ': 'a', 'ด': 'f', 'อ': 'v' };
    return str.split('').map(ch => numMap[ch] || charMap[ch] || ch).join('');
}

// 🛠️ ค้นหารหัสพนักงานความยาว 6 ตัวอักษร/ตัวเลขที่แน่นอนตามเงื่อนไข
function extractEmpCode(rawStr) {
    let converted = convertThaiToEng(rawStr);
    let match = converted.match(/[A-Z0-9]{6}/i);
    if (match) {
        return match[0].toUpperCase();
    }
    return converted.trim();
}

function setShift(shiftName, btnElement) {
    currentShift = shiftName;
    document.querySelectorAll('.shift-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    if(btnElement) btnElement.classList.add('active');
    const messageBox = document.getElementById('message');
    if (messageBox) {
        messageBox.innerText = `พร้อมสแกน [${currentShift}]`;
    }
    document.getElementById('employee')?.focus();
}

function handleScan(event) {
    if (event.key === 'Enter' || event.keyCode === 13 || event.key === 'Tab') {
        event.preventDefault();
        if (isScanning) return;
        const input = document.getElementById('employee');
        if(!input) return;
        let rawCode = input.value.trim();
        if (!rawCode) return;

        const empCode = extractEmpCode(rawCode);
        
        // ตรวจสอบความยาวรหัสต้องเป็น 6 ตัวอักษร
        if (empCode.length !== 6) {
            playBeep('warning');
            const messageBox = document.getElementById('message');
            if(messageBox) {
                messageBox.innerText = `⚠️ รหัสไม่ถูกต้อง (ต้องมี 6 ตัวอักษร): ${empCode}`;
                messageBox.style.color = '#d32f2f';
            }
            input.value = '';
            input.focus();
            return;
        }

        isScanning = true;
        processAttendance(empCode);
        input.value = '';
        setTimeout(() => { isScanning = false; input.focus(); }, 200);
    }
}

// 🕐 กติกากะ/OT (ยืนยันกับหน้างานแล้ว):
//   กะเช้า: เข้างาน 08:00 ตรง ไม่มีเกรซ (สายทันทีถ้าเกิน 08:00) เลิกงานปกติ 17:30
//   กะดึก: เข้างาน 20:00 ตรง ไม่มีเกรซ เลิกงานปกติ 05:30 (วันถัดไป)
//   ทั้งสองกะ: คนไม่ทำ OT จะไม่สแกนขาออกเลย — สแกนครั้งเดียวตอนเข้างานถือว่าจบวันนั้น (checkOut '-' = ไม่ทำ OT)
//   คนทำ OT สแกนซ้ำตอนออก "ไม่ว่าจะสแกนเวลาไหนก็ตาม" ก็นับเป็น OT ทันที — ไม่มีช่วงเวลากำกับ
//   ตัวชี้วัดเดียวว่าใครทำ OT คือ "มีการสแกนขาออกหรือไม่" เท่านั้น
function processAttendance(empCode) {
    const now = new Date();
    const currentTime = now.getTime();
    const messageBox = document.getElementById('message');

    // 🛑 ป้องกันสแกนซ้ำภายใน 0.5 วินาที (500 มิลลิวินาที)
    if (lastScanTimeMap[empCode] && (currentTime - lastScanTimeMap[empCode] < 500)) {
        playBeep('warning');
        if (messageBox) {
            messageBox.innerText = `⚠️ รหัส ${empCode} สแกนเร็วเกินไป กรุณารอสักครู่`;
            messageBox.style.color = '#f59e0b';
        }
        return;
    }
    lastScanTimeMap[empCode] = currentTime;

    const todayStr = now.toLocaleDateString('th-TH');
    const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const fullDateTimeStr = `${todayStr} ${timeStr}`;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // 🛠️ เพราะคนไม่ทำ OT ไม่สแกนขาออก checkOut '-' คือสถานะปกติตลอดไปสำหรับวันนั้น ไม่ใช่ข้อผิดพลาด
    // สแกนครั้งที่ 2 ของพนักงานคนเดิมจะถือเป็น "ยืนยัน OT" ก็ต่อเมื่อยังอยู่ในช่วงกะเดียวกัน (เช็คจากเวลาที่ผ่านไปจริง
    // ไม่ใช่วันที่ตามปฏิทิน เพราะกะดึกข้ามเที่ยงคืน) ถ้าพ้นช่วงนี้ไปแล้วให้ถือเป็นการสแกนเข้างานของกะ/วันใหม่เสมอ
    const SAME_SHIFT_WINDOW_MS = 20 * 60 * 60 * 1000; // 20 ชม. ครอบคลุมกะ + ช่วง OT แต่ไม่ข้ามไปกะถัดไป
    const openRecord = attendanceData.find(item => item.empCode === empCode && item.checkOut === '-');
    const isOtConfirmScan = openRecord && openRecord.rawCheckInTime && (currentTime - openRecord.rawCheckInTime <= SAME_SHIFT_WINDOW_MS);

    if (isOtConfirmScan) {
        // --- สแกนครั้งที่ 2: ยืนยัน OT ของกะที่เข้างานไว้ ---
        // 🛠️ สแกนขาออกไม่ว่าจะเวลาไหนก็นับ OT ทันที ไม่มีช่วงเวลากำกับ (ตัวชี้วัดเดียวคือ "มีสแกนขาออกหรือไม่")
        const record = openRecord;
        record.checkOut = fullDateTimeStr;
        record.ot = 'ทำ';

        playBeep('success');
        if (messageBox) {
            messageBox.innerText = `🔴 [ยืนยันทำ OT] รหัส: ${empCode} เวลาออก: ${timeStr}`;
            messageBox.style.color = '#ea580c';
        }
        scanChannel.postMessage({ type: 'CHECK_OUT', empCode, status: record.status, ot: 'ทำ', shift: record.shift, time: timeStr });
        sendToCloud({
            sheet: 'attendance', action: 'update_checkout', empCode: empCode,
            date: record.date, checkOut: fullDateTimeStr, ot: 'ทำ'
        });
    } else {
        // --- สแกนเข้างานของวันนี้ ---
        let alreadyToday = attendanceData.find(item => item.empCode === empCode && item.date === todayStr);
        if (alreadyToday) {
            playBeep('warning');
            if (messageBox) {
                messageBox.innerText = `⚠️ รหัส ${empCode} สแกนเข้างานของวันนี้ไปแล้ว (${alreadyToday.checkOut !== '-' ? 'ยืนยัน OT แล้ว' : 'ไม่ทำ OT'})`;
                messageBox.style.color = '#d32f2f';
            }
            return;
        }

        let statusStr = "ปกติ";
        if (currentShift === 'กะเช้า' && currentMinutes > (8 * 60)) {
            statusStr = `สาย (${currentMinutes - (8 * 60)} นาที)`;
        } else if (currentShift === 'กะดึก') {
            let shiftInMinutes = 20 * 60;
            if (now.getHours() >= 12 && currentMinutes > shiftInMinutes) {
                statusStr = `สาย (${currentMinutes - shiftInMinutes} นาที)`;
            } else if (now.getHours() < 12) {
                let lateMins = (currentMinutes + 1440) - shiftInMinutes;
                if (lateMins > 0) statusStr = `สาย (${lateMins} นาที)`;
            }
        }

        const newRecord = {
            id: Date.now(),
            empCode: empCode,
            date: todayStr,
            checkIn: fullDateTimeStr,
            checkOut: '-',
            shift: currentShift,
            status: statusStr,
            ot: 'ไม่ทำ',
            rawCheckInTime: currentTime
        };

        attendanceData.unshift(newRecord);
        playBeep('success');
        if (messageBox) {
            messageBox.innerText = `🟢 [เข้างาน - ${currentShift}] รหัส: ${empCode} (${statusStr}) — ถ้าทำ OT ให้สแกนซ้ำตอนออกในช่วงเวลา OT`;
            messageBox.style.color = statusStr.includes("สาย") ? '#d32f2f' : '#2e7d32';
        }
        scanChannel.postMessage({ type: 'CHECK_IN', empCode, status: statusStr, shift: currentShift, time: timeStr });
        sendToCloud({ sheet: 'attendance', action: 'add', ...newRecord });
    }

    saveAndRenderApp();
}

function renderTable() {
    const listTable = document.getElementById('list');
    if (!listTable) return;
    const searchVal = document.getElementById('search')?.value.toLowerCase() || '';
    listTable.innerHTML = '';

    attendanceData.filter(i => (i.empCode || '').toLowerCase().includes(searchVal)).forEach(item => {
        const tr = document.createElement('tr');
        const status = item.status || '';
        let statusBadge = status.includes("สาย")
            ? `<span style="background: #ff4d4f; color: white; padding: 3px 8px; border-radius: 12px; font-size: 13px;">⚠️ ${escapeHtml(status)}</span>`
            : `<span style="background: #52c41a; color: white; padding: 3px 8px; border-radius: 12px; font-size: 13px;">ปกติ</span>`;

        let otBadge = (item.ot === "ทำ")
            ? `<span style="background: #1890ff; color: white; padding: 3px 8px; border-radius: 12px; font-size: 13px;">⭐ ทำ OT</span>`
            : `<span style="color: #888;">ไม่ทำ</span>`;

        tr.innerHTML = `
            <td style="padding: 12px;"><b>${escapeHtml(item.empCode)}</b></td>
            <td style="padding: 12px;"><span style="color: #2e7d32; font-weight: bold;">${escapeHtml(item.checkIn)}</span></td>
            <td style="padding: 12px;"><span style="color: #c62828; font-weight: bold;">${escapeHtml(item.checkOut)}</span></td>
            <td style="padding: 12px;">${escapeHtml(item.shift)}</td>
            <td style="padding: 12px;">${statusBadge}</td>
            <td style="padding: 12px;">${otBadge}</td>
            <td style="padding: 12px;">
                <button onclick="openEditModal(${item.id})" class="btn-edit">✏️ แก้ไข</button>
                <button onclick="deleteRecord(${item.id})" class="btn-danger">ลบ</button>
            </td>
        `;
        listTable.appendChild(tr);
    });
    updateDashboardApp();
    showSummary();
}

function updateDashboardApp() {
    const todayStr = new Date().toLocaleDateString('th-TH');
    const todayRecs = attendanceData.filter(i => i.date === todayStr);
    if(document.getElementById('total')) document.getElementById('total').innerText = todayRecs.length;
    if(document.getElementById('checkin')) document.getElementById('checkin').innerText = todayRecs.filter(i => i.checkIn !== '-').length;
    if(document.getElementById('checkout')) document.getElementById('checkout').innerText = todayRecs.filter(i => i.checkOut !== '-').length;
    if(document.getElementById('ot')) document.getElementById('ot').innerText = todayRecs.filter(i => i.ot === 'ทำ').length;
}

function showSummary() {
    const summaryList = document.getElementById('summaryList');
    if(summaryList) {
        summaryList.innerHTML = '';
        attendanceData.forEach(item => {
            let tr = document.createElement('tr');
            tr.innerHTML = `
                <td><b>${escapeHtml(item.empCode)}</b></td>
                <td>${escapeHtml(item.checkIn)}</td>
                <td>${escapeHtml(item.checkOut)}</td>
                <td>${escapeHtml(item.shift)}</td>
                <td>${escapeHtml(item.status)}</td>
                <td>${escapeHtml(item.ot)}</td>
            `;
            summaryList.appendChild(tr);
        });
    }
    loadDashboard();
}

function openEditModal(id) {
    const record = attendanceData.find(i => i.id === id);
    if (!record) return;
    document.getElementById('editId').value = record.id;
    document.getElementById('editEmpCode').value = record.empCode;
    document.getElementById('editCheckIn').value = record.checkIn;
    document.getElementById('editCheckOut').value = record.checkOut;
    document.getElementById('editShift').value = record.shift;
    
    // 🛠️ กำหนดค่าสถานะให้เลือก Dropdown เป็น "สาย" หรือ "ปกติ" อัตโนมัติ
    const statusSelect = document.getElementById('editStatus');
    if ((record.status || '').includes('สาย')) {
        statusSelect.value = 'สาย';
    } else {
        statusSelect.value = 'ปกติ';
    }

    document.getElementById('editOt').value = record.ot === 'ทำ' ? 'ทำ' : 'ไม่ทำ';
    document.getElementById('editModal').style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
    document.getElementById('employee')?.focus();
}

function saveEdit() {
    const id = Number(document.getElementById('editId').value);
    const record = attendanceData.find(i => i.id === id);
    if (record) {
        record.empCode = document.getElementById('editEmpCode').value.trim();
        record.checkIn = document.getElementById('editCheckIn').value.trim();
        record.checkOut = document.getElementById('editCheckOut').value.trim();
        record.shift = document.getElementById('editShift').value;
        record.status = document.getElementById('editStatus').value.trim();
        record.ot = document.getElementById('editOt').value;
        saveAndRenderApp();
        closeEditModal();

        // 🛠️ [แก้บัค] เดิมแก้ไขแค่ local ไม่ sync ขึ้น cloud เลย พอโหลดข้อมูลใหม่จาก cloud
        // (fetchCloudData merge โดยให้ cloud ทับ local เมื่อ id ตรงกัน) ค่าที่แก้ไขจะถูกเขียนทับกลับเป็นค่าเดิม
        sendToCloud({
            sheet: 'attendance', action: 'update', id: record.id, empCode: record.empCode,
            date: record.date, checkIn: record.checkIn, checkOut: record.checkOut,
            shift: record.shift, status: record.status, ot: record.ot
        });
        scanChannel.postMessage({ type: 'REFRESH_DATA' });
    }
}

function saveAndRenderApp() {
    localStorage.setItem('mfg5_attendance', JSON.stringify(attendanceData));
    renderTable();
    showSummary();
}

function deleteRecord(id) {
    if (confirm('ต้องการลบรายการนี้ใช่หรือไม่?')) {
        const recordToDelete = attendanceData.find(i => i.id === id);
        attendanceData = attendanceData.filter(i => i.id !== id);
        saveAndRenderApp();

        // 🛠️ ส่งคำสั่งลบไปที่ Cloud และบอกหน้าอื่นๆ ให้รีเฟรช
        if (recordToDelete) {
            sendToCloud({ 
                sheet: 'attendance', 
                action: 'delete', 
                id: recordToDelete.id, 
                empCode: recordToDelete.empCode, 
                date: recordToDelete.date 
            });
        }
        scanChannel.postMessage({ type: 'REFRESH_DATA' });
    }
}

function clearData() {
    if (confirm('⚠️ ต้องการล้างข้อมูลการลงเวลาทั้งหมดใช่หรือไม่?')) {
        attendanceData = [];
        saveAndRenderApp();
        sendToCloud({ sheet: 'attendance', action: 'clear' });
        
        // 🛠️ ส่งสัญญาณบอกหน้าอื่นๆ ให้ล้างข้อมูลตาม
        scanChannel.postMessage({ type: 'REFRESH_DATA' });
    }
}

function exportExcel() {
    if (attendanceData.length === 0) { alert("ไม่มีข้อมูล"); return; }
    let csv = "\ufeffรหัสพนักงาน,วันที่/เวลาเข้า,วันที่/เวลาออก,กะ,สถานะ,OT\n";
    attendanceData.forEach(x => { csv += `${x.empCode},${x.checkIn},${x.checkOut},${x.shift},${x.status},${x.ot}\n`; });
    downloadCSV(csv, `attendance_log_${new Date().toISOString().slice(0, 10)}.csv`);
}

// 📥 นำเข้าข้อมูลจากไฟล์ .csv หรือ .xlsx/.xls
// รองรับ 2 รูปแบบ:
//   1) ไฟล์ export จากระบบนี้เอง: รหัสพนักงาน,วันที่/เวลาเข้า(เต็ม),วันที่/เวลาออก,กะ,สถานะ,OT
//   2) ไฟล์ตารางที่ก็อปมาจากหน้าจอ (ไม่มีหัวตาราง): รหัสพนักงาน, วันที่(YYYY-MM-DD), เวลาเข้า, เวลาออก, กะ, สถานะ, OT("ไม่มี"/"มี"), ...คอลัมน์ปุ่มที่ไม่ใช้
async function importExcel(event) {
    const file = event.target.files[0];
    if (!file) return;
    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

    const reader = new FileReader();
    reader.onload = async function(e) {
        const messageBox = document.getElementById('message');
        try {
            let rows = [];

            if (isExcel) {
                if (typeof XLSX === 'undefined') {
                    alert("โหลดตัวอ่านไฟล์ Excel ไม่สำเร็จ (ต้องมีอินเทอร์เน็ต) กรุณาลองใหม่ หรือใช้ไฟล์ .csv แทน");
                    return;
                }
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
            } else {
                let text = e.target.result.replace(/^\ufeff/, ''); // ตัด BOM ออก
                rows = text.split(/\r?\n/).filter(l => l.trim() !== '').map(line => line.split(','));
            }

            // 🛠️ [แก้บัค] เดิมยิง sendToCloud พร้อมกันทีเดียวทุกแถว (ไม่ await) — ถ้านำเข้าหลายสิบแถว
            // Google Apps Script รับพร้อมกันไม่ไหว บางแถวจะไม่ถูกบันทึกจริงที่ cloud แบบเงียบๆ
            // พอไปเปิดหน้าสรุป ระบบดึงข้อมูล cloud (ที่ไม่ครบ) มาทับ local ทำให้ยอดนับผิด
            // ตอนนี้ส่งทีละแถวตามลำดับ พร้อมหน่วงเล็กน้อยกันยิงถี่เกินไป
            let recordsToAdd = [];
            let skippedCount = 0;

            rows.forEach(rawCols => {
                let cols = rawCols.map(c => (c === undefined || c === null) ? '' : String(c).trim());
                if (cols.length === 0 || !cols[0]) return;
                if (cols[0] === 'รหัสพนักงาน') return; // ข้ามแถวหัวตาราง

                let empCode = cols[0];
                if (!/^[A-Z0-9]{6}$/i.test(empCode)) { skippedCount++; return; } // รหัสไม่ครบ 6 หลัก ข้าม
                empCode = empCode.toUpperCase();

                let record = null;

                if (cols.length >= 6 && cols[1] && cols[1].includes('/')) {
                    // รูปแบบที่ 1: checkIn เป็นวันที่เต็มพร้อมเวลาอยู่แล้ว (มี "/" แบบ 23/7/2569)
                    let [, checkIn, checkOut, shift, status, ot] = cols;
                    let datePart = (checkIn && checkIn !== '-') ? checkIn.split(' ')[0] : new Date().toLocaleDateString('th-TH');
                    record = {
                        empCode, date: datePart,
                        checkIn: checkIn || '-', checkOut: checkOut || '-',
                        shift: shift || '-', status: status || 'ปกติ',
                        ot: (ot === 'มี' || ot === 'ทำ') ? 'ทำ' : 'ไม่ทำ'
                    };
                } else if (cols.length >= 6) {
                    // รูปแบบที่ 2: วันที่กับเวลาแยกคอลัมน์กัน (เช่น "2569-07-23" กับ "20:06:49")
                    let [, dateRaw, timeRaw, checkOut, shift, status, ot] = cols;
                    if (!dateRaw && !timeRaw) { skippedCount++; return; } // แถวข้อมูลไม่ครบ ข้าม

                    let datePart = dateRaw;
                    let m = dateRaw && dateRaw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
                    if (m) datePart = `${parseInt(m[3])}/${parseInt(m[2])}/${m[1]}`; // แปลงเป็น วว/ดด/ปปปป ให้ตรงรูปแบบระบบ

                    let checkIn = timeRaw ? `${datePart} ${timeRaw}` : '-';
                    record = {
                        empCode, date: datePart,
                        checkIn, checkOut: (checkOut && checkOut !== '') ? checkOut : '-',
                        shift: shift || '-', status: status || 'ปกติ',
                        ot: (ot === 'มี' || ot === 'ทำ') ? 'ทำ' : 'ไม่ทำ'
                    };
                }

                if (!record) { skippedCount++; return; }

                record.id = Date.now() + recordsToAdd.length + Math.floor(Math.random() * 1000);
                recordsToAdd.push(record);
            });

            if (recordsToAdd.length === 0) {
                alert("ไม่พบแถวข้อมูลที่นำเข้าได้ กรุณาตรวจสอบรูปแบบไฟล์");
                return;
            }

            // เพิ่มลง local ทันทีเพื่อให้เห็นผลไว แล้วค่อยทยอยส่งขึ้น cloud ทีละแถว
            recordsToAdd.forEach(r => attendanceData.unshift(r));
            saveAndRenderApp();

            let syncedCount = 0;
            for (let i = 0; i < recordsToAdd.length; i++) {
                if (messageBox) messageBox.innerText = `⏳ กำลังนำเข้าและซิงค์ข้อมูลขึ้น cloud... (${i + 1}/${recordsToAdd.length})`;
                try {
                    const ok = await sendToCloud({ sheet: 'attendance', action: 'add', ...recordsToAdd[i] });
                    if (ok) syncedCount++;
                } catch (err) {
                    console.error("ซิงค์แถวนี้ขึ้น cloud ไม่สำเร็จ", recordsToAdd[i], err);
                }
                await new Promise(resolve => setTimeout(resolve, 150)); // หน่วงกันยิง cloud ถี่เกินไปจนบางแถวหลุด
            }

            scanChannel.postMessage({ type: 'REFRESH_DATA' }); // แจ้งจอแสดงผล/แท็บอื่นให้รีเฟรช
            if (messageBox) messageBox.innerText = `พร้อมสแกน [${currentShift}]`;
            alert(`นำเข้าข้อมูลสำเร็จ ${recordsToAdd.length} รายการ (ซิงค์ขึ้น cloud ${syncedCount}/${recordsToAdd.length})${skippedCount > 0 ? ` — ข้าม ${skippedCount} แถวที่ข้อมูลไม่ครบ/รูปแบบไม่ตรง` : ''}`);
        } catch (err) {
            console.error("นำเข้าข้อมูลล้มเหลว", err);
            alert("ไม่สามารถอ่านไฟล์ได้ กรุณาตรวจสอบว่าเป็นไฟล์ CSV หรือ Excel ที่ถูกต้อง");
        } finally {
            event.target.value = ''; // เคลียร์ค่า input ไฟล์เพื่อให้เลือกไฟล์เดิมซ้ำได้
        }
    };
    reader.onerror = function() {
        alert("อ่านไฟล์ไม่สำเร็จ");
    };

    if (isExcel) {
        reader.readAsArrayBuffer(file);
    } else {
        reader.readAsText(file, 'UTF-8');
    }
}

function exportSummary() { exportExcel(); }
function exportExcelMenu() { exportExcel(); }
function confirmResetData() { clearData(); }

function downloadCSV(csv, filename) {
    let blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    let url = URL.createObjectURL(blob);
    let a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Restroom Logic
let selectedRestroomReason = 'เข้าห้องน้ำ';
let restroomLimitMins = 15;

function selectReason(reason, limit, btnElement) {
    selectedRestroomReason = reason;
    restroomLimitMins = limit;
    document.querySelectorAll('.shift-container button').forEach(b => b.classList.remove('active'));
    if(btnElement) btnElement.classList.add('active');
    const msg = document.getElementById('restroomMessage');
    if(msg) msg.innerText = `เลือกสาเหตุ: ${reason} ${limit > 0 ? `(จำกัดเวลา ${limit} นาที)` : '(ไม่จำกัดเวลา)'}`;
    document.getElementById('employeeRestroom')?.focus();
}

function handleRestroomScan(event) {
    if (event.key === 'Enter' || event.keyCode === 13) {
        event.preventDefault();
        const input = document.getElementById('employeeRestroom');
        if(!input) return;
        let rawCode = input.value.trim();
        if(!rawCode) return;

        let empCode = extractEmpCode(rawCode);
        
        if (empCode.length !== 6) {
            playBeep('warning');
            const msg = document.getElementById('restroomMessage');
            if(msg) msg.innerText = `⚠️ รหัสไม่ถูกต้อง (ต้องมี 6 ตัวอักษร): ${empCode}`;
            input.value = '';
            input.focus();
            return;
        }

        let activeRecord = restroomData.find(x => x.empCode === empCode && x.status === 'ออกนอกพื้นที่');
        let now = new Date();
        let timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

        if(!activeRecord) {
            let newRec = {
                id: Date.now(),
                empCode: empCode,
                reason: selectedRestroomReason,
                startTime: timeStr,
                returnTime: '-',
                duration: '-',
                status: 'ออกนอกพื้นที่',
                limitMins: restroomLimitMins,
                rawStartTime: now.getTime()
            };
            restroomData.unshift(newRec);
            playBeep('success');
            sendToCloud({ sheet: 'restroom', action: 'add', ...newRec });
        } else {
            activeRecord.returnTime = timeStr;
            let diffMins = Math.floor((now.getTime() - activeRecord.rawStartTime) / 60000);
            activeRecord.duration = `${diffMins} นาที`;
            activeRecord.status = 'กลับเข้าพื้นที่แล้ว';
            playBeep('success');
            // 🛠️ [แก้บัค] เดิมตอนกลับเข้าพื้นที่ไม่ sync ขึ้น cloud เลย (มีแต่ตอนออก) พอโหลดข้อมูลใหม่จาก cloud
            // ในภายหลัง สถานะจะถูกเขียนทับกลับเป็น "ออกนอกพื้นที่" เหมือนยังไม่ได้กลับ
            sendToCloud({
                sheet: 'restroom', action: 'update', id: activeRecord.id, empCode: activeRecord.empCode,
                returnTime: activeRecord.returnTime, duration: activeRecord.duration, status: activeRecord.status
            });
        }

        localStorage.setItem('factoryRestroom', JSON.stringify(restroomData));
        input.value = '';
        renderRestroom();
    }
}

function renderRestroom() {
    const list = document.getElementById('restroomList');
    if(!list) return;
    list.innerHTML = '';
    const now = Date.now();
    restroomData.forEach(item => {
        // 🛠️ [แก้บัค] เดิมตัดสิน "เกินเวลา" จากแค่สถานะยังไม่กลับเข้า ไม่ได้เทียบเวลาจริงกับ limitMins เลย
        // ทำให้เพิ่งออกไปไม่กี่วินาทีก็ขึ้นแดง "เกินเวลา" ทันที ตอนนี้เทียบเวลาที่ผ่านไปจริงกับ limit
        let isOver = false;
        if (item.limitMins > 0) {
            if (item.status === 'ออกนอกพื้นที่') {
                let elapsedMins = (now - item.rawStartTime) / 60000;
                isOver = elapsedMins > item.limitMins;
            } else {
                let usedMins = parseInt(item.duration) || 0;
                isOver = usedMins > item.limitMins;
            }
        }
        let tr = document.createElement('tr');
        tr.innerHTML = `
            <td><b>${escapeHtml(item.empCode)}</b></td>
            <td>${escapeHtml(item.reason)}</td>
            <td>${escapeHtml(item.startTime)}</td>
            <td>${escapeHtml(item.returnTime)}</td>
            <td>${escapeHtml(item.duration)}</td>
            <td><span class="timer-badge ${isOver ? 'timer-over' : 'timer-normal'}">${escapeHtml(item.status)}</span></td>
            <td><button onclick="deleteRestroom(${item.id})" class="btn-danger">ลบ</button></td>
        `;
        list.appendChild(tr);
    });
}

// 🛠️ อัปเดตป้ายเกินเวลาเป็นระยะ เผื่อมีคนยังค้าง "ออกนอกพื้นที่" อยู่และเวลาผ่านจน worse เกิน limit
setInterval(() => { if (document.getElementById('restroomList')) renderRestroom(); }, 15000);

function deleteRestroom(id) {
    // 🛠️ [แก้บัค] เดิมลบแค่ local ไม่ได้แจ้ง cloud เลย ทำให้ cloud ยังมีเรคคอร์ดเดิมอยู่
    // พอโหลดข้อมูลใหม่จาก cloud รายการที่ลบไปแล้วจะโผล่กลับมา
    const toDelete = restroomData.find(x => x.id === id);
    restroomData = restroomData.filter(x => x.id !== id);
    localStorage.setItem('factoryRestroom', JSON.stringify(restroomData));
    renderRestroom();
    if (toDelete) {
        sendToCloud({ sheet: 'restroom', action: 'delete', id: toDelete.id, empCode: toDelete.empCode });
    }
}

function exportRestroomExcel() {
    if(restroomData.length === 0) { alert("ไม่มีข้อมูล"); return; }
    let csv = "\ufeffรหัสพนักงาน,สาเหตุ,เวลาเริ่มออก,เวลากลับเข้า,เวลารวม,สถานะ\n";
    restroomData.forEach(x => { csv += `${x.empCode},${x.reason},${x.startTime},${x.returnTime},${x.duration},${x.status}\n`; });
    downloadCSV(csv, `restroom_log_${new Date().toISOString().slice(0, 10)}.csv`);
}

// Display Real-time Screen Logic
scanChannel.onmessage = (event) => {
    let data = event.data;

    // 🛠️ รองรับคำสั่งรีเฟรชข้อมูลหน้าจอเมื่อมีการลบ
    if (data.type === 'REFRESH_DATA') {
        attendanceData = JSON.parse(localStorage.getItem('mfg5_attendance')) || [];
        loadDashboard();
        renderTable();
        showSummary();
        renderDisplayTable();
        return;
    }

    let card = document.getElementById('latestCard');
    let title = document.getElementById('scanActionTitle');
    let codeEl = document.getElementById('latestEmpCode');
    let details = document.getElementById('latestDetails');

    if(card && title && codeEl) {
        codeEl.innerText = data.empCode;
        if(data.type === 'CHECK_IN') {
            card.className = "latest-card active-checkin";
            title.innerText = `🟢 เข้างานสำเร็จ (${data.shift})`;
            details.innerText = `สถานะ: ${data.status} | เวลา: ${data.time}`;
        } else {
            card.className = "latest-card active-checkout";
            title.innerText = `🔴 ออกงานสำเร็จ`;
            details.innerText = `OT: ${data.ot} | เวลา: ${data.time}`;
        }
    }
    renderDisplayTable();
};

function renderDisplayTable() {
    const tbody = document.getElementById('displayList');
    if(!tbody) return;
    const searchVal = document.getElementById('empSearchInput')?.value.toLowerCase() || '';
    tbody.innerHTML = '';
    
    let filtered = attendanceData.filter(i => (i.empCode || '').toLowerCase().includes(searchVal));
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 30px;">ไม่พบข้อมูลการลงเวลา</td></tr>`;
        return;
    }

    filtered.forEach(item => {
        let tr = document.createElement('tr');
        tr.innerHTML = `
            <td><b>${escapeHtml(item.empCode)}</b></td>
            <td style="color: #4ade80;">${escapeHtml(item.checkIn)}</td>
            <td style="color: #f87171;">${escapeHtml(item.checkOut)}</td>
            <td>${escapeHtml(item.shift)}</td>
            <td>${escapeHtml(item.status)}</td>
            <td>${escapeHtml(item.ot)}</td>
        `;
        tbody.appendChild(tr);
    });
}

window.addEventListener('storage', (e) => {
    if (e.key === 'mfg5_attendance') {
        attendanceData = JSON.parse(e.newValue) || [];
        loadDashboard();
        renderTable();
        showSummary();
        renderDisplayTable();
    }
    if (e.key === 'factoryRestroom') {
        restroomData = JSON.parse(e.newValue) || [];
        renderRestroom();
    }
});

document.addEventListener("DOMContentLoaded", () => {
    fetchCloudData();
    document.getElementById('employee')?.focus();
    document.getElementById('employeeRestroom')?.focus();
    renderTable();
    showSummary();
    renderRestroom();
    renderDisplayTable();
});