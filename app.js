import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, query, addDoc, updateDoc, serverTimestamp, where } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

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

// === EXTERNAL INTEGRATIONS ===
const GOOGLE_SHEETS_WEBHOOK = "https://script.google.com/macros/s/AKfycbwZofHJ2_XKmrTyw9qFdZmsmYifOdYawaiyed75yZV9JQBjqIRu9Qc8PooetfQSZqU3/exec";
const NTFY_AUTH_TOKEN = "Tk_1r6v82p1z3j5n7acv5jso0ksa35lc";

// === GOOGLE SHEETS SYNC LOGIC ===
async function logToGoogleSheets(taskData) {
    if (!GOOGLE_SHEETS_WEBHOOK) return;
    try {
        await fetch(GOOGLE_SHEETS_WEBHOOK, {
            method: 'POST',
            mode: 'no-cors', 
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                userName: currentUserDoc.name,
                taskName: taskData.title,
                details: taskData.details || "",
                status: taskData.status,
                type: taskData.isPrivate ? "Private Task" : "Lab Task"
            })
        });
        console.log("Logged to Google Sheets successfully");
    } catch (e) { console.error("Sheets log failed:", e); }
}

// === PWA APP INSTALL LOGIC ===
if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{})); }
let deferredPrompt; const installBtn = document.getElementById('install-app-btn');
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; installBtn.style.display = 'inline-flex'; });
installBtn.addEventListener('click', async () => { if (deferredPrompt) { deferredPrompt.prompt(); const { outcome } = await deferredPrompt.userChoice; if (outcome === 'accepted') installBtn.style.display = 'none'; deferredPrompt = null; } });

// === UI & ALARMS ===
const flashOverlay = document.getElementById('flash-overlay');
const alarmAudio = document.getElementById('task-alarm');
const alertBtn = document.getElementById('enable-alerts-btn');
let isRinging = false;

if (Notification.permission === 'granted') alertBtn.classList.add('glow-blue');

function showToast(message, icon = "fa-bell") {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div'); toast.className = 'toast';
    toast.innerHTML = `<i class="fas ${icon}" style="color: #10b981;"></i> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
}

alertBtn.addEventListener('click', async () => {
    try { const perm = await Notification.requestPermission(); if(perm === 'granted') { alertBtn.classList.add('glow-blue'); showToast("Alerts enabled!", "fa-check-circle"); alarmAudio.play().then(()=>alarmAudio.pause()).catch(e=>{}); } } catch(e) {}
});

const screens = { login: document.getElementById('login-screen'), profile: document.getElementById('profile-screen'), dashboard: document.getElementById('dashboard-screen') };
function showScreen(screenName) { Object.values(screens).forEach(s => s.classList.remove('active')); screens[screenName].classList.add('active'); }

const debugLog = document.getElementById('debug-log');
function logToScreen(msg) { if(debugLog) { debugLog.innerHTML += `<div>> ${msg}</div>`; debugLog.scrollTop = debugLog.scrollHeight; } }
console.log = (...args) => { logToScreen(args.join(' ')); };
document.getElementById('debug-btn').addEventListener('click', () => document.getElementById('debug-modal').style.display = 'flex');
document.getElementById('close-debug-btn').addEventListener('click', () => document.getElementById('debug-modal').style.display = 'none');
document.getElementById('clear-debug-btn').addEventListener('click', () => debugLog.innerHTML = '');

// === AUTHENTICATION & PROFILE ===
document.getElementById('login-google-btn').addEventListener('click', () => signInWithPopup(auth, new GoogleAuthProvider()));
window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { 'size': 'normal' });
document.getElementById('send-otp-btn').addEventListener('click', () => { signInWithPhoneNumber(auth, document.getElementById('phone-number').value, window.recaptchaVerifier).then((res) => { window.confirmationResult = res; document.getElementById('otp-section').style.display = 'block'; document.getElementById('send-otp-btn').style.display = 'none'; }); });
document.getElementById('verify-otp-btn').addEventListener('click', () => window.confirmationResult.confirm(document.getElementById('otp-code').value));

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            currentUserDoc = userSnap.data(); setupDashboard(user, currentUserDoc); showScreen('dashboard');
        } else {
            showScreen('profile');
            if (user.email) { document.getElementById('prof-email').style.display = 'none'; document.getElementById('prof-phone').style.display = 'block'; } 
            else { document.getElementById('prof-phone').style.display = 'none'; document.getElementById('prof-email').style.display = 'block'; }
        }
    } else { showScreen('login'); }
});

document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const user = auth.currentUser; const name = document.getElementById('prof-name').value;
    const profileData = { uid: user.uid, name: name, email: document.getElementById('prof-email').value || user.email, phone: document.getElementById('prof-phone').value || user.phoneNumber, lab: document.getElementById('prof-lab').value, status: "Active", photoURL: user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'U')}&background=2563eb&color=fff` };
    await setDoc(doc(db, "users", user.uid), profileData);
    currentUserDoc = profileData; setupDashboard(user, profileData); showScreen('dashboard'); showToast("Profile Saved!", "fa-user-check");
});
document.getElementById('edit-profile-btn').addEventListener('click', () => {
    if (currentUserDoc) { document.getElementById('prof-name').value = currentUserDoc.name || ''; document.getElementById('prof-email').value = currentUserDoc.email || ''; document.getElementById('prof-phone').value = currentUserDoc.phone || ''; document.getElementById('prof-lab').value = currentUserDoc.lab || 'PVL'; document.getElementById('prof-email').style.display = 'block'; document.getElementById('prof-phone').style.display = 'block'; showScreen('profile'); }
});

