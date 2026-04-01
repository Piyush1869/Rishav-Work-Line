import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, query, addDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-messaging.js";

// === DEBUGGER ===
const debugLog = document.getElementById('debug-log');
const debugModal = document.getElementById('debug-modal');
function logToScreen(msg, isErr=false) { if(debugLog) { debugLog.innerHTML += `<div class="${isErr?'debug-error':''}">> ${msg}</div>`; debugLog.scrollTop = debugLog.scrollHeight; } }
const origLog = console.log; const origErr = console.error;
console.log = (...args) => { origLog(...args); logToScreen(args.join(' ')); };
console.error = (...args) => { origErr(...args); logToScreen(args.join(' '), true); };
document.getElementById('debug-btn').addEventListener('click', () => debugModal.style.display = 'flex');
document.getElementById('close-debug-btn').addEventListener('click', () => debugModal.style.display = 'none');
document.getElementById('clear-debug-btn').addEventListener('click', () => debugLog.innerHTML = '');

// === FIREBASE INIT ===
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
const messaging = getMessaging(app);

let currentUserDoc = null;
let activeNotifications = [];

// === RAPIDO ALARM SYSTEM ===
const alarmAudio = document.getElementById('task-alarm');
let isRinging = false;

function playAlarm() {
    if(!isRinging) {
        alarmAudio.play().catch(e => console.log("Audio autoplay blocked. User must tap the screen first."));
        isRinging = true;
    }
}
function stopAlarm() {
    alarmAudio.pause();
    alarmAudio.currentTime = 0;
    isRinging = false;
    // Close all open desktop notifications
    activeNotifications.forEach(n => n.close());
    activeNotifications = [];
}

// Request Notification Permission
async function requestNotificationPermission(user) {
    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            console.log('Notification permission granted.');
            // Register service worker manually for Vercel
            const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
            
            // Note: Generating FCM Token requires VAPID key from Firebase Console.
            // Leaving this ready for when you generate the key:
            // const token = await getToken(messaging, { vapidKey: 'YOUR_VAPID_KEY_HERE', serviceWorkerRegistration: registration });
            // await updateDoc(doc(db, "users", user.uid), { fcmToken: token });
        } else {
            console.log('Unable to get permission to notify.');
        }
    } catch (error) { console.error('Error requesting permission', error); }
}

// === ROUTING & AUTH ===
const screens = { login: document.getElementById('login-screen'), profile: document.getElementById('profile-screen'), dashboard: document.getElementById('dashboard-screen') };
function showScreen(screenName) { Object.values(screens).forEach(s => s.classList.remove('active')); screens[screenName].classList.add('active'); }

document.getElementById('login-google-btn').addEventListener('click', () => signInWithPopup(auth, new GoogleAuthProvider()));

