let attendanceData = JSON.parse(localStorage.getItem('mfg5_attendance')) || [];
let restroomData = JSON.parse(localStorage.getItem('factoryRestroom')) || [];
let employeeData = JSON.parse(localStorage.getItem('mfg5_employees')) || [];
// 🛠️ กันพัง: บางเบราว์เซอร์/เว็บวิวในแอป (เช่น เบราว์เซอร์ในตัวแอปแชท) ไม่รองรับ BroadcastChannel
// ถ้าปล่อยให้ throw ตรงนี้ตั้งแต่ตอนโหลดสคริปต์ โค้ดทั้งไฟล์ที่อยู่หลังบรรทัดนี้จะไม่ถูกรันเลย
// ทำให้ปุ่มต่างๆ (เช่น เพิ่มพนักงาน) เหมือนกดไม่ได้ผลทั้งที่จริงๆ ไม่เกี่ยวกับฟังก์ชันนั้นเลย
// ถ้าไม่รองรับ ให้ใช้ stub แทน (แค่ไม่ซิงค์ข้ามแท็บสด แต่ฟีเจอร์หลักยังทำงานปกติ)
let scanChannel;
try {
    scanChannel = new BroadcastChannel('mfg5_scan_channel');
} catch (e) {
    console.warn('BroadcastChannel ไม่รองรับในเบราว์เซอร์นี้ การซิงค์ข้ามแท็บสดจะไม่ทำงาน', e);
    scanChannel = { postMessage() {}, onmessage: null };
}

function getEmployeeDept(empCode) {
    const e = employeeData.find(x => x.empCode === empCode);
    return e ? e.department : '';
}

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

// 🛠️ ใช้แทน window.confirm() เพราะ confirm()/alert() ของเบราว์เซอร์ถูกบล็อกในหน้าที่รันอยู่ใน
// sandboxed iframe (เช่นหน้าเดโมที่โฮสต์อยู่ใน Claude Artifact) กดแล้วจะเหมือนไม่มีอะไรเกิดขึ้นเลย
// สร้าง modal ยืนยันของแอปเองแทน ใช้ CSS .modal/.modal-content เดิมที่มีอยู่แล้ว
function showConfirm(message, onYes) {
    let modal = document.getElementById('genericConfirmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'genericConfirmModal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content" style="width: 380px; text-align: center;">
                <p id="genericConfirmMessage" style="margin: 0 0 20px; font-size: 15px; color: #334155;"></p>
                <div style="display: flex; justify-content: center; gap: 10px;">
                    <button id="genericConfirmNo" class="btn-secondary">ยกเลิก</button>
                    <button id="genericConfirmYes" class="btn-danger">ยืนยัน</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    document.getElementById('genericConfirmMessage').textContent = message;
    modal.style.display = 'flex';

    // แทนที่ปุ่มด้วยตัวโคลนทุกครั้งเพื่อล้าง event handler เก่า กัน callback ซ้อนกันถ้าเรียก showConfirm ซ้ำ
    const yesBtn = document.getElementById('genericConfirmYes');
    const noBtn = document.getElementById('genericConfirmNo');
    const newYesBtn = yesBtn.cloneNode(true);
    yesBtn.parentNode.replaceChild(newYesBtn, yesBtn);
    const newNoBtn = noBtn.cloneNode(true);
    noBtn.parentNode.replaceChild(newNoBtn, noBtn);

    newYesBtn.onclick = () => { modal.style.display = 'none'; onYes(); };
    newNoBtn.onclick = () => { modal.style.display = 'none'; };
}

// 🛡️ ป้องกัน XSS: escape ค่าก่อนแทรกลง innerHTML เพราะข้อมูลอาจมาจากไฟล์นำเข้า/แก้ไขเองได้
function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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
    let sumTotal = document.getElementById("sumTotal");
    let sumIn = document.getElementById("sumIn");
    let sumLate = document.getElementById("sumLate");
    let sumOT = document.getElementById("sumOT");

    if(sumTotal) sumTotal.innerHTML = new Set(attendanceData.map(x => x.empCode)).size;
    if(sumIn) sumIn.innerHTML = attendanceData.filter(x => x.checkIn && x.checkIn !== '-').length;
    if(sumLate) sumLate.innerHTML = attendanceData.filter(x => x.status && x.status.includes("สาย")).length;
    if(sumOT) sumOT.innerHTML = attendanceData.filter(x => x.ot && x.ot === "ทำ").length;
}

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

        // 🛠️ [แก้บัค] เดิมล็อคห้ามสแกนใหม่ทั้งหน้าจอ 200ms หลังทุกครั้งที่สแกน (ไม่ใช่แค่คนเดิม) ทำให้ถ้ามีคิว
        // สแกนต่อกันเร็ว (เช่นช่วงเข้ากะพร้อมกันหลายร้อย/พันคน) รหัสของคนถัดไปที่ยิงมาในช่วง 200ms นั้นจะถูกทิ้งเงียบๆ
        // ไม่มีเสียงเตือน ไม่มีข้อความ เหมือนสแกนไม่ติด ทั้งที่ processAttendance ทำงานเสร็จตั้งแต่ก่อนจะคืนค่าฟังก์ชันแล้ว
        // (ไม่มีการ await ใดๆ ในนี้อีกต่อไปหลังจากตัดระบบ cloud ออก) จึงไม่จำเป็นต้องหน่วงเวลาแบบนี้เลย
        // การกันสแกนซ้ำของ "คนเดิม" ในเวลาไล่เลี่ยกัน มี lastScanTimeMap (500ms ต่อรหัส) ป้องกันอยู่แล้วในตัว processAttendance
        processAttendance(empCode);
        input.value = '';
        input.focus();
    }
}

