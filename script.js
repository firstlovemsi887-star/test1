const API_URL = "https://script.google.com/macros/s/AKfycbwsqH0xnZVk5g3BJDhro4B9rKcMqYi0kGIFJcPDSulsUpT0Vs_reZQH5Ufc2QVwZ1Fi4Q/exec";

let attendanceData = JSON.parse(localStorage.getItem('mfg5_attendance')) || [];
let restroomData = JSON.parse(localStorage.getItem('factoryRestroom')) || [];
const scanChannel = new BroadcastChannel('mfg5_scan_channel');

// ดึงข้อมูลจาก Google Sheets เมื่อเปิดหน้าเว็บ
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
        console.error("ไม่สามารถเชื่อมต่อฐานข้อมูลบนคลาวด์ได้ ใช้ข้อมูล Local แทน", err);
    }
}

// ส่งข้อมูลไปยัง Google Sheets
async function sendToCloud(payload) {
    try {
        await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.error("บันทึกข้อมูลไป Cloud ไม่สำเร็จ", err);
    }
}

// Real-time Clock
function updateClock() {
    let now = new Date();
    let timeEl = document.getElementById("time");
    let dateEl = document.getElementById("date");
    if(timeEl) timeEl.innerHTML = now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    if(dateEl) dateEl.innerHTML = now.toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric", weekday: 'long' });
}
setInterval(updateClock, 1000);
updateClock();

// Auto-focus กลับมาที่ช่องสแกนอัตโนมัติ
document.addEventListener('click', function(e) {
    const empInput = document.getElementById('employee');
    if (empInput && !e.target.closest('button') && !e.target.closest('input') && !e.target.closest('.modal')) {
        empInput.focus();
    }
});

// Menu Logic
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

function exportExcelMenu() {
    attendanceData = JSON.parse(localStorage.getItem("mfg5_attendance")) || [];
    if (attendanceData.length === 0) { alert("ไม่มีข้อมูลสำหรับส่งออก"); return; }
    let csv = "\ufeffรหัสพนักงาน,วันที่,เข้า,ออก,กะ,สถานะ,OT\n";
    attendanceData.forEach(x => { csv += `${x.empCode},${x.date},${x.checkIn},${x.checkOut},${x.shift},${x.status},${x.ot}\n`; });
    downloadCSV(csv, `attendance_summary_${new Date().toISOString().slice(0, 10)}.csv`);
}

function confirmResetData() {
    let pwd = prompt("🔒 สิทธิ์หัวหน้างาน: ยืนยันการล้างข้อมูล กรุณาใส่รหัสผ่านหัวหน้างาน (Default: 1234)");
    if (pwd === "1234") {
        if (confirm("คุณต้องการล้างข้อมูลการลงเวลาทั้งหมดใช่หรือไม่?")) {
            localStorage.removeItem("mfg5_attendance");
            attendanceData = [];
            loadDashboard();
            sendToCloud({ sheet: 'attendance', action: 'clear' });
            alert("ล้างข้อมูลเรียบร้อยแล้ว");
        }
    } else if (pwd !== null) {
        alert("❌ รหัสผ่านไม่ถูกต้อง");
    }
}

// Index / Scan Logic
let isScanning = false;
let currentShift = 'กะเช้า';

function convertThaiToEng(str) {
    const numMap = { 'ๅ': '1', '/': '2', '-': '3', 'ภ': '4', 'ถ': '5', 'ุ': '6', 'ึ': '7', 'ค': '8', 'ต': '9', 'จ': '0' };
    const charMap = { 'ะ': 'a', 'ั': 'b', 'ี': 'c', 'ิ': 'd', 'ำ': 'e', 'โ': 'f', 'เ': 'g', '้': 'h', '่': 'j', 'า': 'k', 'ส': 'l', 'ื': 'm', 'ท': 'n', 'ม': 'o', 'ย': 'p', 'น': 'q', 'ร': 'r', 'ห': 's', 'ก': 't', 'ไ': 'w', 'ป': 'x', 'ผ': 'y', 'ฝ': 'z', 'ช': 'c', 'ข': 'x', 'ฟ': 'a', 'ด': 'f', 'อ': 'v' };
    return str.split('').map(ch => numMap[ch] || charMap[ch] || ch).join('');
}