onAuthStateChanged(auth, async (user) => {
    if (user) {
        requestNotificationPermission(user); // Ask for push permission on login
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

// === SAVE PROFILE ===
document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const user = auth.currentUser;
    const name = document.getElementById('prof-name').value;
    const email = user.email || document.getElementById('prof-email').value;
    const photoURL = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=2563eb&color=fff`; 
    
    const profileData = {
        uid: user.uid, name: name, email: email,
        phone: user.phoneNumber || document.getElementById('prof-phone').value,
        lab: document.getElementById('prof-lab').value, status: "Active", photoURL: photoURL
    };
    
    await setDoc(doc(db, "users", user.uid), profileData);
    currentUserDoc = profileData;
    setupDashboard(user, profileData);
    showScreen('dashboard');
});

// === DASHBOARD & RAPIDO LIVE SYNC ===
function setupDashboard(user, profile) {
    document.getElementById('display-name').textContent = profile.name;
    document.getElementById('display-email').textContent = profile.email;
    document.getElementById('display-lab').textContent = profile.lab;
    document.getElementById('display-pic').src = profile.photoURL;

    document.getElementById('user-status').value = profile.status || "Active";
    document.getElementById('user-status').addEventListener('change', async (e) => await updateDoc(doc(db, "users", user.uid), { status: e.target.value }));

    // Populate Users Dropdown
    onSnapshot(collection(db, "users"), (snapshot) => {
        const assigneeSelect = document.getElementById('task-assignee');
        assigneeSelect.innerHTML = '<option value="All">Broadcast to All (Rings all phones)</option>';
        snapshot.forEach(doc => {
            const u = doc.data();
            if(u.uid !== user.uid) assigneeSelect.innerHTML += `<option value="${u.uid}">${u.name} (${u.lab})</option>`;
        });
    });

    // LISTEN TO TASKS
    onSnapshot(collection(db, "tasks"), (snapshot) => {
        const openList = document.getElementById('open-tasks-list');
        const myList = document.getElementById('my-tasks-list');
        openList.innerHTML = ''; myList.innerHTML = '';

        let unassignedTaskCount = 0;
        let myCount = 0;

        snapshot.forEach(taskDoc => {
            const task = taskDoc.data();
            if ((task.targetLab !== "Both") && (profile.lab !== "Both") && (task.targetLab !== profile.lab)) return;

            const taskEl = document.createElement('div');
            taskEl.className = 'task-item';
            taskEl.innerHTML = `
                <h4>${task.title}</h4>
                <p><i class="fas fa-info-circle"></i> ${task.details}</p>
                <p><i class="far fa-clock"></i> Time: ${task.timeNeeded} | Mgr: ${task.manager}</p>
            `;

            // PENDING TASKS (Triggers Alarm)
            if (task.status === "Pending" && (task.assignedTo === "All" || task.assignedTo === user.uid)) {
                unassignedTaskCount++;
                
                // Show browser notification if permitted
                if(Notification.permission === 'granted' && !isRinging) {
                    const n = new Notification("NEW LAB TASK: " + task.title, {
                        body: `Manager: ${task.manager} | Location: ${task.details}`,
                        icon: profile.photoURL,
                        requireInteraction: true // Stays on screen until clicked/dismissed
                    });
                    activeNotifications.push(n);
                }

                const acceptBtn = document.createElement('button');
                acceptBtn.className = 'task-btn';
                acceptBtn.style.background = '#f59e0b'; acceptBtn.style.color = 'white';
                acceptBtn.innerHTML = '<i class="fas fa-hand-paper"></i> Accept Task';
                acceptBtn.onclick = async () => {
                    const time = prompt("Expected completion time?");
                    if(time) await updateDoc(taskDoc.ref, { status: "Accepted", acceptedBy: profile.name, acceptedById: user.uid, expectedTime: time });
                };
                taskEl.appendChild(acceptBtn);
                openList.appendChild(taskEl);
            } 
            // ACCEPTED TASKS
            else if (task.acceptedById === user.uid) {
                if (task.status !== "Done") {
                    const doneBtn = document.createElement('button');
                    doneBtn.className = 'task-btn done';
                    doneBtn.innerHTML = '<i class="fas fa-check"></i> Mark as Done';
                    doneBtn.onclick = async () => await updateDoc(taskDoc.ref, { status: "Done" });
                    taskEl.appendChild(doneBtn);
                }
                myList.appendChild(taskEl);
                myCount++;
            }
        });

        // RAPIDO EFFECT LOGIC: Ring if unassigned tasks exist, stop if someone accepts
        if (unassignedTaskCount > 0 && profile.status === "Active") {
            playAlarm();
        } else {
            stopAlarm(); // Automatically stops alarm when task goes from Pending -> Accepted
        }

        if (unassignedTaskCount === 0) openList.innerHTML = '<p class="text-muted">No pending tasks right now.</p>';
        if (myCount === 0) myList.innerHTML = '<p class="text-muted">You have no accepted tasks.</p>';
    });
}

// === MODAL LOGIC ===
const taskModal = document.getElementById('task-modal');
document.getElementById('fab-add-task').addEventListener('click', () => taskModal.style.display = 'flex');
document.getElementById('close-modal-btn').addEventListener('click', () => taskModal.style.display = 'none');

document.getElementById('submit-task-btn').addEventListener('click', async () => {
    const title = document.getElementById('task-title').value;
    if(!title) { alert("Title is required!"); return; }
    
    await addDoc(collection(db, "tasks"), {
        title: title,
        details: document.getElementById('task-details').value,
        timeNeeded: document.getElementById('task-time').value,
        manager: document.getElementById('task-manager').value,
        targetLab: document.getElementById('task-target-lab').value,
        assignedTo: document.getElementById('task-assignee').value,
        status: "Pending", createdBy: auth.currentUser.uid, timestamp: new Date()
    });
    
    taskModal.style.display = 'none';
    document.getElementById('task-title').value = ''; document.getElementById('task-details').value = '';
});