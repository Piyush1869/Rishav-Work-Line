import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, query, addDoc, updateDoc, deleteDoc, serverTimestamp, where } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

// ==========================================
// 💻 DIAGNOSTIC CONSOLE
// ==========================================
const originalLog = console.log;
const originalError = console.error;
const debugLog = document.getElementById('debug-log');
if (sessionStorage.getItem('app_debug_logs') && debugLog) { debugLog.innerHTML = sessionStorage.getItem('app_debug_logs'); }
function formatMsg(args) { return args.map(arg => { if (arg instanceof Error) return arg.message; if (typeof arg === 'object') { try { return JSON.stringify(arg); } catch(e) { return "[Object]"; } } return String(arg); }).join(' '); }
function logToScreen(msg, isError = false) { if(debugLog) { const color = isError ? '#ff4444' : '#00ff00'; debugLog.innerHTML += `<div style="color:${color}; margin-bottom: 4px; border-bottom: 1px dashed #333; padding-bottom: 2px;">> ${msg}</div>`; debugLog.scrollTop = debugLog.scrollHeight; sessionStorage.setItem('app_debug_logs', debugLog.innerHTML); } }
console.log = (...args) => { originalLog(...args); logToScreen(formatMsg(args), false); };
console.error = (...args) => { originalError(...args); logToScreen(formatMsg(args), true); };

document.getElementById('debug-btn').addEventListener('click', () => document.getElementById('debug-modal').style.display = 'flex');
document.getElementById('close-debug-btn').addEventListener('click', () => document.getElementById('debug-modal').style.display = 'none');
document.getElementById('clear-debug-btn').addEventListener('click', () => { debugLog.innerHTML = ''; sessionStorage.removeItem('app_debug_logs'); });

// ==========================================
// 🛠️ PWA INSTALL LOGIC
// ==========================================
if ('serviceWorker' in navigator) { 
    navigator.serviceWorker.register('/sw.js').catch(e => console.error("SW Error:", e)); 
}
let deferredPrompt; 
const installBtn = document.getElementById('install-app-btn'); 
window.addEventListener('beforeinstallprompt', (e) => { 
    e.preventDefault(); deferredPrompt = e; 
    if(installBtn) installBtn.style.display = 'inline-flex'; 
}); 
if(installBtn) {
    installBtn.addEventListener('click', async () => { 
        if (deferredPrompt) { deferredPrompt.prompt(); const { outcome } = await deferredPrompt.userChoice; if (outcome === 'accepted') installBtn.style.display = 'none'; deferredPrompt = null; } 
    });
}

// ==========================================
// 🔗 FIREBASE CONNECTIONS
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyC3QMu8G5Q-1Fi8AoB2i3NtlusqjRbFVGg",
    authDomain: "rishav-77936.firebaseapp.com",
    projectId: "rishav-77936",
    storageBucket: "rishav-77936.firebasestorage.app",
    messagingSenderId: "568102781814",
    appId: "1:568102781814:web:a7ba6f41ca70c6498b3057"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUserDoc = null;
let previousTasksState = new Map(); 
const GOOGLE_SHEETS_WEBHOOK = "https://script.google.com/macros/s/AKfycbwZofHJ2_XKmrTyw9qFdZmsmYifOdYawaiyed75yZV9JQBjqIRu9Qc8PooetfQSZqU3/exec";

// ==========================================
// 🎨 LIVE THEME CONTROLLER
// ==========================================
function applyTheme(uiStyle, bgTheme) {
    if (uiStyle === 'glassy') document.body.classList.add('glass-theme');
    else document.body.classList.remove('glass-theme');

    if (bgTheme && bgTheme !== 'none') {
        document.body.style.background = `url('${decodeURIComponent(bgTheme)}') no-repeat center center fixed`;
        document.body.style.backgroundSize = 'cover';
    } else {
        document.body.style.background = 'var(--bg-color)';
    }
}

const themeOptions = document.querySelectorAll('.theme-option');
const bgThemeInput = document.getElementById('prof-bg-theme');
const uiStyleInput = document.getElementById('prof-ui-style');