function setShift(shiftName, btnElement) {
    currentShift = shiftName;
    document.querySelectorAll('.shift-btn').forEach(btn => btn.classList.remove('active'));
    if(btnElement) btnElement.classList.add('active');
    const messageBox = document.getElementById('message');
    if (messageBox) {
        messageBox.innerText = `พร้อมสแกน [${currentShift}]`;
        messageBox.style.color = '#333';
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
        setTimeout(() => { 
            isScanning = false; 
            input.focus();
        }, 300);
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
            <td><b>${item.empCode}</b></td>
            <td><span style="color: #2e7d32; font-weight: bold;">${item.checkIn}</span></td>
            <td><span style="color: #c62828; font-weight: bold;">${item.checkOut}</span></td>
            <td>${item.shift}</td>
            <td>${statusBadge}</td>
            <td>${otBadge}</td>
            <td>
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
    document.getElementById('editModal').style.display = 'block';
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

// Summary Logic
function showSummary() {
    let list = document.getElementById("summaryList");
    if (!list) return;
    list.innerHTML = "";

    attendanceData.forEach(x => {
        let row = document.createElement("tr");
        let isLate = x.status && x.status.includes("สาย");
        let statusBadge = isLate 
            ? `<span style="background: #ff4d4f; color: white; padding: 3px 8px; border-radius: 12px; font-size: 13px;">⚠️ ${x.status}</span>`
            : `<span style="background: #52c41a; color: white; padding: 3px 8px; border-radius: 12px; font-size: 13px;">ปกติ</span>`;

        let otBadge = (x.ot === "ทำ")
            ? `<span style="background: #1890ff; color: white; padding: 3px 8px; border-radius: 12px; font-size: 13px;">⭐ ทำ OT</span>`
            : `<span style="color: #888;">ไม่ทำ</span>`;

        row.innerHTML = `
            <td><b>${x.empCode}</b></td>
            <td><span style="color: #2e7d32;">${x.checkIn}</span></td>
            <td><span style="color: #c62828;">${x.checkOut}</span></td>
            <td>${x.shift}</td>
            <td>${statusBadge}</td>
            <td>${otBadge}</td>
        `;
        list.appendChild(row);
    });

    if(document.getElementById("sumTotal")) document.getElementById("sumTotal").innerHTML = new Set(attendanceData.map(x => x.empCode)).size;
    if(document.getElementById("sumIn")) document.getElementById("sumIn").innerHTML = attendanceData.filter(x => x.checkIn && x.checkIn !== '-').length;
    if(document.getElementById("sumLate")) document.getElementById("sumLate").innerHTML = attendanceData.filter(x => x.status && x.status.includes("สาย")).length;
    if(document.getElementById("sumOT")) document.getElementById("sumOT").innerHTML = attendanceData.filter(x => x.ot === "ทำ").length;
}

function exportSummary() {
    if (attendanceData.length === 0) { alert("ไม่มีข้อมูล"); return; }
    let csv = "\ufeffรหัสพนักงาน,วันที่/เวลาเข้า,วันที่/เวลาออก,กะ,สถานะ,OT\n";
    attendanceData.forEach(x => { csv += `${x.empCode},${x.checkIn},${x.checkOut},${x.shift},${x.status},${x.ot}\n`; });
    downloadCSV(csv, `summary_${new Date().toISOString().slice(0, 10)}.csv`);
}

// Restroom Logic
let currentReason = "เข้าห้องน้ำ";
let currentLimitMinutes = 15;

function selectReason(reason, limitMins, btnElement) {
    currentReason = reason;
    currentLimitMinutes = limitMins;
    document.querySelectorAll('.reason-btn').forEach(btn => btn.classList.remove('active'));
    if(btnElement) btnElement.classList.add('active');
    let msg = `เลือกสาเหตุ: ${reason}${limitMins > 0 ? ` (จำกัดเวลา ${limitMins} นาที)` : ''}`;
    showRestroomMsg(msg, "#009688");
    document.getElementById("employeeRestroom")?.focus();
}

function showRestroomMsg(text, color = "green") {
    let box = document.getElementById("restroomMessage");
    if(box) { box.innerHTML = text; box.style.color = color; }
}

document.getElementById("employeeRestroom")?.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.keyCode === 13) {
        let id = this.value.trim();
        if (id !== "") processRestroom(id);
        this.value = "";
    }
});

