import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, query, where, addDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

// === ON-SCREEN DEBUGGER ===
const debugLog = document.getElementById('debug-log');
function logToScreen(msg, isError = false) {
    if(debugLog) {
        debugLog.innerHTML += `<div class="${isError ? 'debug-error' : ''}">> ${msg}</div>`;
        debugLog.scrollTop = debugLog.scrollHeight;
    }
}
const origLog = console.log; const origErr = console.error;
console.log = (...args) => { origLog(...args); logToScreen(args.join(' ')); };
console.error = (...args) => { origErr(...args); logToScreen(args.join(' '), true); };

document.getElementById('toggle-debug').addEventListener('click', () => {
    document.getElementById('debug-panel').classList.toggle('hidden');
});

console.log("App initializing...");

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
let currentUserDoc = null;

// === PWA APP INSTALL ===
let deferredPrompt;
const installBtn = document.getElementById('install-app-btn');
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.style.display = 'block';
});
installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') installBtn.style.display = 'none';
        deferredPrompt = null;
    }
});

// === UI ROUTING ===
const screens = { login: document.getElementById('login-screen'), profile: document.getElementById('profile-screen'), dashboard: document.getElementById('dashboard-screen') };
function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
}

// === AUTHENTICATION ===
document.getElementById('login-google-btn').addEventListener('click', () => {
    signInWithPopup(auth, new GoogleAuthProvider()).catch(err => console.error("Google Auth Error:", err.message));
});

window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { 'size': 'normal' });

document.getElementById('send-otp-btn').addEventListener('click', () => {
    const phone = document.getElementById('phone-number').value;
    signInWithPhoneNumber(auth, phone, window.recaptchaVerifier)
        .then((result) => {
            window.confirmationResult = result;
            document.getElementById('otp-section').style.display = 'block';
            document.getElementById('send-otp-btn').style.display = 'none';
            console.log("OTP Sent");
        }).catch(err => console.error("SMS Error:", err.message));
});

document.getElementById('verify-otp-btn').addEventListener('click', () => {
    const code = document.getElementById('otp-code').value;
    window.confirmationResult.confirm(code).catch(err => console.error("OTP Error:", err.message));
});

// === AUTH STATE ===
onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log("User logged in UID:", user.uid);
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            currentUserDoc = userSnap.data();
            setupDashboard(user, currentUserDoc);
            showScreen('dashboard');
        } else {
            showScreen('profile');
            const emailInput = document.getElementById('prof-email');
            const phoneInput = document.getElementById('prof-phone');
            if (user.email) { emailInput.style.display = 'none'; phoneInput.style.display = 'block'; } 
            else { phoneInput.style.display = 'none'; emailInput.style.display = 'block'; }
        }
    } else {
        showScreen('login');
    }
});

// === SAVE PROFILE ===
document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const user = auth.currentUser;
    const photoURL = user.photoURL || 'https://via.placeholder.com/50'; 
    
    const profileData = {
        uid: user.uid,
        name: document.getElementById('prof-name').value,
        email: user.email || document.getElementById('prof-email').value,
        phone: user.phoneNumber || document.getElementById('prof-phone').value,
        lab: document.getElementById('prof-lab').value,
        status: "Active",
        photoURL: photoURL
    };
    
    try {
        await setDoc(doc(db, "users", user.uid), profileData);
        console.log("Profile Saved");
        currentUserDoc = profileData;
        setupDashboard(user, profileData);
        showScreen('dashboard');
    } catch (e) {
        console.error("Error saving profile: ", e.message);
    }
});