// === 1-ON-1 CHAT ===
let currentChatUserId = null; let chatUnsubscribe = null;
function getChatId(uid1, uid2) { return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`; }
const chatPanel = document.getElementById('chat-panel'); const contactListArea = document.getElementById('chat-contact-list'); const conversationArea = document.getElementById('chat-conversation-area'); const chatTitle = document.getElementById('chat-panel-title'); const backBtn = document.getElementById('chat-back-btn');
document.getElementById('fab-chat').addEventListener('click', () => { chatPanel.classList.remove('hidden'); showContactList(); });
document.getElementById('close-chat-btn').addEventListener('click', () => chatPanel.classList.add('hidden'));
backBtn.addEventListener('click', () => showContactList());

function showContactList() { currentChatUserId = null; if(chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; } backBtn.classList.add('hidden'); chatTitle.innerHTML = `<i class="fas fa-address-book"></i> Contacts`; conversationArea.classList.add('hidden'); contactListArea.classList.remove('hidden'); }

function openDirectChat(targetUser) { 
    currentChatUserId = targetUser.uid; backBtn.classList.remove('hidden'); chatTitle.textContent = targetUser.name; contactListArea.classList.add('hidden'); conversationArea.classList.remove('hidden'); const chatId = getChatId(auth.currentUser.uid, targetUser.uid); const chatMessages = document.getElementById('chat-messages'); if(chatUnsubscribe) chatUnsubscribe(); 
    chatUnsubscribe = onSnapshot(query(collection(db, "direct_messages"), where("chatId", "==", chatId)), (snapshot) => { 
        const msgs = []; snapshot.forEach(doc => msgs.push(doc.data())); 
        msgs.sort((a, b) => { const timeA = a.timestamp ? a.timestamp.toMillis() : Date.now(); const timeB = b.timestamp ? b.timestamp.toMillis() : Date.now(); return timeA - timeB; }); 
        chatMessages.innerHTML = ''; 
        msgs.forEach(msg => { const isMine = msg.senderId === auth.currentUser.uid; const timeString = msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Sending...'; chatMessages.innerHTML += `<div class="chat-msg ${isMine ? 'msg-mine' : 'msg-theirs'}">${msg.text}<span class="time">${timeString}</span></div>`; }); 
        chatMessages.scrollTop = chatMessages.scrollHeight; 
    });
}

async function sendChatMessage() { const input = document.getElementById('chat-input'); const text = input.value; if(!text || !currentChatUserId) return; input.value = ''; await addDoc(collection(db, "direct_messages"), { chatId: getChatId(auth.currentUser.uid, currentChatUserId), text: text, senderId: auth.currentUser.uid, timestamp: serverTimestamp() }); }
document.getElementById('send-chat-btn').addEventListener('click', sendChatMessage); document.getElementById('chat-input').addEventListener('keypress', (e) => { if(e.key === 'Enter') sendChatMessage(); });

// === DASHBOARD, LAB TASKS, & PRIVATE TASKS ===
function setupDashboard(user, profile) {
    document.getElementById('display-name').textContent = profile.name;
    document.getElementById('display-pic').src = profile.photoURL;
    document.getElementById('user-status').value = profile.status || "Active";
    document.getElementById('user-status').addEventListener('change', async (e) => await updateDoc(doc(db, "users", user.uid), { status: e.target.value }));

    // Load Chat Directory
    onSnapshot(collection(db, "users"), (snapshot) => {
        contactListArea.innerHTML = ''; 
        snapshot.forEach(userDoc => { const u = userDoc.data(); if(u.uid !== user.uid) { const contactEl = document.createElement('div'); contactEl.className = 'contact-item'; contactEl.innerHTML = `<img src="${u.photoURL}" onerror="this.src='https://ui-avatars.com/api/?name=${u.name[0]}&background=2563eb&color=fff'"><div><span class="name">${u.name}</span><span class="lab">${u.lab} Lab - ${u.status === 'Active' ? '🟢' : '🔴'}</span></div>`; contactEl.onclick = () => openDirectChat(u); contactListArea.appendChild(contactEl); } });
    });

    // Load Tasks (Lab AND Private)
    onSnapshot(collection(db, "tasks"), (snapshot) => {
        const openList = document.getElementById('open-tasks-list'); const myList = document.getElementById('my-tasks-list'); const privList = document.getElementById('private-tasks-list');
        openList.innerHTML = ''; myList.innerHTML = ''; privList.innerHTML = '';

        let unassignedCount = 0; let myAcceptedCount = 0; let myPrivCount = 0;
        let statCreated = 0; let statHelped = 0; let statAccepted = 0;

        snapshot.forEach(taskDoc => {
            const task = taskDoc.data(); const taskId = taskDoc.id;

            // Handle Private Tasks First
            if(task.isPrivate) {
                if(task.ownerId === user.uid) {
                    myPrivCount++;
                    const pEl = document.createElement('div'); pEl.className = 'task-item';
                    pEl.innerHTML = `<h4>${task.title} <span class="priv-badge">${task.status}</span></h4>
                                     <p>${task.details}</p>
                                     <p><i class="far fa-calendar"></i> ${task.startDate} | <i class="far fa-clock"></i> ${task.startTime}</p>`;
                    
                    if(task.status !== "Done") {
                        const nextStatusBtn = document.createElement('button'); nextStatusBtn.className = 'priv-btn';
                        nextStatusBtn.textContent = task.status === "Upcoming" ? "Start (Mark Ongoing)" : "Finish (Mark Done)";
                        nextStatusBtn.onclick = async () => {
                            const newStatus = task.status === "Upcoming" ? "Ongoing" : "Done";
                            await updateDoc(taskDoc.ref, { status: newStatus });
                            logToGoogleSheets({ ...task, status: newStatus }); 
                        };
                        pEl.appendChild(nextStatusBtn);
                    }
                    privList.appendChild(pEl);
                }
                return; // Skip the rest of the lab logic for private tasks
            }

            // Standard Lab Task Logic
            if(task.createdBy === user.uid) { statCreated++; if(task.status !== "Pending") statHelped++; }
            if(task.acceptedById === user.uid) statAccepted++;

            const prevTask = previousTasksState.get(taskId);
            if (prevTask && prevTask.status === "Pending" && task.status === "Accepted" && task.createdBy === user.uid) {
                showToast(`${task.acceptedBy} accepted your task!`, 'fa-user-check');
            }
            previousTasksState.set(taskId, task);

            if ((task.targetLab !== "Both") && (profile.lab !== "Both") && (task.targetLab !== profile.lab)) return;

            const taskEl = document.createElement('div'); taskEl.className = 'task-item';
            taskEl.innerHTML = `<h4>${task.title}</h4><p><i class="fas fa-info-circle"></i> ${task.details}</p><p><i class="far fa-clock"></i> Time: ${task.timeNeeded} | Mgr: ${task.manager}</p>`;

            if (task.status === "Pending" && (task.assignedTo === "All" || task.assignedTo === "WhatsApp" || task.assignedTo === "BothAlerts" || task.assignedTo === user.uid)) {
                if (task.assignedTo === "All" || task.assignedTo === "BothAlerts") unassignedCount++;
                const acceptBtn = document.createElement('button'); acceptBtn.className = 'task-btn'; acceptBtn.style.background = 'rgba(245, 158, 11, 0.2)'; acceptBtn.style.color = '#fbbf24'; acceptBtn.innerHTML = '<i class="fas fa-hand-paper"></i> Accept Task';
                acceptBtn.onclick = async () => {
                    const time = prompt("Expected completion time?");
                    if(time) {
                        await updateDoc(taskDoc.ref, { status: "Accepted", acceptedBy: profile.name, acceptedById: user.uid, expectedTime: time });
                        logToGoogleSheets({ ...task, status: "Accepted" }); 
                    }
                };
                taskEl.appendChild(acceptBtn); openList.appendChild(taskEl);
            } else if (task.acceptedById === user.uid) {
                if (task.status !== "Done") {
                    const doneBtn = document.createElement('button'); doneBtn.className = 'task-btn done'; doneBtn.innerHTML = '<i class="fas fa-check"></i> Mark as Done';
                    doneBtn.onclick = async () => {
                        await updateDoc(taskDoc.ref, { status: "Done" });
                        logToGoogleSheets({ ...task, status: "Done" }); 
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

// === LAB TASK CREATION & SECURE NTFY PUSH ===
const taskModal = document.getElementById('task-modal');
document.getElementById('fab-add-task').addEventListener('click', () => taskModal.style.display = 'flex');
document.getElementById('close-modal-btn').addEventListener('click', () => taskModal.style.display = 'none');

document.getElementById('submit-task-btn').addEventListener('click', async () => {
    const title = document.getElementById('task-title').value; const details = document.getElementById('task-details').value;
    const timeNeeded = document.getElementById('task-time').value; const manager = document.getElementById('task-manager').value;
    const alertMethod = document.getElementById('task-assignee').value;
    if(!title) { alert("Title is required!"); return; }
    
    const newTask = { title: title, details: details, timeNeeded: timeNeeded, manager: manager, targetLab: document.getElementById('task-target-lab').value, assignedTo: alertMethod, status: "Pending", createdBy: auth.currentUser.uid, isPrivate: false, timestamp: serverTimestamp() };
    await addDoc(collection(db, "tasks"), newTask);
    taskModal.style.display = 'none'; document.getElementById('task-title').value = ''; document.getElementById('task-details').value = '';
    showToast("Task Published!", "fa-check");

    logToGoogleSheets(newTask); 

    if (alertMethod === "All" || alertMethod === "BothAlerts") {
        fetch('https://ntfy.sh/rishav_lab_alerts_2026', {
            method: 'POST', 
            body: title, 
            headers: { 
                'Title': '🚨 NEW LAB TASK', 
                'Priority': '5', 
                'Tags': 'warning',
                'Authorization': `Bearer ${NTFY_AUTH_TOKEN}`
            }
        }).catch(err => console.log("Ntfy error:", err));
    }

    if (alertMethod === "WhatsApp" || alertMethod === "BothAlerts") {
        window.open(`https://wa.me/?text=${encodeURIComponent(`🚨 *NEW LAB TASK: ${title}* 🚨\n\n📌 *Details:* ${details}\n⏰ *Time:* ${timeNeeded}\n👨‍💼 *Manager:* ${manager}`)}`, '_blank');
    }
});

// === PRIVATE TASK CREATION ===
const privModal = document.getElementById('private-task-modal');
document.getElementById('inline-add-priv-btn').addEventListener('click', () => privModal.style.display = 'flex');
document.getElementById('close-priv-modal-btn').addEventListener('click', () => privModal.style.display = 'none');

document.getElementById('submit-priv-task-btn').addEventListener('click', async () => {
    const title = document.getElementById('priv-task-title').value;
    if(!title) { alert("Title is required!"); return; }

    const newTask = {
        title: title, details: document.getElementById('priv-task-details').value,
        startDate: document.getElementById('priv-task-date').value, startTime: document.getElementById('priv-task-time').value,
        status: document.getElementById('priv-task-status').value, ownerId: auth.currentUser.uid, isPrivate: true, timestamp: serverTimestamp()
    };
    
    await addDoc(collection(db, "tasks"), newTask);
    privModal.style.display = 'none'; document.getElementById('priv-task-title').value = ''; document.getElementById('priv-task-details').value = '';
    showToast("Private Task Saved!", "fa-lock");

    logToGoogleSheets(newTask); 
});