if(themeOptions) {
    themeOptions.forEach(option => {
        option.addEventListener('click', () => {
            themeOptions.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            bgThemeInput.value = option.getAttribute('data-theme');
            applyTheme(uiStyleInput.value, bgThemeInput.value); 
        });
    });
}
if(uiStyleInput) uiStyleInput.addEventListener('change', () => { applyTheme(uiStyleInput.value, bgThemeInput.value); });

// ==========================================
// 🚀 NTFY PUSH & GOOGLE SHEETS
// ==========================================
function pushToNtfy(alertTitle, alertMessage, priorityLevel, customTopicSuffix = "") {
    const tags = priorityLevel >= 4 ? "rotating_light,warning" : "speech_balloon";
    const topicPath = `rishav_lab_alerts_2026${customTopicSuffix}`;
    const encodedTitle = encodeURIComponent(alertTitle);
    const topicUrl = `https://ntfy.sh/${topicPath}?title=${encodedTitle}&priority=${priorityLevel}&tags=${tags}`;
    fetch(topicUrl, { method: 'POST', body: alertMessage }).then(async (res) => { if (res.ok) showToast("Ntfy Alert Sent!", "fa-satellite-dish"); }).catch(e => console.error("Ntfy Error:", e));
}

async function logToGoogleSheets(taskData, action = "Update") {
    if (!GOOGLE_SHEETS_WEBHOOK) return;
    const sheetUserName = currentUserDoc && currentUserDoc.name ? currentUserDoc.name : "Unknown User";
    
    const payload = { 
        userName: sheetUserName, 
        taskName: taskData.title || "Untitled", 
        details: taskData.details || "No details provided", 
        status: taskData.status || "Pending", 
        type: taskData.isPrivate ? "Private Task" : "Lab Task",
        action: action
    };

    try { await fetch(GOOGLE_SHEETS_WEBHOOK, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) }); } 
    catch (e) { console.error("❌ Sheets sync failed:", e); }
}

const flashOverlay = document.getElementById('flash-overlay'); const alarmAudio = document.getElementById('task-alarm'); const alertBtn = document.getElementById('enable-alerts-btn'); let isRinging = false;
if (Notification.permission === 'granted' && alertBtn) alertBtn.classList.add('glow-blue');
function showToast(message, icon = "fa-bell") { const container = document.getElementById('toast-container'); if(!container) return; const toast = document.createElement('div'); toast.className = 'toast'; toast.innerHTML = `<i class="fas ${icon}" style="color: #10b981;"></i> <span>${message}</span>`; container.appendChild(toast); setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000); }
if(alertBtn) alertBtn.addEventListener('click', async () => { try { const perm = await Notification.requestPermission(); if(perm === 'granted') { alertBtn.classList.add('glow-blue'); showToast("Alerts enabled!", "fa-check-circle"); alarmAudio.play().then(()=>alarmAudio.pause()).catch(e=>{}); } } catch(e) {} });

const screens = { login: document.getElementById('login-screen'), profile: document.getElementById('profile-screen'), dashboard: document.getElementById('dashboard-screen') };
function showScreen(screenName) { Object.values(screens).forEach(s => { if(s) s.classList.remove('active'); }); if(screens[screenName]) screens[screenName].classList.add('active'); }

// === AUTHENTICATION & PROFILE ===
document.getElementById('login-google-btn').addEventListener('click', () => signInWithPopup(auth, new GoogleAuthProvider()));
window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { 'size': 'normal' });
document.getElementById('send-otp-btn').addEventListener('click', () => { signInWithPhoneNumber(auth, document.getElementById('phone-number').value, window.recaptchaVerifier).then((res) => { window.confirmationResult = res; document.getElementById('otp-section').style.display = 'block'; document.getElementById('send-otp-btn').style.display = 'none'; }); });
document.getElementById('verify-otp-btn').addEventListener('click', () => window.confirmationResult.confirm(document.getElementById('otp-code').value));

onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log(`✅ Logged in (${user.email || user.phoneNumber})`);
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            currentUserDoc = userSnap.data(); 
            applyTheme(currentUserDoc.uiStyle, currentUserDoc.bgTheme); 
            setupDashboard(user, currentUserDoc); 
            showScreen('dashboard');
        } else {
            showScreen('profile');
            if (user.email) { document.getElementById('prof-email').style.display = 'none'; document.getElementById('prof-phone').style.display = 'block'; } 
            else { document.getElementById('prof-phone').style.display = 'none'; document.getElementById('prof-email').style.display = 'block'; }
        }
    } else { showScreen('login'); }
});

