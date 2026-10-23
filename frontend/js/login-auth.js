import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';

const form = document.getElementById('login-form');
const nameInput = document.getElementById('name');
const phoneInput = document.getElementById('phone');
const otpField = document.getElementById('otp-field');
const otpInput = document.getElementById('otp');
const loginBtn = document.getElementById('login-btn');
const msg = document.getElementById('msg');
const recaptchaContainer = document.getElementById('recaptcha-container');
const changePhoneBtn = document.getElementById('change-phone-btn');
const resendOtpBtn = document.getElementById('resend-otp-btn');
const isNative = Capacitor.isNativePlatform();

let firebaseAuth;
let confirmationResult;
let nativeVerificationId;
let recaptchaVerifier;
let nativeListenersReady;
let useFirebase = false;

// Universal fetch helper that seamlessly handles Browser, ADB USB Reverse, and LAN Wi-Fi
async function apiFetch(path, options = {}) {
  options.credentials = 'include';
  const host = window.location.hostname;
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';
  const isCloudOrigin = window.location.protocol === 'https:' && !isLocalHost;
  if (window.location.port === '5000' || isCloudOrigin) {
    return fetch(path, options);
  }
  const targets = [
    'http://127.0.0.1:5000' + path,
    'http://10.86.67.6:5000' + path,
    path
  ];
  let lastError;
  for (const target of targets) {
    try {
      const res = await fetch(target, options);
      if (res.status !== 404 && res.status !== 502) {
        return res;
      }
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return fetch(path, options);
}

const readJson = async response => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.message || data.error || 'Request failed. Please try again.');
  }
  return data;
};

function friendlyFirebaseError(error) {
  const code = String(error?.code || '');
  if (code.includes('invalid-phone-number')) return 'Enter a valid Indian mobile number.';
  if (code.includes('too-many-requests') || code.includes('quota-exceeded')) return 'Firebase has temporarily limited SMS requests. Try again later.';
  if (code.includes('captcha-check-failed') || code.includes('missing-recaptcha-token')) return 'Complete the reCAPTCHA and try again.';
  if (code.includes('unauthorized-domain')) return 'This website domain is not authorized in Firebase Authentication settings.';
  if (code.includes('app-not-authorized') || code.includes('invalid-app-credential')) return 'Firebase rejected this app configuration. Check google-services.json and the Android SHA fingerprints.';
  if (code.includes('network-request-failed')) return 'Network error. Check internet connection and try again.';
  return error?.message || 'Verification failed. Please check the code and try again.';
}

async function initializeFirebase() {
  if (firebaseAuth) return firebaseAuth;
  try {
    const response = await apiFetch('/api/firebase-config', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.configured || !data.config) {
      return null;
    }
    const app = getApps().length ? getApp() : initializeApp(data.config);
    firebaseAuth = getAuth(app);
    firebaseAuth.useDeviceLanguage();
    useFirebase = true;
    return firebaseAuth;
  } catch (error) {
    return null;
  }
}

function showCodeStep(message) {
  otpField.style.display = 'flex';
  phoneInput.disabled = true;
  nameInput.disabled = true;
  loginBtn.textContent = 'Verify OTP';
  msg.style.color = '#22734c';
  msg.textContent = message;
  otpInput.focus();
}

function resetToPhoneStep() {
  otpField.style.display = 'none';
  phoneInput.disabled = false;
  nameInput.disabled = false;
  loginBtn.textContent = 'Send OTP';
  otpInput.value = '';
  msg.textContent = '';
  phoneInput.focus();
}

if (changePhoneBtn) {
  changePhoneBtn.addEventListener('click', e => {
    e.preventDefault();
    resetToPhoneStep();
  });
}

if (resendOtpBtn) {
  resendOtpBtn.addEventListener('click', async e => {
    e.preventDefault();
    const phone = phoneInput.value.replace(/\D/g, '');
    if (!phone) return;
    msg.style.color = '#22734c';
    msg.textContent = 'Resending code...';
    try {
      if (useFirebase && isNative) {
        await sendNativeOtp(phone);
      } else if (useFirebase && firebaseAuth) {
        await sendWebOtp(firebaseAuth, phone);
      } else {
        await sendServerOtp(phone);
      }
    } catch (err) {
      msg.style.color = '#c62828';
      msg.textContent = err.message;
    }
  });
}

// Built-in Flask SMS / Demo OTP fallback
async function sendServerOtp(phone) {
  const response = await apiFetch('/send_otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Could not send OTP. Please try again.');
  }
  showCodeStep(data.message || 'OTP sent! Please enter the 6-digit code.');
  if (data.otp) {
    otpInput.value = data.otp;
  }
}