function processRestroom(id) {
    let now = new Date();
    let timeStr = now.toLocaleTimeString("th-TH", { hour12: false });
    let record = restroomData.find(x => x.id === id && x.outTime === "-");

    if (record) {
        record.outTime = timeStr;
        let diffMs = now.getTime() - record.startTimeMs;
        let totalMins = Math.floor(diffMs / 1000 / 60);
        let totalSecs = Math.floor((diffMs / 1000) % 60);
        record.durationStr = `${totalMins} นาที ${totalSecs} วินาที`;

        if (record.limitMinutes > 0 && totalMins > record.limitMinutes) {
            record.status = `⚠️ เกินเวลา (${totalMins - record.limitMinutes} นาที)`;
            showRestroomMsg(`⚠️ พนักงาน ${id} กลับมาแล้ว [${record.reason}] (เกินเวลา)`, "#d32f2f");
        } else {
            record.status = "ปกติ";
            showRestroomMsg(`✅ พนักงาน ${id} กลับเข้าทำงานแล้ว [${record.reason}]`, "green");
        }
    } else {
        let newRecord = {
            recordId: Date.now(),
            id: id,
            reason: currentReason,
            limitMinutes: currentLimitMinutes,
            date: now.toLocaleDateString("th-TH"),
            inTime: timeStr,
            outTime: "-",
            startTimeMs: now.getTime(),
            durationStr: "-",
            status: "กำลังทำกิจกรรม"
        };
        restroomData.push(newRecord);
        showRestroomMsg(`📌 พนักงาน ${id} บันทึกออก: [${currentReason}]`, "#009688");
        
        sendToCloud({
            sheet: 'restroom',
            action: 'add',
            ...newRecord
        });
    }

    localStorage.setItem("factoryRestroom", JSON.stringify(restroomData));
    renderRestroom();
}

function renderRestroom() {
    let list = document.getElementById("restroomList");
    if (!list) return;
    list.innerHTML = "";
    let nowMs = Date.now();

    restroomData.slice().reverse().forEach(item => {
        let row = document.createElement("tr");
        let statusText = "";

        if (item.outTime === "-") {
            let elapsedSecs = Math.floor((nowMs - item.startTimeMs) / 1000);
            if (item.limitMinutes > 0) {
                let remainSecs = (item.limitMinutes * 60) - elapsedSecs;
                if (remainSecs >= 0) {
                    let m = Math.floor(remainSecs / 60), s = remainSecs % 60;
                    statusText = `<span class="timer-badge timer-normal">⏳ เหลือ ${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}</span>`;
                } else {
                    let overSecs = Math.abs(remainSecs);
                    let m = Math.floor(overSecs / 60), s = overSecs % 60;
                    statusText = `<span class="timer-badge timer-over">🚨 เกินเวลา ${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}</span>`;
                }
            } else {
                let m = Math.floor(elapsedSecs / 60), s = elapsedSecs % 60;
                statusText = `<span class="timer-badge" style="background: #e3f2fd; color: #1565c0;">⏱️ ผ่านไป ${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}</span>`;
            }
        } else {
            statusText = item.status.includes("เกินเวลา") 
                ? `<span style="color: #d32f2f; font-weight: bold;">${item.status}</span>` 
                : `<span style="color: #2e7d32; font-weight: bold;">✅ ปกติ</span>`;
        }

        row.innerHTML = `
            <td><b>${item.id}</b></td>
            <td><span style="background: #f0f4f8; padding: 3px 8px; border-radius: 6px;">${item.reason}</span></td>
            <td>${item.inTime}</td>
            <td>${item.outTime}</td>
            <td>${item.durationStr}</td>
            <td>${statusText}</td>
            <td>
                <button onclick="deleteRestroomRecord(${item.recordId})" class="btn-danger" style="padding: 4px 10px; font-size: 13px;">ลบ</button>
            </td>
        `;
        list.appendChild(row);
    });
}

