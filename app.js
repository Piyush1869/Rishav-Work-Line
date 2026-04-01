import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

// Your provided config
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

// UI Screen Manager
const screens = {
    login: document.getElementById('login-screen'),
    profile: document.getElementById('profile-screen'),
    dashboard: document.getElementById('dashboard-screen')
};

function showScreen(screenName) {
    Object.values(screens).forEach(s => { if(s) s.classList.remove('active'); });
    if(screens[screenName]) screens[screenName].classList.add('active');
}

// ==========================================
// AUTHENTICATION LOGIC
// ==========================================

// 1. Google Login
document.getElementById('login-google-btn').addEventListener('click', () => {
    const provider = new GoogleAuthProvider();
    signInWithPopup(auth, provider).catch(error => alert(error.message));
});

// 2. Phone Login Setup (reCAPTCHA)
window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
    'size': 'normal',
    'callback': (response) => {
        // reCAPTCHA solved
    }
});

// Send OTP
document.getElementById('send-otp-btn').addEventListener('click', () => {
    const phoneNumber = document.getElementById('phone-number').value;
    if(!phoneNumber.startsWith('+')) {
        alert("Please include country code, e.g., +91");
        return;
    }

    const appVerifier = window.recaptchaVerifier;
    signInWithPhoneNumber(auth, phoneNumber, appVerifier)
        .then((confirmationResult) => {
            window.confirmationResult = confirmationResult;
            document.getElementById('otp-section').style.display = 'block';
            document.getElementById('send-otp-btn').style.display = 'none';
            alert("OTP Sent!");
        }).catch((error) => {
            alert("Error sending SMS: " + error.message);
        });
});

// Verify OTP
document.getElementById('verify-otp-btn').addEventListener('click', () => {
    const code = document.getElementById('otp-code').value;
    window.confirmationResult.confirm(code).catch((error) => {
        alert("Bad verification code: " + error.message);
    });
});

// ==========================================
// ROUTING & PROFILE LOGIC
// ==========================================

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Check if user exists in Firestore
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            // User is fully registered, go to dashboard
            showScreen('dashboard');
            // (Call your setupDashboard function here from Phase 3)
            document.getElementById('display-name').textContent = userSnap.data().name;
        } else {
            // NEW USER: Figure out what info is missing
            showScreen('profile');
            
            const emailInput = document.getElementById('prof-email');
            const phoneInput = document.getElementById('prof-phone');

            // If logged in via Google, they have email but need phone
            if (user.email) {
                emailInput.style.display = 'none';
                phoneInput.style.display = 'block';
                phoneInput.required = true;
            } 
            // If logged in via Phone, they have phone but need email
            else if (user.phoneNumber) {
                phoneInput.style.display = 'none';
                emailInput.style.display = 'block';
                emailInput.required = true;
            }
        }
    } else {
        showScreen('login');
    }
});

// Save Profile Logic
document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const user = auth.currentUser;
    const name = document.getElementById('prof-name').value;
    const lab = document.getElementById('prof-lab').value;
    
    // Grab email/phone from the auth object OR the input fields if they were asked for it
    const email = user.email ? user.email : document.getElementById('prof-email').value;
    const phone = user.phoneNumber ? user.phoneNumber : document.getElementById('prof-phone').value;

    if (!name || !email || !phone) {
        alert("Please fill in all required fields!");
        return;
    }

    const profileData = {
        uid: user.uid,
        name: name,
        email: email,
        phone: phone,
        lab: lab,
        status: "Active"
    };
    
    // Save to Firestore Database
    await setDoc(doc(db, "users", user.uid), profileData);
    
    // Redirect to Dashboard
    showScreen('dashboard');
    document.getElementById('display-name').textContent = profileData.name;
});
