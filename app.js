import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, query, addDoc, updateDoc, serverTimestamp, orderBy, where } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

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

// PWA Install
if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{})); }
let deferredPrompt; const installBtn = document.getElementById('install-app-btn');
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; installBtn.style.display = 'inline-flex'; });
installBtn.addEventListener('click', async () => { if (deferredPrompt) { deferredPrompt.prompt(); const { outcome } = await deferredPrompt.userChoice; if (outcome === 'accepted') installBtn.style.display = 'none'; deferredPrompt = null; } });

// === UI & ALARMS (Now with Blue Glow) ===
const flashOverlay = document.getElementById('flash-overlay');
const alarmAudio = document.getElementById('task-alarm');
const alertBtn = document.getElementById('enable-alerts-btn');
let isRinging = false;

// Check if already granted on load, apply glow
if (Notification.permission === 'granted') {
    alertBtn.classList.add('glow-blue');
}

function showToast(message, icon = "fa-bell") {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div'); toast.className = 'toast';
    toast.innerHTML = `<i class="fas ${icon}" style="color: #10b981;"></i> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
}

alertBtn.addEventListener('click', async () => {
    if(Notification.permission === 'granted') {
        showToast("Alerts already active!", "fa-check-circle");
        return;
    }
    try { 
        const perm = await Notification.requestPermission();
        if(perm === 'granted') {
            alertBtn.classList.add('glow-blue');
            showToast("Alerts enabled!", "fa-check-circle"); 
            alarmAudio.play().then(() => { alarmAudio.pause(); alarmAudio.currentTime = 0; }).catch(e=>{}); 
        }
    } catch(e) { }
});

const screens = { login: document.getElementById('login-screen'), profile: document.getElementById('profile-screen'), dashboard: document.getElementById('dashboard-screen') };
function showScreen(screenName) { Object.values(screens).forEach(s => s.classList.remove('active')); screens[screenName].classList.add('active'); }

// Debugger
const debugLog = document.getElementById('debug-log');
function logToScreen(msg) { if(debugLog) { debugLog.innerHTML += `<div>> ${msg}</div>`; debugLog.scrollTop = debugLog.scrollHeight; } }
console.log = (...args) => { logToScreen(args.join(' ')); };
document.getElementById('debug-btn').addEventListener('click', () => document.getElementById('debug-modal').style.display = 'flex');
document.getElementById('close-debug-btn').addEventListener('click', () => document.getElementById('debug-modal').style.display = 'none');
document.getElementById('clear-debug-btn').addEventListener('click', () => debugLog.innerHTML = '');

// === AUTHENTICATION ===
document.getElementById('login-google-btn').addEventListener('click', () => signInWithPopup(auth, new GoogleAuthProvider()));
window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { 'size': 'normal' });
document.getElementById('send-otp-btn').addEventListener('click', () => {
    signInWithPhoneNumber(auth, document.getElementById('phone-number').value, window.recaptchaVerifier).then((res) => { window.confirmationResult = res; document.getElementById('otp-section').style.display = 'block'; document.getElementById('send-otp-btn').style.display = 'none'; });
});
document.getElementById('verify-otp-btn').addEventListener('click', () => window.confirmationResult.confirm(document.getElementById('otp-code').value));

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            currentUserDoc = userSnap.data();
            setupDashboard(user, currentUserDoc);
            showScreen('dashboard');
        } else {
            showScreen('profile');
            if (user.email) { document.getElementById('prof-email').style.display = 'none'; document.getElementById('prof-phone').style.display = 'block'; } 
            else { document.getElementById('prof-phone').style.display = 'none'; document.getElementById('prof-email').style.display = 'block'; }
        }
    } else { showScreen('login'); }
});

// === PROFILE SAVE & EDIT ===
document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const user = auth.currentUser; const name = document.getElementById('prof-name').value;
    const profileData = {
        uid: user.uid, name: name, 
        email: document.getElementById('prof-email').value || user.email,
        phone: document.getElementById('prof-phone').value || user.phoneNumber, 
        lab: document.getElementById('prof-lab').value, status: "Active", 
        photoURL: user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'U')}&background=2563eb&color=fff`
    };
    await setDoc(doc(db, "users", user.uid), profileData);
    currentUserDoc = profileData; setupDashboard(user, profileData); showScreen('dashboard');
    showToast("Profile Updated!", "fa-user-check");
});

document.getElementById('edit-profile-btn').addEventListener('click', () => {
    if (currentUserDoc) {
        document.getElementById('prof-name').value = currentUserDoc.name || '';
        document.getElementById('prof-email').value = currentUserDoc.email || '';
        document.getElementById('prof-phone').value = currentUserDoc.phone || '';
        document.getElementById('prof-lab').value = currentUserDoc.lab || 'PVL';
        
        // Ensure both inputs are visible so user can fill them manually
        document.getElementById('prof-email').style.display = 'block';
        document.getElementById('prof-phone').style.display = 'block';
        showScreen('profile');
    }
});