// 🕐 กติกากะ/OT (ยืนยันกับหน้างานแล้ว):
//   กะเช้า: เข้างาน 08:00 ตรง ไม่มีเกรซ (สายทันทีถ้าเกิน 08:00) เลิกงานปกติ 17:30
//   กะดึก: เข้างาน 20:00 ตรง ไม่มีเกรซ เลิกงานปกติ 05:30 (วันถัดไป)
//   ทั้งสองกะ: คนไม่ทำ OT จะไม่สแกนขาออกเลย — สแกนครั้งเดียวตอนเข้างานถือว่าจบวันนั้น (checkOut '-' = ไม่ทำ OT)
//   คนทำ OT สแกนซ้ำตอนออก ไม่มีเพดานเวลาบน (สแกนดึกแค่ไหนก็นับ OT ได้) แต่ต้องอยู่ต่ออย่างน้อย 30 นาที
//   หลังเลิกงานปกติถึงจะนับ OT (กะเช้า >= 18:00, กะดึก >= 06:00) กันคนแตะบัตรออกทันทีตอนเลิกงานเพื่อเคลม OT ฟรี
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
        // 🛠️ กันคนแตะบัตรออกทันทีตอนเลิกงานเพื่อเคลม OT ฟรี: ต้องอยู่ต่ออย่างน้อย 30 นาทีหลังเลิกงานปกติ
        // (กะเช้า >= 18:00, กะดึก >= 06:00) ถึงจะนับ OT ไม่มีเพดานเวลาบน สแกนดึกแค่ไหนก็ยังนับ OT ได้
        const record = openRecord;
        record.checkOut = fullDateTimeStr;

        let otStr = 'ไม่ทำ';
        if (record.shift === 'กะเช้า' && currentMinutes >= (18 * 60)) {
            otStr = 'ทำ';
        } else if (record.shift === 'กะดึก' && now.getHours() < 12 && currentMinutes >= (6 * 60)) {
            otStr = 'ทำ';
        }
        record.ot = otStr;

        const outDept = getEmployeeDept(empCode);
        playBeep('success');
        if (messageBox) {
            messageBox.innerText = otStr === 'ทำ'
                ? `🔴 [ยืนยันทำ OT] รหัส: ${empCode}${outDept ? ` (${outDept})` : ''} เวลาออก: ${timeStr}`
                : `🔴 [สแกนขาออก - อยู่ต่อไม่ถึง 30 นาที จึงไม่นับ OT] รหัส: ${empCode}${outDept ? ` (${outDept})` : ''} เวลาออก: ${timeStr}`;
            messageBox.style.color = '#ea580c';
        }
        scanChannel.postMessage({ type: 'CHECK_OUT', empCode, dept: outDept, status: record.status, ot: otStr, shift: record.shift, time: timeStr });
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

        const dept = getEmployeeDept(empCode);
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
            messageBox.innerText = `🟢 [เข้างาน - ${currentShift}] รหัส: ${empCode}${dept ? ` (${dept})` : ''} (${statusStr}) — ถ้าทำ OT ให้สแกนซ้ำตอนออกในช่วงเวลา OT`;
            messageBox.style.color = statusStr.includes("สาย") ? '#d32f2f' : '#2e7d32';
        }
        scanChannel.postMessage({ type: 'CHECK_IN', empCode, dept, status: statusStr, shift: currentShift, time: timeStr });
    }

    saveAndRenderApp();
}

