const API_URL = "ใส่ URL ของ Google Apps Script ที่นี่";

let attendanceData = JSON.parse(localStorage.getItem('mfg5_attendance')) || [];
let restroomData = JSON.parse(localStorage.getItem('factoryRestroom')) || [];
const scanChannel = new BroadcastChannel('mfg5_scan_channel');

async function fetchCloudData() {
    try {
        let resAtt = await fetch(`${API_URL}?sheet=attendance`);
        let attJson = await resAtt.json();
        if (Array.isArray(attJson) && attJson.length > 0) {
            attendanceData = attJson;
            localStorage.setItem('mfg5_attendance', JSON.stringify(attendanceData));
        }

        let resRest = await fetch(`${API_URL}?sheet=restroom`);
        let restJson = await resRest.json();
        if (Array.isArray(restJson) && restJson.length > 0) {
            restroomData = restJson;
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
        await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) });
    } catch (err) {
        console.error("บันทึก Cloud ไม่สำเร็จ", err);
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

        const empCode = convertThaiToEng(rawCode);
        isScanning = true;
        processAttendance(empCode);
        input.value = '';
        setTimeout(() => { isScanning = false; input.focus(); }, 300);
    }
}

function processAttendance(empCode) {
    const now = new Date();
    const todayStr = now.toLocaleDateString('th-TH');
    const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const fullDateTimeStr = `${todayStr} ${timeStr}`;
    
    let record = attendanceData.find(item => item.empCode === empCode && item.date === todayStr && item.checkOut === '-');
    const messageBox = document.getElementById('message');

    if (!record) {
        let statusStr = "ปกติ";
        let currentMinutes = now.getHours() * 60 + now.getMinutes();

        if (currentShift === 'กะเช้า' && currentMinutes > (8 * 60)) {
            statusStr = `สาย (${currentMinutes - (8 * 60)} นาที)`;
        } else if (currentShift === 'กะดึก') {
            let shiftInMinutes = 20 * 60;
            if (now.getHours() >= 12 && currentMinutes > shiftInMinutes) {
                statusStr = `สาย (${currentMinutes - shiftInMinutes} นาที)`;
            } else if (now.getHours() < 12) {
                let lateMins = (currentMinutes + 1440) - shiftInMinutes;
                if(lateMins > 0) statusStr = `สาย (${lateMins} นาที)`;
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
            ot: 'ไม่ทำ'
        };

        attendanceData.unshift(newRecord);
        if(messageBox) {
            messageBox.innerText = `🟢 [เข้างาน - ${currentShift}] รหัส: ${empCode} (${statusStr})`;
            messageBox.style.color = statusStr.includes("สาย") ? '#d32f2f' : '#2e7d32';
        }
        scanChannel.postMessage({ type: 'CHECK_IN', empCode, status: statusStr, shift: currentShift, time: timeStr });
        sendToCloud({ sheet: 'attendance', action: 'add', ...newRecord });
    } else {
        record.checkOut = fullDateTimeStr;
        let otStr = "ไม่ทำ";
        let outMinutes = now.getHours() * 60 + now.getMinutes();

        if (record.shift === 'กะเช้า' && outMinutes >= (18 * 60)) {
            otStr = "ทำ";
        } else if (record.shift === 'กะดึก' && now.getHours() < 12 && outMinutes >= (6 * 60)) {
            otStr = "ทำ";
        }

        record.ot = otStr;
        if(messageBox) {
            messageBox.innerText = `🔴 [สแกนออก] รหัส: ${empCode} (OT: ${otStr})`;
            messageBox.style.color = '#ea580c';
        }
        scanChannel.postMessage({ type: 'CHECK_OUT', empCode, status: record.status, ot: otStr, shift: record.shift, time: timeStr });
        sendToCloud({
            sheet: 'attendance',
            action: 'update_checkout',
            empCode: empCode,
            date: todayStr,
            checkOut: fullDateTimeStr,
            ot: otStr
        });
    }

    saveAndRenderApp();
}

function renderTable() {
    const listTable = document.getElementById('list');
    if (!listTable) return;
    const searchVal = document.getElementById('search')?.value.toLowerCase() || '';
    listTable.innerHTML = '';

    attendanceData.filter(i => i.empCode.toLowerCase().includes(searchVal)).forEach(item => {
        const tr = document.createElement('tr');
        let statusBadge = item.status.includes("สาย") 
            ? `<span style="background: #ff4d4f; color: white; padding: 3px 8px; border-radius: 12px; font-size: 13px;">⚠️ ${item.status}</span>`
            : `<span style="background: #52c41a; color: white; padding: 3px 8px; border-radius: 12px; font-size: 13px;">ปกติ</span>`;

        let otBadge = (item.ot === "ทำ") 
            ? `<span style="background: #1890ff; color: white; padding: 3px 8px; border-radius: 12px; font-size: 13px;">⭐ ทำ OT</span>` 
            : `<span style="color: #888;">ไม่ทำ</span>`;

        tr.innerHTML = `
            <td style="padding: 12px;"><b>${item.empCode}</b></td>
            <td style="padding: 12px;"><span style="color: #2e7d32; font-weight: bold;">${item.checkIn}</span></td>
            <td style="padding: 12px;"><span style="color: #c62828; font-weight: bold;">${item.checkOut}</span></td>
            <td style="padding: 12px;">${item.shift}</td>
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
}

function updateDashboardApp() {
    const todayStr = new Date().toLocaleDateString('th-TH');
    const todayRecs = attendanceData.filter(i => i.date === todayStr);
    if(document.getElementById('total')) document.getElementById('total').innerText = todayRecs.length;
    if(document.getElementById('checkin')) document.getElementById('checkin').innerText = todayRecs.filter(i => i.checkIn !== '-').length;
    if(document.getElementById('checkout')) document.getElementById('checkout').innerText = todayRecs.filter(i => i.checkOut !== '-').length;
    if(document.getElementById('ot')) document.getElementById('ot').innerText = todayRecs.filter(i => i.ot === 'ทำ').length;
}

function openEditModal(id) {
    const record = attendanceData.find(i => i.id === id);
    if (!record) return;
    document.getElementById('editId').value = record.id;
    document.getElementById('editEmpCode').value = record.empCode;
    document.getElementById('editCheckIn').value = record.checkIn;
    document.getElementById('editCheckOut').value = record.checkOut;
    document.getElementById('editShift').value = record.shift;
    document.getElementById('editStatus').value = record.status;
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
        record.checkIn = document.getElementById('editCheckIn').value.trim();
        record.checkOut = document.getElementById('editCheckOut').value.trim();
        record.shift = document.getElementById('editShift').value;
        record.status = document.getElementById('editStatus').value.trim();
        record.ot = document.getElementById('editOt').value;
        saveAndRenderApp();
        closeEditModal();
    }
}

function saveAndRenderApp() {
    localStorage.setItem('mfg5_attendance', JSON.stringify(attendanceData));
    renderTable();
}

function deleteRecord(id) {
    if (confirm('ต้องการลบรายการนี้ใช่หรือไม่?')) {
        attendanceData = attendanceData.filter(i => i.id !== id);
        saveAndRenderApp();
    }
}

function clearData() {
    if (confirm('⚠️ ต้องการล้างข้อมูลการลงเวลาทั้งหมดใช่หรือไม่?')) {
        attendanceData = [];
        saveAndRenderApp();
        sendToCloud({ sheet: 'attendance', action: 'clear' });
    }
}

function exportExcel() {
    if (attendanceData.length === 0) { alert("ไม่มีข้อมูล"); return; }
    let csv = "\ufeffรหัสพนักงาน,วันที่/เวลาเข้า,วันที่/เวลาออก,กะ,สถานะ,OT\n";
    attendanceData.forEach(x => { csv += `${x.empCode},${x.checkIn},${x.checkOut},${x.shift},${x.status},${x.ot}\n`; });
    downloadCSV(csv, `attendance_log_${new Date().toISOString().slice(0, 10)}.csv`);
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
        let empCode = input.value.trim();
        if(!empCode) return;

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
            sendToCloud({ sheet: 'restroom', action: 'add', ...newRec });
        } else {
            activeRecord.returnTime = timeStr;
            let diffMins = Math.floor((now.getTime() - activeRecord.rawStartTime) / 60000);
            activeRecord.duration = `${diffMins} นาที`;
            activeRecord.status = 'กลับเข้าพื้นที่แล้ว';
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
    restroomData.forEach(item => {
        let tr = document.createElement('tr');
        tr.innerHTML = `
            <td><b>${item.empCode}</b></td>
            <td>${item.reason}</td>
            <td>${item.startTime}</td>
            <td>${item.returnTime}</td>
            <td>${item.duration}</td>
            <td><span class="timer-badge ${item.status === 'ออกนอกพื้นที่' ? 'timer-over' : 'timer-normal'}">${item.status}</span></td>
            <td><button onclick="deleteRestroom(${item.id})" class="btn-danger">ลบ</button></td>
        `;
        list.appendChild(tr);
    });
}

function deleteRestroom(id) {
    restroomData = restroomData.filter(x => x.id !== id);
    localStorage.setItem('factoryRestroom', JSON.stringify(restroomData));
    renderRestroom();
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
    attendanceData.filter(i => i.empCode.toLowerCase().includes(searchVal)).forEach(item => {
        let tr = document.createElement('tr');
        tr.innerHTML = `
            <td><b>${item.empCode}</b></td>
            <td style="color: #4ade80;">${item.checkIn}</td>
            <td style="color: #f87171;">${item.checkOut}</td>
            <td>${item.shift}</td>
            <td>${item.status}</td>
            <td>${item.ot}</td>
        `;
        tbody.appendChild(tr);
    });
}

window.addEventListener('storage', (e) => {
    if (e.key === 'mfg5_attendance') {
        attendanceData = JSON.parse(e.newValue) || [];
        loadDashboard();
        renderTable();
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
});