async function verifyServerOtp(phone, otp, name) {
  const response = await apiFetch('/verify_otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, otp, name }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Incorrect OTP code.');
  }

  if (data.farmer) {
    localStorage.setItem('farmer', JSON.stringify(data.farmer));
  } else {
    const loginRes = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone }),
    });
    const loginData = await readJson(loginRes);
    localStorage.setItem('farmer', JSON.stringify(loginData.farmer));
  }

  msg.style.color = '#22734c';
  msg.textContent = 'Login successful! Redirecting...';
  const nextPath = new URLSearchParams(window.location.search).get('next');
  const safeNext = nextPath && nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/pages/index.html';
  setTimeout(() => {
    window.location.href = safeNext;
  }, 350);
}

async function sendWebOtp(auth, phone) {
  recaptchaContainer.hidden = false;
  recaptchaVerifier = new RecaptchaVerifier(auth, recaptchaContainer, {
    size: 'normal',
    'expired-callback': () => {
      msg.style.color = '#c62828';
      msg.textContent = 'reCAPTCHA expired. Please request a new code.';
    },
  });
  confirmationResult = await signInWithPhoneNumber(auth, `+91${phone}`, recaptchaVerifier);
  showCodeStep('Firebase sent an OTP by SMS. Enter the 6-digit code.');
}

async function ensureNativeListeners() {
  if (nativeListenersReady) return nativeListenersReady;
  nativeListenersReady = Promise.all([
    FirebaseAuthentication.addListener('phoneCodeSent', event => {
      nativeVerificationId = event.verificationId;
      showCodeStep('Firebase sent an OTP by SMS. Enter the 6-digit code.');
    }),
    FirebaseAuthentication.addListener('phoneVerificationFailed', event => {
      msg.style.color = '#c62828';
      msg.textContent = friendlyFirebaseError(event.error || event);
      loginBtn.disabled = false;
    }),
    FirebaseAuthentication.addListener('phoneVerificationCompleted', async () => {
      try {
        await finishNativeLogin();
      } catch (error) {
        msg.style.color = '#c62828';
        msg.textContent = friendlyFirebaseError(error);
        loginBtn.disabled = false;
      }
    }),
  ]);
  return nativeListenersReady;
}

async function sendNativeOtp(phone) {
  recaptchaContainer.hidden = true;
  await ensureNativeListeners();
  msg.style.color = '#22734c';
  msg.textContent = 'Requesting a verification code…';
  await FirebaseAuthentication.signInWithPhoneNumber({ phoneNumber: `+91${phone}`, timeout: 60 });
}

async function finishLogin(idToken) {
  const response = await apiFetch('/api/auth/firebase-login', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ name: nameInput.value.trim(), phone: phoneInput.value.replace(/\D/g, '') }),
  });
  const account = await readJson(response);
  localStorage.setItem('farmer', JSON.stringify(account.farmer));
  msg.style.color = '#22734c';
  msg.textContent = 'Login successful! Redirecting...';
  const nextPath = new URLSearchParams(window.location.search).get('next');
  const safeNext = nextPath && nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/pages/index.html';
  setTimeout(() => {
    window.location.href = safeNext;
  }, 350);
}

async function finishNativeLogin() {
  const result = await FirebaseAuthentication.getIdToken();
  await finishLogin(result.token);
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  loginBtn.disabled = true;
  msg.textContent = '';
  try {
    const phone = phoneInput.value.replace(/\D/g, '');
    if (phone.length !== 10 || !/^[6-9]/.test(phone)) throw new Error('Enter a valid 10-digit Indian mobile number.');
    if (!nameInput.value.trim()) throw new Error('Please enter your name.');

    const auth = await initializeFirebase();

    if (otpField.style.display === 'none') {
      if (auth && isNative) {
        await sendNativeOtp(phone);
      } else if (auth) {
        await sendWebOtp(auth, phone);
      } else {
        await sendServerOtp(phone);
      }
      return;
    }

    const otp = otpInput.value.trim();
    if (!otp) throw new Error('Enter the 6-digit code.');

    if (auth && isNative) {
      if (!nativeVerificationId) throw new Error('Request a new verification code first.');
      await FirebaseAuthentication.confirmVerificationCode({
        verificationId: nativeVerificationId,
        verificationCode: otp,
      });
      await finishNativeLogin();
    } else if (auth && confirmationResult) {
      const credential = await confirmationResult.confirm(otp);
      await finishLogin(await credential.user.getIdToken());
    } else {
      await verifyServerOtp(phone, otp, nameInput.value.trim());
    }
  } catch (error) {
    msg.style.color = '#c62828';
    msg.textContent = friendlyFirebaseError(error);
    if (recaptchaVerifier && !isNative) {
      try {
        recaptchaVerifier.clear();
      } catch (e) {}
      recaptchaVerifier = undefined;
      confirmationResult = undefined;
      recaptchaContainer.replaceChildren();
    }
  } finally {
    loginBtn.disabled = false;
  }
});