function deleteRestroomRecord(recordId) {
    if (confirm("ต้องการลบรายการนี้ใช่หรือไม่?")) {
        restroomData = restroomData.filter(x => x.recordId !== recordId);
        localStorage.setItem("factoryRestroom", JSON.stringify(restroomData));
        renderRestroom();
    }
}

function exportRestroomExcel() {
    if (restroomData.length === 0) { alert("ไม่มีข้อมูล"); return; }
    let csv = "\ufeffรหัสพนักงาน,สาเหตุ,วันที่,เวลาเริ่ม,เวลาออก,เวลารวม,สถานะ\n";
    restroomData.forEach(x => { csv += `${x.id},${x.reason},${x.date},${x.inTime},${x.outTime},${x.durationStr},${x.status}\n`; });
    downloadCSV(csv, `break_log_${new Date().toISOString().slice(0, 10)}.csv`);
}

// Display Logic
scanChannel.onmessage = function (event) {
    const data = event.data;
    const card = document.getElementById('latestCard');
    const title = document.getElementById('scanActionTitle');
    const codeEl = document.getElementById('latestEmpCode');
    const details = document.getElementById('latestDetails');

    if(codeEl) codeEl.innerText = data.empCode;

    if (card && title && details) {
        if (data.type === 'CHECK_IN') {
            card.className = 'latest-card active-checkin';
            title.innerHTML = `🟢 [เข้างานสำเร็จ - ${data.shift}]`;
            details.innerHTML = `เวลา: ${data.time} | สถานะ: <span style="color:${data.status.includes('สาย')?'#d32f2f':'#16a34a'}; font-weight:bold;">${data.status}</span>`;
        } else if (data.type === 'CHECK_OUT') {
            card.className = 'latest-card active-checkout';
            title.innerHTML = `🔴 [สแกนออกงาน - ${data.shift}]`;
            details.innerHTML = `เวลา: ${data.time} | OT: <span style="color:#0284c7; font-weight:bold;">${data.ot === 'ทำ' ? 'ทำ OT' : 'ไม่ทำ'}</span>`;
        }
    }

    attendanceData = JSON.parse(localStorage.getItem('mfg5_attendance')) || [];
    renderDisplayTable();
};

function renderDisplayTable() {
    const tbody = document.getElementById('displayList');
    if (!tbody) return;
    const searchVal = document.getElementById('empSearchInput')?.value.toLowerCase() || '';
    tbody.innerHTML = '';

    const todayStr = new Date().toLocaleDateString('th-TH');
    const filtered = attendanceData.filter(i => i.date === todayStr && i.empCode.toLowerCase().includes(searchVal));

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 30px;">ไม่พบข้อมูลการลงเวลา</td></tr>`;
        return;
    }

    filtered.forEach(item => {
        const tr = document.createElement('tr');
        let statusBadge = item.status.includes("สาย") 
            ? `<span style="background: #ff4d4f; color: white; padding: 3px 8px; border-radius: 12px; font-size: 13px;">⚠️ ${item.status}</span>`
            : `<span style="background: #52c41a; color: white; padding: 3px 8px; border-radius: 12px; font-size: 13px;">ปกติ</span>`;

        let otBadge = (item.ot === "ทำ") ? `<span style="background: #1890ff; color: white; padding: 3px 8px; border-radius: 12px; font-size: 13px;">⭐ ทำ OT</span>` : `<span style="color: #888;">ไม่ทำ</span>`;

        tr.innerHTML = `
            <td><b>${item.empCode}</b></td>
            <td><span style="color: #2e7d32;">${item.checkIn}</span></td>
            <td><span style="color: #c62828;">${item.checkOut}</span></td>
            <td>${item.shift}</td>
            <td>${statusBadge}</td>
            <td>${otBadge}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Helpers & Initializers
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

window.addEventListener('storage', (e) => {
    if (e.key === 'mfg5_attendance') {
        attendanceData = JSON.parse(e.newValue) || [];
        loadDashboard();
        showSummary();
        renderTable();
        renderDisplayTable();
    }
});

document.addEventListener("DOMContentLoaded", () => {
    fetchCloudData();
    document.getElementById('employee')?.focus();
});

setInterval(() => {
    renderRestroom();
}, 1000);