function renderTable() {
    const listTable = document.getElementById('list');
    if (!listTable) return;
    const searchVal = document.getElementById('search')?.value.toLowerCase() || '';
    listTable.innerHTML = '';

    const filteredData = attendanceData.filter(i => (i.empCode || '').toLowerCase().includes(searchVal));
    if (filteredData.length === 0) {
        listTable.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94a3b8; padding: 30px;">ไม่พบข้อมูลการสแกน</td></tr>`;
        updateDashboardApp();
        showSummary();
        return;
    }

    filteredData.forEach(item => {
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
            <td style="padding: 12px;">${escapeHtml(getEmployeeDept(item.empCode))}</td>
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
        if (attendanceData.length === 0) {
            summaryList.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 30px;">ไม่พบข้อมูล</td></tr>`;
        } else {
            attendanceData.forEach(item => {
                let tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><b>${escapeHtml(item.empCode)}</b></td>
                    <td>${escapeHtml(getEmployeeDept(item.empCode))}</td>
                    <td>${escapeHtml(item.checkIn)}</td>
                    <td>${escapeHtml(item.checkOut)}</td>
                    <td>${escapeHtml(item.shift)}</td>
                    <td>${escapeHtml(item.status)}</td>
                    <td>${escapeHtml(item.ot)}</td>
                `;
                summaryList.appendChild(tr);
            });
        }
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
        scanChannel.postMessage({ type: 'REFRESH_DATA' });
    }
}

function saveAndRenderApp() {
    localStorage.setItem('mfg5_attendance', JSON.stringify(attendanceData));
    renderTable();
    showSummary();
}

function performDeleteRecord(id) {
    attendanceData = attendanceData.filter(i => i.id !== id);
    saveAndRenderApp();
    scanChannel.postMessage({ type: 'REFRESH_DATA' });
}

function deleteRecord(id) {
    showConfirm('ต้องการลบรายการนี้ใช่หรือไม่?', () => performDeleteRecord(id));
}

function deleteRecordFromModal() {
    const id = Number(document.getElementById('editId').value);
    showConfirm('ต้องการลบรายการนี้ใช่หรือไม่?', () => {
        performDeleteRecord(id);
        closeEditModal();
    });
}

function clearData() {
    showConfirm('⚠️ ต้องการล้างข้อมูลการลงเวลาทั้งหมดใช่หรือไม่?', () => {
        attendanceData = [];
        saveAndRenderApp();

        // 🛠️ ส่งสัญญาณบอกหน้าอื่นๆ ให้ล้างข้อมูลตาม
        scanChannel.postMessage({ type: 'REFRESH_DATA' });
    });
}

function exportExcel() {
    if (attendanceData.length === 0) { alert("ไม่มีข้อมูล"); return; }
    let csv = "﻿รหัสพนักงาน,วันที่/เวลาเข้า,วันที่/เวลาออก,กะ,สถานะ,OT\n";
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
    reader.onload = function(e) {
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
                let text = e.target.result.replace(/^﻿/, ''); // ตัด BOM ออก
                rows = text.split(/\r?\n/).filter(l => l.trim() !== '').map(line => line.split(','));
            }

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

            recordsToAdd.forEach(r => attendanceData.unshift(r));
            saveAndRenderApp();
            scanChannel.postMessage({ type: 'REFRESH_DATA' }); // แจ้งจอแสดงผล/แท็บอื่นให้รีเฟรช
            alert(`นำเข้าข้อมูลสำเร็จ ${recordsToAdd.length} รายการ${skippedCount > 0 ? ` — ข้าม ${skippedCount} แถวที่ข้อมูลไม่ครบ/รูปแบบไม่ตรง` : ''}`);
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
        } else {
            activeRecord.returnTime = timeStr;
            let diffMins = Math.floor((now.getTime() - activeRecord.rawStartTime) / 60000);
            activeRecord.duration = `${diffMins} นาที`;
            activeRecord.status = 'กลับเข้าพื้นที่แล้ว';
            playBeep('success');
        }

        localStorage.setItem('factoryRestroom', JSON.stringify(restroomData));
        input.value = '';
        renderRestroom();
        scanChannel.postMessage({ type: 'REFRESH_DATA' });
    }
}

function renderRestroom() {
    const list = document.getElementById('restroomList');
    if(!list) return;
    list.innerHTML = '';
    if (restroomData.length === 0) {
        list.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94a3b8; padding: 30px;">ไม่พบข้อมูลการออกนอกพื้นที่</td></tr>`;
        return;
    }
    const now = Date.now();
    restroomData.forEach(item => {
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
            <td>${escapeHtml(getEmployeeDept(item.empCode))}</td>
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

// 🛠️ อัปเดตป้ายเกินเวลาเป็นระยะ เผื่อมีคนยังค้าง "ออกนอกพื้นที่" อยู่และเวลาผ่านจนเกิน limit
setInterval(() => { if (document.getElementById('restroomList')) renderRestroom(); }, 15000);

function deleteRestroom(id) {
    showConfirm('ต้องการลบรายการนี้ใช่หรือไม่?', () => {
        restroomData = restroomData.filter(x => x.id !== id);
        localStorage.setItem('factoryRestroom', JSON.stringify(restroomData));
        renderRestroom();
        scanChannel.postMessage({ type: 'REFRESH_DATA' });
    });
}

function exportRestroomExcel() {
    if(restroomData.length === 0) { alert("ไม่มีข้อมูล"); return; }
    let csv = "﻿รหัสพนักงาน,สาเหตุ,เวลาเริ่มออก,เวลากลับเข้า,เวลารวม,สถานะ\n";
    restroomData.forEach(x => { csv += `${x.empCode},${x.reason},${x.startTime},${x.returnTime},${x.duration},${x.status}\n`; });
    downloadCSV(csv, `restroom_log_${new Date().toISOString().slice(0, 10)}.csv`);
}

// Employee Directory Logic (รหัสพนักงาน ใช้แสดงคู่กับรหัสตอนสแกน)
// ระบบนี้ใช้เฉพาะแผนก ATS เท่านั้น จึงล็อคชื่อแผนกเป็นค่าคงที่แทนการให้พิมพ์เอง
// กันกรณีมีคนแผนกอื่น (เช่นเข้ามาช่วยเพิ่มข้อมูล) กรอกชื่อแผนกผิดหรือใส่ค่าไม่ตรงกัน
const LOCKED_DEPARTMENT = 'ATS';

function saveEmployee() {
    const codeInput = document.getElementById('empCodeInput');
    const msg = document.getElementById('employeeMessage');
    if (!codeInput) return;

    const code = extractEmpCode(codeInput.value.trim());

    if (code.length !== 6) {
        if (msg) { msg.innerText = '⚠️ รหัสพนักงานต้องมี 6 ตัวอักษร'; msg.style.color = '#d32f2f'; }
        return;
    }

    const existing = employeeData.find(x => x.empCode === code);
    if (existing) {
        if (msg) { msg.innerText = `⚠️ รหัส ${code} มีอยู่ในระบบแล้ว (แผนก ${LOCKED_DEPARTMENT})`; msg.style.color = '#d32f2f'; }
        return;
    }

    employeeData.push({ empCode: code, department: LOCKED_DEPARTMENT });
    employeeData.sort((a, b) => a.empCode.localeCompare(b.empCode));
    localStorage.setItem('mfg5_employees', JSON.stringify(employeeData));

    if (msg) { msg.innerText = `✅ เพิ่มพนักงานรหัส ${code} แผนก ${LOCKED_DEPARTMENT} แล้ว`; msg.style.color = '#2e7d32'; }
    codeInput.value = '';
    codeInput.focus();
    renderEmployees();
    scanChannel.postMessage({ type: 'REFRESH_DATA' });
}

function deleteEmployee(code) {
    showConfirm(`ต้องการลบข้อมูลพนักงานรหัส ${code} ใช่หรือไม่?`, () => {
        employeeData = employeeData.filter(x => x.empCode !== code);
        localStorage.setItem('mfg5_employees', JSON.stringify(employeeData));
        renderEmployees();
        scanChannel.postMessage({ type: 'REFRESH_DATA' });
    });
}

// 🛠️ ลบพนักงานที่ติ๊กเลือกไว้หลายคนพร้อมกัน — แยกจาก deleteEmployee (ลบทีละแถว) และแยกจาก
// clearData ของหน้าลงเวลา (ลบเฉพาะรายชื่อพนักงานหน้านี้เท่านั้น ไม่แตะข้อมูลลงเวลา/ห้องน้ำ)
function deleteSelectedEmployees() {
    const checked = Array.from(document.querySelectorAll('.emp-select:checked')).map(cb => cb.value);
    if (checked.length === 0) {
        alert('กรุณาติ๊กเลือกพนักงานที่ต้องการลบก่อน');
        return;
    }
    showConfirm(`ต้องการลบพนักงานที่เลือกไว้ ${checked.length} คน ใช่หรือไม่?`, () => {
        employeeData = employeeData.filter(x => !checked.includes(x.empCode));
        localStorage.setItem('mfg5_employees', JSON.stringify(employeeData));
        renderEmployees();
        scanChannel.postMessage({ type: 'REFRESH_DATA' });
    });
}

function deleteAllEmployees() {
    if (employeeData.length === 0) { alert('ไม่มีข้อมูลพนักงาน'); return; }
    showConfirm('⚠️ ต้องการลบรายชื่อพนักงานทั้งหมดใช่หรือไม่? (ไม่เกี่ยวกับข้อมูลการลงเวลา)', () => {
        employeeData = [];
        localStorage.setItem('mfg5_employees', JSON.stringify(employeeData));
        renderEmployees();
        scanChannel.postMessage({ type: 'REFRESH_DATA' });
    });
}

function toggleSelectAllEmployees(checkbox) {
    document.querySelectorAll('.emp-select').forEach(cb => { cb.checked = checkbox.checked; });
}

function renderEmployees() {
    const list = document.getElementById('employeeList');
    if (!list) return;
    const searchVal = document.getElementById('empSearch')?.value.toLowerCase() || '';
    list.innerHTML = '';
    const selectAll = document.getElementById('selectAllEmp');
    if (selectAll) selectAll.checked = false;

    const filtered = employeeData.filter(e =>
        e.empCode.toLowerCase().includes(searchVal) || (e.department || '').toLowerCase().includes(searchVal)
    );
    if (filtered.length === 0) {
        list.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #94a3b8; padding: 30px;">ไม่พบข้อมูลพนักงาน</td></tr>`;
        return;
    }

    filtered.forEach(e => {
        let tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="checkbox" class="emp-select" value="${e.empCode}"></td>
            <td><b>${escapeHtml(e.empCode)}</b></td>
            <td>${escapeHtml(e.department)}</td>
            <td>
                <button onclick="deleteEmployee('${e.empCode}')" class="btn-danger">ลบ</button>
            </td>
        `;
        list.appendChild(tr);
    });
}

function exportEmployeesExcel() {
    if (employeeData.length === 0) { alert("ไม่มีข้อมูล"); return; }
    let csv = "﻿รหัสพนักงาน,แผนก\n";
    employeeData.forEach(e => { csv += `${e.empCode},${e.department}\n`; });
    downloadCSV(csv, `employee_list_${new Date().toISOString().slice(0, 10)}.csv`);
}

// 📥 นำเข้ารายชื่อพนักงานจากไฟล์ .csv หรือ .xlsx/.xls — อ่านเฉพาะคอลัมน์ A (คอลัมน์แรก) เป็นรหัสพนักงาน แถวละ 1 รหัส
// ทุกคนที่นำเข้าถูกล็อคแผนกเป็น "ATS" เหมือนเพิ่มทีละคนผ่านฟอร์ม รหัสที่มีอยู่แล้ว/รูปแบบไม่ถูกต้อง จะถูกข้าม
function importEmployees(event) {
    const file = event.target.files[0];
    if (!file) return;
    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

    const reader = new FileReader();
    reader.onload = function (e) {
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
                let text = e.target.result.replace(/^﻿/, ''); // ตัด BOM ออก
                rows = text.split(/\r?\n/).filter(l => l.trim() !== '').map(line => line.split(','));
            }

            let addedCount = 0, skippedCount = 0;
            rows.forEach(rawCols => {
                let rawCode = (rawCols[0] === undefined || rawCols[0] === null) ? '' : String(rawCols[0]).trim();
                if (!rawCode || rawCode === 'รหัสพนักงาน') { return; } // แถวว่าง/หัวตาราง ข้ามแบบเงียบๆ ไม่นับ skip

                const code = extractEmpCode(rawCode);
                if (code.length !== 6 || employeeData.find(x => x.empCode === code)) { skippedCount++; return; }

                employeeData.push({ empCode: code, department: LOCKED_DEPARTMENT });
                addedCount++;
            });

            if (addedCount > 0) {
                employeeData.sort((a, b) => a.empCode.localeCompare(b.empCode));
                localStorage.setItem('mfg5_employees', JSON.stringify(employeeData));
                renderEmployees();
                scanChannel.postMessage({ type: 'REFRESH_DATA' });
            }
            alert(`นำเข้าสำเร็จ ${addedCount} รายการ (แผนก ${LOCKED_DEPARTMENT})${skippedCount > 0 ? ` — ข้าม ${skippedCount} รายการที่รหัสไม่ถูกต้องหรือมีอยู่แล้ว` : ''}`);
        } catch (err) {
            console.error("นำเข้ารายชื่อพนักงานล้มเหลว", err);
            alert("ไม่สามารถอ่านไฟล์ได้ กรุณาตรวจสอบว่าเป็นไฟล์ CSV หรือ Excel ที่ถูกต้อง");
        } finally {
            event.target.value = '';
        }
    };
    reader.onerror = function () {
        alert("อ่านไฟล์ไม่สำเร็จ");
    };

    if (isExcel) {
        reader.readAsArrayBuffer(file);
    } else {
        reader.readAsText(file, 'UTF-8');
    }
}

// Display Real-time Screen Logic
scanChannel.onmessage = (event) => {
    let data = event.data;

    // 🛠️ รองรับคำสั่งรีเฟรชข้อมูลทุกหน้าที่เปิดอยู่บนเครื่องนี้ (ลบ/แก้ไข/สแกนห้องน้ำ ฯลฯ) ให้เห็นข้อมูลตรงกันทันที
    if (data.type === 'REFRESH_DATA') {
        attendanceData = JSON.parse(localStorage.getItem('mfg5_attendance')) || [];
        restroomData = JSON.parse(localStorage.getItem('factoryRestroom')) || [];
        employeeData = JSON.parse(localStorage.getItem('mfg5_employees')) || [];
        loadDashboard();
        renderTable();
        showSummary();
        renderRestroom();
        renderDisplayTable();
        renderEmployees();
        return;
    }

    let card = document.getElementById('latestCard');
    let title = document.getElementById('scanActionTitle');
    let codeEl = document.getElementById('latestEmpCode');
    let details = document.getElementById('latestDetails');

    if(card && title && codeEl) {
        codeEl.innerText = data.dept ? `${data.empCode} (${data.dept})` : data.empCode;
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
    attendanceData = JSON.parse(localStorage.getItem('mfg5_attendance')) || [];
    renderDisplayTable();
};

function renderDisplayTable() {
    const tbody = document.getElementById('displayList');
    if(!tbody) return;
    const searchVal = document.getElementById('empSearchInput')?.value.toLowerCase() || '';
    tbody.innerHTML = '';

    let filtered = attendanceData.filter(i => (i.empCode || '').toLowerCase().includes(searchVal));
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 30px;">ไม่พบข้อมูลการลงเวลา</td></tr>`;
        return;
    }

    filtered.forEach(item => {
        let tr = document.createElement('tr');
        tr.innerHTML = `
            <td><b>${escapeHtml(item.empCode)}</b></td>
            <td>${escapeHtml(getEmployeeDept(item.empCode))}</td>
            <td style="color: #4ade80;">${escapeHtml(item.checkIn)}</td>
            <td style="color: #f87171;">${escapeHtml(item.checkOut)}</td>
            <td>${escapeHtml(item.shift)}</td>
            <td>${escapeHtml(item.status)}</td>
            <td>${escapeHtml(item.ot)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// 🛠️ ระบบนี้ไม่มี backend กลาง — ข้อมูลอยู่ใน localStorage ของเบราว์เซอร์เครื่องนี้เครื่องเดียวเท่านั้น
// การ "ใช้ร่วมกัน" ทำได้โดยเปิดหลายแท็บ/หน้าต่างพร้อมกันบนเครื่องเดียวกัน (เช่น แท็บสแกน + แท็บจอแสดงผล)
// ซึ่งจะซิงค์กันแบบเรียลไทม์ผ่าน BroadcastChannel (ระหว่างที่เปิดอยู่) และ storage event (ข้ามแท็บที่โหลดใหม่)
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
    if (e.key === 'mfg5_employees') {
        employeeData = JSON.parse(e.newValue) || [];
        renderTable();
        showSummary();
        renderRestroom();
        renderDisplayTable();
        renderEmployees();
    }
});

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('employee')?.focus();
    document.getElementById('employeeRestroom')?.focus();
    loadDashboard();
    renderTable();
    showSummary();
    renderRestroom();
    renderDisplayTable();
});