// === DASHBOARD & LIVE TASKS ===
function setupDashboard(user, profile) {
    document.getElementById('display-name').textContent = profile.name;
    document.getElementById('display-lab').textContent = profile.lab;
    if(profile.photoURL) document.getElementById('display-pic').src = profile.photoURL;

    // Listen to User Status Change
    const statusSelect = document.getElementById('user-status');
    statusSelect.value = profile.status || "Active";
    statusSelect.addEventListener('change', async (e) => {
        await updateDoc(doc(db, "users", user.uid), { status: e.target.value });
        console.log("Status updated to:", e.target.value);
    });

    // Populate Users for Assignment
    onSnapshot(collection(db, "users"), (snapshot) => {
        const assigneeSelect = document.getElementById('task-assignee');
        assigneeSelect.innerHTML = '<option value="All">Broadcast to All</option>';
        snapshot.forEach(doc => {
            const u = doc.data();
            if(u.uid !== user.uid) assigneeSelect.innerHTML += `<option value="${u.uid}">${u.name} (${u.lab})</option>`;
        });
    });

    // LISTEN TO TASKS (Real-time Full Functionality)
    const q = query(collection(db, "tasks"), where("targetLab", "in", [profile.lab, "Both"]));
    onSnapshot(q, (snapshot) => {
        const openList = document.getElementById('open-tasks-list');
        const myList = document.getElementById('my-tasks-list');
        openList.innerHTML = ''; myList.innerHTML = '';

        snapshot.forEach(taskDoc => {
            const task = taskDoc.data();
            
            const taskEl = document.createElement('div');
            taskEl.className = 'task-item';
            taskEl.innerHTML = `
                <h4>${task.title}</h4>
                <p><i class="fas fa-info-circle"></i> ${task.details}</p>
                <p><i class="far fa-clock"></i> Time: ${task.timeNeeded} | Mgr: ${task.manager}</p>
                <p>Status: <strong>${task.status}</strong></p>
            `;

            // Open/Pending Tasks Logic
            if (task.status === "Pending" && (task.assignedTo === "All" || task.assignedTo === user.uid)) {
                const acceptBtn = document.createElement('button');
                acceptBtn.className = 'task-btn';
                acceptBtn.innerHTML = '<i class="fas fa-hand-paper"></i> Accept Task';
                acceptBtn.onclick = async () => {
                    const time = prompt("Expected completion time?");
                    if(time) {
                        await updateDoc(taskDoc.ref, { status: "Accepted", acceptedBy: profile.name, acceptedById: user.uid, expectedTime: time });
                        console.log("Task Accepted");
                    }
                };
                taskEl.appendChild(acceptBtn);
                openList.appendChild(taskEl);
            } 
            // My Accepted Tasks Logic
            else if (task.acceptedById === user.uid) {
                if (task.status !== "Done") {
                    const doneBtn = document.createElement('button');
                    doneBtn.className = 'task-btn done';
                    doneBtn.innerHTML = '<i class="fas fa-check"></i> Mark as Done';
                    doneBtn.onclick = async () => {
                        await updateDoc(taskDoc.ref, { status: "Done" });
                        console.log("Task Completed");
                    };
                    taskEl.appendChild(doneBtn);
                }
                myList.appendChild(taskEl);
            }
        });
    });
}

// === MODAL LOGIC ===
const taskModal = document.getElementById('task-modal');
document.getElementById('fab-add-task').addEventListener('click', () => { taskModal.style.display = 'flex'; });
document.getElementById('close-modal-btn').addEventListener('click', () => { taskModal.style.display = 'none'; });

document.getElementById('submit-task-btn').addEventListener('click', async () => {
    const title = document.getElementById('task-title').value;
    if(!title) { alert("Title required"); return; }
    
    const taskData = {
        title: title,
        details: document.getElementById('task-details').value,
        timeNeeded: document.getElementById('task-time').value,
        manager: document.getElementById('task-manager').value,
        targetLab: document.getElementById('task-target-lab').value,
        assignedTo: document.getElementById('task-assignee').value,
        status: "Pending",
        createdBy: auth.currentUser.uid,
        timestamp: new Date()
    };

    try {
        await addDoc(collection(db, "tasks"), taskData);
        console.log("Task Added!");
        taskModal.style.display = 'none';
        document.getElementById('task-title').value = '';
        document.getElementById('task-details').value = '';
    } catch (e) {
        console.error("Error adding task: ", e.message);
    }
});