// === 1-ON-1 DIRECT MESSAGING ===
let currentChatUserId = null; let chatUnsubscribe = null;
function getChatId(uid1, uid2) { return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`; }

const chatPanel = document.getElementById('chat-panel');
const contactListArea = document.getElementById('chat-contact-list');
const conversationArea = document.getElementById('chat-conversation-area');
const chatTitle = document.getElementById('chat-panel-title');
const backBtn = document.getElementById('chat-back-btn');

document.getElementById('fab-chat').addEventListener('click', () => { chatPanel.classList.remove('hidden'); showContactList(); });
document.getElementById('close-chat-btn').addEventListener('click', () => chatPanel.classList.add('hidden'));
backBtn.addEventListener('click', () => showContactList());

function showContactList() {
    currentChatUserId = null; if(chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
    backBtn.classList.add('hidden'); chatTitle.innerHTML = `<i class="fas fa-address-book"></i> Contacts`;
    conversationArea.classList.add('hidden'); contactListArea.classList.remove('hidden');
}

function openDirectChat(targetUser) {
    currentChatUserId = targetUser.uid; backBtn.classList.remove('hidden');
    chatTitle.textContent = targetUser.name; contactListArea.classList.add('hidden'); conversationArea.classList.remove('hidden');

    const chatId = getChatId(auth.currentUser.uid, targetUser.uid);
    const chatMessages = document.getElementById('chat-messages');

    if(chatUnsubscribe) chatUnsubscribe(); 
    const q = query(collection(db, "direct_messages"), where("chatId", "==", chatId), orderBy("timestamp", "asc"));
    chatUnsubscribe = onSnapshot(q, (snapshot) => {
        chatMessages.innerHTML = '';
        snapshot.forEach(doc => {
            const msg = doc.data(); const isMine = msg.senderId === auth.currentUser.uid;
            const timeString = msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Now';
            chatMessages.innerHTML += `<div class="chat-msg ${isMine ? 'msg-mine' : 'msg-theirs'}">${msg.text}<span class="time">${timeString}</span></div>`;
        });
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
}

document.getElementById('send-chat-btn').addEventListener('click', async () => {
    const input = document.getElementById('chat-input');
    if(!input.value || !currentChatUserId) return;
    await addDoc(collection(db, "direct_messages"), {
        chatId: getChatId(auth.currentUser.uid, currentChatUserId),
        text: input.value, senderId: auth.currentUser.uid, timestamp: serverTimestamp()
    });
    input.value = '';
});

// === DASHBOARD & TASKS ===
function setupDashboard(user, profile) {
    document.getElementById('display-name').textContent = profile.name;
    document.getElementById('display-email').textContent = profile.email || profile.phone;
    document.getElementById('display-lab').textContent = profile.lab;
    document.getElementById('display-pic').src = profile.photoURL;

    document.getElementById('user-status').value = profile.status || "Active";
    document.getElementById('user-status').addEventListener('change', async (e) => await updateDoc(doc(db, "users", user.uid), { status: e.target.value }));

    // Listen to Users (For Directory)
    onSnapshot(collection(db, "users"), (snapshot) => {
        contactListArea.innerHTML = ''; 
        snapshot.forEach(userDoc => {
            const u = userDoc.data();
            if(u.uid !== user.uid) {
                const contactEl = document.createElement('div'); contactEl.className = 'contact-item';
                contactEl.innerHTML = `<img src="${u.photoURL}" onerror="this.src='https://ui-avatars.com/api/?name=${u.name[0]}&background=2563eb&color=fff'"><div><span class="name">${u.name}</span><span class="lab">${u.lab} Lab - ${u.status === 'Active' ? '🟢' : '🔴'}</span></div>`;
                contactEl.onclick = () => openDirectChat(u);
                contactListArea.appendChild(contactEl);
            }
        });
    });

    onSnapshot(collection(db, "tasks"), (snapshot) => {
        const openList = document.getElementById('open-tasks-list'); const myList = document.getElementById('my-tasks-list');
        openList.innerHTML = ''; myList.innerHTML = '';

        let unassignedTaskCount = 0; let myAcceptedCount = 0;
        let statCreated = 0; let statHelpedByOthers = 0; let statMyAccepted = 0;

        snapshot.forEach(taskDoc => {
            const task = taskDoc.data(); const taskId = taskDoc.id;

            if(task.createdBy === user.uid) { statCreated++; if(task.status !== "Pending") statHelpedByOthers++; }
            if(task.acceptedById === user.uid) statMyAccepted++;

            const prevTask = previousTasksState.get(taskId);
            if (prevTask && prevTask.status === "Pending" && task.status === "Accepted" && task.createdBy === user.uid) {
                showToast(`${task.acceptedBy} accepted your task!`, 'fa-user-check');
            }
            previousTasksState.set(taskId, task);

            if ((task.targetLab !== "Both") && (profile.lab !== "Both") && (task.targetLab !== profile.lab)) return;

            const taskEl = document.createElement('div'); taskEl.className = 'task-item';
            taskEl.innerHTML = `<h4>${task.title}</h4><p><i class="fas fa-info-circle"></i> ${task.details}</p><p><i class="far fa-clock"></i> Time: ${task.timeNeeded} | Mgr: ${task.manager}</p>`;

            // App Flash activates for "All" or "BothAlerts"
            if (task.status === "Pending" && (task.assignedTo === "All" || task.assignedTo === "WhatsApp" || task.assignedTo === "BothAlerts" || task.assignedTo === user.uid)) {
                
                // Only count towards ringing if it's meant to flash the app (All or BothAlerts)
                if (task.assignedTo === "All" || task.assignedTo === "BothAlerts") {
                    unassignedTaskCount++;
                }

                const acceptBtn = document.createElement('button');
                acceptBtn.className = 'task-btn'; acceptBtn.style.background = 'rgba(245, 158, 11, 0.2)'; acceptBtn.style.color = '#fbbf24';
                acceptBtn.innerHTML = '<i class="fas fa-hand-paper"></i> Accept Task';
                acceptBtn.onclick = async () => {
                    const time = prompt("Expected completion time?");
                    if(time) await updateDoc(taskDoc.ref, { status: "Accepted", acceptedBy: profile.name, acceptedById: user.uid, expectedTime: time });
                };
                taskEl.appendChild(acceptBtn); openList.appendChild(taskEl);
            } else if (task.acceptedById === user.uid) {
                if (task.status !== "Done") {
                    const doneBtn = document.createElement('button');
                    doneBtn.className = 'task-btn done'; doneBtn.innerHTML = '<i class="fas fa-check"></i> Mark as Done';
                    doneBtn.onclick = async () => await updateDoc(taskDoc.ref, { status: "Done" });
                    taskEl.appendChild(doneBtn);
                }
                myList.appendChild(taskEl); myAcceptedCount++;
            }
        });

        document.getElementById('stat-assigned').textContent = statCreated;
        document.getElementById('stat-helped').textContent = statHelpedByOthers;
        document.getElementById('stat-accepted').textContent = statMyAccepted;

        if (unassignedTaskCount > 0 && profile.status === "Active") {
            if(!isRinging) { flashOverlay.style.display = 'block'; try { alarmAudio.play(); }catch(e){} isRinging = true; }
        } else {
            flashOverlay.style.display = 'none'; alarmAudio.pause(); alarmAudio.currentTime = 0; isRinging = false;
        }

        if (openList.innerHTML === '') openList.innerHTML = '<p class="text-muted">No pending tasks right now.</p>';
        if (myAcceptedCount === 0) myList.innerHTML = '<p class="text-muted">You have no accepted tasks.</p>';
    });
}

// === TASK CREATION (With Combined BothAlerts Option) ===
const taskModal = document.getElementById('task-modal');
document.getElementById('fab-add-task').addEventListener('click', () => taskModal.style.display = 'flex');
document.getElementById('close-modal-btn').addEventListener('click', () => taskModal.style.display = 'none');

document.getElementById('submit-task-btn').addEventListener('click', async () => {
    const title = document.getElementById('task-title').value; const details = document.getElementById('task-details').value;
    const timeNeeded = document.getElementById('task-time').value; const manager = document.getElementById('task-manager').value;
    const alertMethod = document.getElementById('task-assignee').value;

    if(!title) { alert("Title is required!"); return; }
    
    await addDoc(collection(db, "tasks"), {
        title: title, details: details, timeNeeded: timeNeeded, manager: manager,
        targetLab: document.getElementById('task-target-lab').value, assignedTo: alertMethod,
        status: "Pending", createdBy: auth.currentUser.uid, timestamp: serverTimestamp()
    });
    
    taskModal.style.display = 'none';
    document.getElementById('task-title').value = ''; document.getElementById('task-details').value = '';
    showToast("Task Published!", "fa-check");

    // WHATSAPP TRIGGER (Runs if WhatsApp Only OR BothAlerts is selected)
    if (alertMethod === "WhatsApp" || alertMethod === "BothAlerts") {
        const waText = `🚨 *NEW LAB TASK: ${title}* 🚨\n\n📌 *Details:* ${details}\n⏰ *Time:* ${timeNeeded}\n👨‍💼 *Manager:* ${manager}\n\n👉 Open the LabManager App to accept!`;
        window.open(`https://wa.me/?text=${encodeURIComponent(waText)}`, '_blank');
    }
});