if(document.getElementById('copy-ntfy-btn')) {
    document.getElementById('copy-ntfy-btn').addEventListener('click', () => {
        const copyText = document.getElementById('prof-ntfy-id'); copyText.select(); document.execCommand("copy"); showToast("Channel URL copied!", "fa-copy");
    });
}

document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const user = auth.currentUser; 
    const rawName = document.getElementById('prof-name').value;
    const cleanName = rawName.replace(/[^a-zA-Z0-9]/g, ""); 
    const uiStyle = document.getElementById('prof-ui-style')?.value || 'normal';
    const bgTheme = document.getElementById('prof-bg-theme')?.value || 'none';
    
    const profileData = { 
        uid: user.uid, name: rawName, cleanName: cleanName, 
        empId: document.getElementById('prof-emp-id')?.value || "N/A", 
        uiStyle: uiStyle, bgTheme: bgTheme,
        email: document.getElementById('prof-email').value || user.email, phone: document.getElementById('prof-phone').value || user.phoneNumber, 
        lab: document.getElementById('prof-lab').value, status: "Active", photoURL: user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(rawName || 'U')}&background=2563eb&color=fff` 
    };
    await setDoc(doc(db, "users", user.uid), profileData);
    currentUserDoc = profileData; 
    applyTheme(uiStyle, bgTheme);
    setupDashboard(user, profileData); 
    showScreen('dashboard'); 
    showToast("Settings Saved!", "fa-user-check");

    logToGoogleSheets({ title: "Account Setup", details: `Profile registered for ${rawName}`, status: "Active", isPrivate: false }, "User_Registration");
});

if(document.getElementById('display-pic')) document.getElementById('display-pic').addEventListener('click', () => document.getElementById('edit-profile-btn').click());

document.getElementById('edit-profile-btn').addEventListener('click', () => {
    if (currentUserDoc) { 
        document.getElementById('prof-name').value = currentUserDoc.name || ''; 
        if(document.getElementById('prof-emp-id')) document.getElementById('prof-emp-id').value = currentUserDoc.empId || ''; 
        document.getElementById('prof-email').value = currentUserDoc.email || ''; 
        document.getElementById('prof-phone').value = currentUserDoc.phone || ''; 
        document.getElementById('prof-lab').value = currentUserDoc.lab || 'PVL'; 
        if(document.getElementById('prof-ui-style')) document.getElementById('prof-ui-style').value = currentUserDoc.uiStyle || 'normal'; 
        
        if(document.getElementById('prof-bg-theme')) {
            document.getElementById('prof-bg-theme').value = currentUserDoc.bgTheme || 'none'; 
            document.querySelectorAll('.theme-option').forEach(opt => {
                opt.classList.remove('selected');
                if(opt.getAttribute('data-theme') === (currentUserDoc.bgTheme || 'none')) { opt.classList.add('selected'); }
            });
        }
        document.getElementById('prof-email').style.display = 'block'; 
        document.getElementById('prof-phone').style.display = 'block'; 
        showScreen('profile'); 
    }
});

// === 1-ON-1 CHAT & USER INFO PROFILE ===
let currentChatUser = null; let chatUnsubscribe = null;
function getChatId(uid1, uid2) { return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`; }
const chatPanel = document.getElementById('chat-panel'); const contactListArea = document.getElementById('chat-contact-list'); const conversationArea = document.getElementById('chat-conversation-area'); const chatTitle = document.getElementById('chat-panel-title'); const backBtn = document.getElementById('chat-back-btn');
const chatInfoBtn = document.getElementById('chat-info-btn');

document.getElementById('fab-chat').addEventListener('click', () => { chatPanel.classList.remove('hidden'); showContactList(); });
document.getElementById('close-chat-btn').addEventListener('click', () => chatPanel.classList.add('hidden'));
backBtn.addEventListener('click', () => showContactList());

function showContactList() { 
    currentChatUser = null; if(chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; } 
    backBtn.classList.add('hidden'); 
    if(chatInfoBtn) chatInfoBtn.classList.add('hidden');
    chatTitle.innerHTML = `<i class="fas fa-address-book"></i> Contacts`; conversationArea.classList.add('hidden'); contactListArea.classList.remove('hidden'); 
}

function openDirectChat(targetUser) { 
    currentChatUser = targetUser; backBtn.classList.remove('hidden'); 
    if(chatInfoBtn) chatInfoBtn.classList.remove('hidden');
    chatTitle.textContent = targetUser.name; contactListArea.classList.add('hidden'); conversationArea.classList.remove('hidden'); 
    const chatId = getChatId(auth.currentUser.uid, targetUser.uid); const chatMessages = document.getElementById('chat-messages'); if(chatUnsubscribe) chatUnsubscribe(); 
    chatUnsubscribe = onSnapshot(query(collection(db, "direct_messages"), where("chatId", "==", chatId)), (snapshot) => { 
        const msgs = []; snapshot.forEach(doc => msgs.push(doc.data())); 
        msgs.sort((a, b) => { const timeA = a.timestamp ? a.timestamp.toMillis() : Date.now(); const timeB = b.timestamp ? b.timestamp.toMillis() : Date.now(); return timeA - timeB; }); 
        chatMessages.innerHTML = ''; 
        msgs.forEach(msg => { const isMine = msg.senderId === auth.currentUser.uid; const timeString = msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Sending...'; chatMessages.innerHTML += `<div class="chat-msg ${isMine ? 'msg-mine' : 'msg-theirs'}">${msg.text}<span class="time">${timeString}</span></div>`; }); 
        chatMessages.scrollTop = chatMessages.scrollHeight; 
    });
}

if(chatInfoBtn) {
    chatInfoBtn.addEventListener('click', () => {
        if (!currentChatUser) return;
        document.getElementById('info-pic').src = currentChatUser.photoURL || `https://ui-avatars.com/api/?name=${currentChatUser.name[0]}&background=2563eb&color=fff`;
        document.getElementById('info-name').textContent = currentChatUser.name;
        document.getElementById('info-lab-badge').textContent = (currentChatUser.lab || "Unknown") + " Lab";
        document.getElementById('info-emp-id').textContent = currentChatUser.empId || "Not Provided";
        document.getElementById('info-phone').textContent = currentChatUser.phone || "Not Provided";
        document.getElementById('info-email').textContent = currentChatUser.email || "Not Provided";
        
        const cleanName = currentChatUser.cleanName || (currentChatUser.name ? currentChatUser.name.replace(/[^a-zA-Z0-9]/g, "") : "");
        document.getElementById('info-ntfy').textContent = `rishav_lab_alerts_2026_${cleanName}`;
        
        document.getElementById('user-info-modal').style.display = 'flex';
    });
}
if(document.getElementById('close-info-modal-btn')) {
    document.getElementById('close-info-modal-btn').addEventListener('click', () => document.getElementById('user-info-modal').style.display = 'none');
}

async function sendChatMessage() { 
    const input = document.getElementById('chat-input'); const text = input.value; 
    const prioritySelect = document.getElementById('chat-priority').value; 
    if(!text || !currentChatUser) return; 
    input.value = ''; 
    await addDoc(collection(db, "direct_messages"), { chatId: getChatId(auth.currentUser.uid, currentChatUser.uid), text: text, senderId: auth.currentUser.uid, timestamp: serverTimestamp() }); 
    
    const targetCleanName = currentChatUser.cleanName || (currentChatUser.name ? currentChatUser.name.replace(/[^a-zA-Z0-9]/g, "") : "");
    pushToNtfy(`💬 Chat from ${currentUserDoc.name}`, text, prioritySelect, targetCleanName ? `_${targetCleanName}` : "");
}
document.getElementById('send-chat-btn').addEventListener('click', sendChatMessage); document.getElementById('chat-input').addEventListener('keypress', (e) => { if(e.key === 'Enter') sendChatMessage(); });

// === DASHBOARD & TASKS & NOTICES ===
function setupDashboard(user, profile) {
    document.getElementById('display-name').textContent = profile.name; document.getElementById('display-pic').src = profile.photoURL; document.getElementById('user-status').value = profile.status || "Active";
    if(document.getElementById('display-lab')) document.getElementById('display-lab').textContent = (profile.lab || "PVL") + " Lab";
    document.getElementById('user-status').addEventListener('change', async (e) => { await updateDoc(doc(db, "users", user.uid), { status: e.target.value }); });

    const mySafeCleanName = profile.cleanName || (profile.name ? profile.name.replace(/[^a-zA-Z0-9]/g, "") : "YourName");
    const myPersonalChannel = `rishav_lab_alerts_2026_${mySafeCleanName}`;
    if (document.getElementById('prof-ntfy-id')) document.getElementById('prof-ntfy-id').value = myPersonalChannel;

    // ⏰ SMART REMINDER SYSTEM (Checks every 15 seconds for Overdue tasks)
    if (!window.reminderInterval) {
        window.reminderInterval = setInterval(() => {
            const tasks = document.querySelectorAll('.task-item[data-due-time]');
            const now = Date.now();
            tasks.forEach(el => {
                const dueTime = parseInt(el.dataset.dueTime);
                const taskId = el.dataset.taskId;
                if (now > dueTime && !sessionStorage.getItem(`reminded_${taskId}`)) {
                    showToast(`Task Overdue!`, 'fa-exclamation-triangle');
                    pushToNtfy(`🚨 OVERDUE TASK`, `Please complete your accepted task!`, "4", `_${mySafeCleanName}`);
                    try { alarmAudio.play(); setTimeout(()=>alarmAudio.pause(), 3000); } catch(e){}
                    sessionStorage.setItem(`reminded_${taskId}`, 'true');
                    el.style.borderLeftColor = '#ef4444';
                    if (!el.innerHTML.includes('OVERDUE')) {
                        el.innerHTML += `<p style="color:#ef4444; font-weight:bold; margin-top:5px; font-size:0.8rem;"><i class="fas fa-exclamation-triangle"></i> OVERDUE 🚨</p>`;
                    }
                }
            });
        }, 15000); 
    }

    onSnapshot(collection(db, "users"), (snapshot) => {
        contactListArea.innerHTML = `<div style="background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; padding: 10px; border-radius: 8px; margin-bottom: 15px; font-size: 0.85rem; color: #a7f3d0;"><i class="fas fa-info-circle"></i> <strong>Tip:</strong> Subscribe to your personal Ntfy channel on your phone to get DMs! (Example: <em>rishav_lab_alerts_2026_${mySafeCleanName}</em>)</div>`; 
        snapshot.forEach(userDoc => { const u = userDoc.data(); if(u.uid !== user.uid) { const contactEl = document.createElement('div'); contactEl.className = 'contact-item'; contactEl.innerHTML = `<img src="${u.photoURL}" onerror="this.src='https://ui-avatars.com/api/?name=${u.name[0]}&background=2563eb&color=fff'"><div><span class="name">${u.name}</span><span class="lab">${u.lab} Lab - ${u.status === 'Active' ? '🟢' : '🔴'}</span></div>`; contactEl.onclick = () => openDirectChat(u); contactListArea.appendChild(contactEl); } });
    });

    onSnapshot(collection(db, "notices"), (snapshot) => {
        const noticeList = document.getElementById('notice-board-list'); const notices = [];
        snapshot.forEach(doc => notices.push(doc.data()));
        notices.sort((a, b) => { const tA = a.timestamp ? a.timestamp.toMillis() : Date.now(); const tB = b.timestamp ? b.timestamp.toMillis() : Date.now(); return tB - tA; });
        if (notices.length === 0) noticeList.innerHTML = '<p class="text-muted">No notices right now.</p>';
        else {
            noticeList.innerHTML = '';
            notices.forEach(notice => {
                const timeString = notice.timestamp ? new Date(notice.timestamp.toDate()).toLocaleString([], {month:'short', day:'numeric', hour: '2-digit', minute:'2-digit'}) : 'Just now';
                noticeList.innerHTML += `<div style="background: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; padding: 10px; border-radius: 4px;"><div style="display:flex; justify-content:space-between; margin-bottom: 5px;"><strong style="color: #ef4444;">${notice.title}</strong><span style="font-size: 0.75rem; color: #aaa;">${timeString}</span></div><p style="margin: 0; font-size: 0.9rem;">${notice.details}</p><div style="margin-top: 5px; font-size: 0.8rem; color: #888;">- Posted by ${notice.senderName}</div></div>`;
            });
        }
    });

    onSnapshot(collection(db, "tasks"), (snapshot) => {
        const openList = document.getElementById('open-tasks-list'); const myList = document.getElementById('my-tasks-list'); const privList = document.getElementById('private-tasks-list');
        openList.innerHTML = ''; myList.innerHTML = ''; privList.innerHTML = '';
        let unassignedCount = 0; let myAcceptedCount = 0; let myPrivCount = 0; let statCreated = 0; let statHelped = 0; let statAccepted = 0;

        snapshot.forEach(taskDoc => {
            const task = taskDoc.data(); const taskId = taskDoc.id;
            
            // PRIVATE TASKS
            if(task.isPrivate) {
                if(task.ownerId === user.uid) {
                    myPrivCount++;
                    const pEl = document.createElement('div'); pEl.className = 'task-item';
                    pEl.innerHTML = `<h4>${task.title} <span class="priv-badge">${task.status}</span></h4><p>${task.details}</p><p><i class="far fa-calendar"></i> ${task.startDate} | <i class="far fa-clock"></i> ${task.startTime}</p>`;
                    
                    // Delete Button for Private Task
                    const pDelBtn = document.createElement('button');
                    pDelBtn.className = 'icon-btn';
                    pDelBtn.innerHTML = '<i class="fas fa-trash"></i>';
                    pDelBtn.style.float = 'right';
                    pDelBtn.style.color = '#ef4444';
                    pDelBtn.onclick = async () => { if(confirm("Delete private task?")) await deleteDoc(taskDoc.ref); };
                    pEl.prepend(pDelBtn);

                    if(task.status !== "Done") {
                        const nextStatusBtn = document.createElement('button'); nextStatusBtn.className = 'priv-btn'; nextStatusBtn.textContent = task.status === "Upcoming" ? "Start (Mark Ongoing)" : "Finish (Mark Done)";
                        nextStatusBtn.onclick = async () => { 
                            const newStatus = task.status === "Upcoming" ? "Ongoing" : "Done"; 
                            await updateDoc(taskDoc.ref, { status: newStatus }); 
                            logToGoogleSheets({ ...task, status: newStatus }, "Update"); 
                        };
                        pEl.appendChild(nextStatusBtn);
                    }
                    privList.appendChild(pEl);
                } return;
            }

            // LAB TASKS
            if(task.createdBy === user.uid) { statCreated++; if(task.status !== "Pending") statHelped++; }
            if(task.acceptedById === user.uid) statAccepted++;
            const prevTask = previousTasksState.get(taskId);
            if (prevTask && prevTask.status === "Pending" && task.status === "Accepted" && task.createdBy === user.uid) { showToast(`${task.acceptedBy} accepted your task!`, 'fa-user-check'); }
            previousTasksState.set(taskId, task);

            if ((task.targetLab !== "Both") && (profile.lab !== "Both") && (task.targetLab !== profile.lab)) return;

            const taskEl = document.createElement('div'); taskEl.className = 'task-item';
            taskEl.innerHTML = `<h4>${task.title}</h4><p><i class="fas fa-info-circle"></i> ${task.details}</p><p><i class="far fa-clock"></i> Time: ${task.timeNeeded} | Mgr: ${task.manager}</p>`;

            // ✏️ EDIT & DELETE CONTROLS (Only visible to Creator or Assignee)
            if (task.createdBy === user.uid || task.acceptedById === user.uid) {
                const delBtn = document.createElement('button');
                delBtn.className = 'icon-btn';
                delBtn.innerHTML = '<i class="fas fa-trash"></i>';
                delBtn.style.float = 'right';
                delBtn.style.color = '#ef4444';
                delBtn.onclick = async () => { 
                    if(confirm("Delete this task?")) {
                        await deleteDoc(taskDoc.ref); 
                        logToGoogleSheets({ ...task, status: "Deleted" }, "Deleted");
                    }
                };
                
                const editBtn = document.createElement('button');
                editBtn.className = 'icon-btn';
                editBtn.innerHTML = '<i class="fas fa-edit"></i>';
                editBtn.style.float = 'right';
                editBtn.style.color = '#3b82f6';
                editBtn.style.marginRight = '10px';
                editBtn.onclick = async () => { 
                    const newDetails = prompt("Update Task Details:", task.details);
                    if(newDetails && newDetails !== task.details) {
                        await updateDoc(taskDoc.ref, { details: newDetails }); 
                        logToGoogleSheets({ ...task, details: newDetails, status: "Updated" }, "Updated");
                    }
                };
                taskEl.prepend(delBtn);
                taskEl.prepend(editBtn);
            }

            if (task.status === "Pending" && (task.assignedTo === "All" || task.assignedTo === "WhatsApp" || task.assignedTo === "BothAlerts" || task.assignedTo === user.uid)) {
                if (task.assignedTo === "All" || task.assignedTo === "BothAlerts") unassignedCount++;
                const acceptBtn = document.createElement('button'); acceptBtn.className = 'task-btn'; acceptBtn.style.background = 'rgba(245, 158, 11, 0.2)'; acceptBtn.style.color = '#fbbf24'; acceptBtn.innerHTML = '<i class="fas fa-hand-paper"></i> Accept Task';
                
                // ⏱️ SMART ACCEPT (Starts the Overdue Timer)
                acceptBtn.onclick = async () => { 
                    const timeStr = prompt("Expected completion time (in minutes)? Example: 30"); 
                    const time = parseInt(timeStr);
                    if(time && !isNaN(time)) { 
                        await updateDoc(taskDoc.ref, { 
                            status: "Accepted", acceptedBy: profile.name, acceptedById: user.uid, 
                            expectedMinutes: time, acceptedAt: serverTimestamp() 
                        }); 
                        logToGoogleSheets({ ...task, status: "Accepted" }, "Accepted"); 
                    } else if (timeStr !== null) {
                        alert("Please enter a valid number of minutes.");
                    }
                };
                taskEl.appendChild(acceptBtn); openList.appendChild(taskEl);
            } else if (task.acceptedById === user.uid) {
                
                // Track Due Time for Accepted Tasks
                if (task.expectedMinutes) {
                    const acceptedTimeMs = task.acceptedAt ? task.acceptedAt.toMillis() : Date.now();
                    const dueTime = acceptedTimeMs + (task.expectedMinutes * 60000);
                    taskEl.dataset.dueTime = dueTime;
                    taskEl.dataset.taskId = taskId;
                    
                    if (Date.now() > dueTime) {
                        taskEl.style.borderLeftColor = '#ef4444';
                        taskEl.innerHTML += `<p style="color:#ef4444; font-weight:bold; margin-top:5px; font-size:0.8rem;"><i class="fas fa-exclamation-triangle"></i> OVERDUE 🚨</p>`;
                    }
                }

                if (task.status !== "Done") {
                    const doneBtn = document.createElement('button'); doneBtn.className = 'task-btn done'; doneBtn.innerHTML = '<i class="fas fa-check"></i> Mark as Done';
                    doneBtn.onclick = async () => { 
                        await updateDoc(taskDoc.ref, { status: "Done" }); 
                        logToGoogleSheets({ ...task, status: "Done" }, "Completed"); 
                    };
                    taskEl.appendChild(doneBtn);
                }
                myList.appendChild(taskEl); myAcceptedCount++;
            }
        });

        document.getElementById('stat-assigned').textContent = statCreated; document.getElementById('stat-helped').textContent = statHelped; document.getElementById('stat-accepted').textContent = statAccepted;
        if (unassignedCount > 0 && profile.status === "Active") { if(!isRinging) { flashOverlay.style.display = 'block'; try { alarmAudio.play(); }catch(e){} isRinging = true; } } 
        else { flashOverlay.style.display = 'none'; alarmAudio.pause(); alarmAudio.currentTime = 0; isRinging = false; }

        if (unassignedCount === 0) openList.innerHTML = '<p class="text-muted">No pending tasks right now.</p>';
        if (myAcceptedCount === 0) myList.innerHTML = '<p class="text-muted">You have no accepted tasks.</p>';
        if (myPrivCount === 0) privList.innerHTML = '<p class="text-muted">No private tasks.</p>';
    });
}

const noticeModal = document.getElementById('notice-modal'); document.getElementById('open-notice-btn').addEventListener('click', () => noticeModal.style.display = 'flex'); document.getElementById('close-notice-modal-btn').addEventListener('click', () => noticeModal.style.display = 'none');
document.getElementById('submit-notice-btn').addEventListener('click', async () => { const title = document.getElementById('notice-title')?.value; const details = document.getElementById('notice-details')?.value; if(!title) { alert("Title is required!"); return; } await addDoc(collection(db, "notices"), { title: title, details: details || "", senderName: currentUserDoc.name, senderId: auth.currentUser.uid, timestamp: serverTimestamp() }); noticeModal.style.display = 'none'; if(document.getElementById('notice-title')) document.getElementById('notice-title').value = ''; if(document.getElementById('notice-details')) document.getElementById('notice-details').value = ''; showToast("Notice Published!", "fa-bullhorn"); pushToNtfy(`📢 NOTICE: ${title}`, `${details}\n- Posted by ${currentUserDoc.name}`, "4", ""); });

const taskModal = document.getElementById('task-modal'); document.getElementById('fab-add-task').addEventListener('click', () => taskModal.style.display = 'flex'); document.getElementById('close-modal-btn').addEventListener('click', () => taskModal.style.display = 'none');
document.getElementById('submit-task-btn').addEventListener('click', async () => {
    try {
        const title = document.getElementById('task-title')?.value; const details = document.getElementById('task-details')?.value || "No Details"; const timeNeeded = document.getElementById('task-time')?.value || "Not Specified"; const manager = document.getElementById('task-manager')?.value || currentUserDoc.name; const alertMethod = document.getElementById('task-assignee')?.value || "All";
        if(!title) { alert("Title is required!"); return; }
        const newTask = { title: title, details: details, timeNeeded: timeNeeded, manager: manager, targetLab: document.getElementById('task-target-lab')?.value || "Both", assignedTo: alertMethod, status: "Pending", createdBy: auth.currentUser.uid, ownerName: currentUserDoc.name, isPrivate: false, timestamp: serverTimestamp() };
        await addDoc(collection(db, "tasks"), newTask);
        taskModal.style.display = 'none'; if(document.getElementById('task-title')) document.getElementById('task-title').value = ''; if(document.getElementById('task-details')) document.getElementById('task-details').value = ''; showToast("Task Published!", "fa-check"); logToGoogleSheets(newTask, "Created");
        if (alertMethod === "All" || alertMethod === "BothAlerts") pushToNtfy('🚨 NEW LAB TASK', `Task: ${title}\nManager: ${manager}\nTime: ${timeNeeded}`, "5", "");
        if (alertMethod === "WhatsApp" || alertMethod === "BothAlerts") window.open(`https://wa.me/?text=${encodeURIComponent(`🚨 *NEW LAB TASK: ${title}* 🚨\n\n📌 *Details:* ${details}\n⏰ *Time:* ${timeNeeded}\n👨‍💼 *Manager:* ${manager}`)}`, '_blank');
    } catch(err) { console.error("Task Save Error:", err); }
});

// 🛡️ BULLETPROOF PRIVATE TASKS
const privModal = document.getElementById('private-task-modal'); document.getElementById('inline-add-priv-btn').addEventListener('click', () => privModal.style.display = 'flex'); document.getElementById('close-priv-modal-btn').addEventListener('click', () => privModal.style.display = 'none');
document.getElementById('submit-priv-task-btn').addEventListener('click', async () => {
    try {
        const titleEl = document.getElementById('priv-task-title'); const detailsEl = document.getElementById('priv-task-details'); const dateEl = document.getElementById('priv-task-date'); const timeEl = document.getElementById('priv-task-time'); const statusEl = document.getElementById('priv-task-status');
        const title = titleEl?.value; if(!title) { alert("Title is required!"); return; }

        const newTask = {
            title: title, details: detailsEl?.value || "No Details", startDate: dateEl?.value || "No Date", startTime: timeEl?.value || "No Time",
            status: statusEl?.value || "Upcoming", ownerId: auth.currentUser.uid, ownerName: currentUserDoc.name, isPrivate: true, timestamp: serverTimestamp()
        };
        
        await addDoc(collection(db, "tasks"), newTask);
        privModal.style.display = 'none'; if(titleEl) titleEl.value = ''; if(detailsEl) detailsEl.value = ''; if(dateEl) dateEl.value = ''; if(timeEl) timeEl.value = '';
        showToast("Private Task Saved!", "fa-lock"); logToGoogleSheets(newTask, "Created"); 
    } catch(err) { console.error("Private Task Error:", err); alert("Failed to save. Check console."); }
});
