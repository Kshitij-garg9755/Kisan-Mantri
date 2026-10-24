// frontend/js/login-auth.js
var form = document.getElementById("login-form");
var nameField = document.getElementById("name-field");
var nameInput = document.getElementById("name");
var emailInput = document.getElementById("email");
var passwordInput = document.getElementById("password");
var loginBtn = document.getElementById("login-btn");
var msg = document.getElementById("msg");
var formTitle = document.getElementById("form-title");
var formIntro = document.getElementById("form-intro");
var switchPrompt = document.getElementById("switch-prompt");
var switchModeBtn = document.getElementById("switch-mode");
var isLogin = false;
async function apiFetch(path, options = {}) {
  options.credentials = "include";
  const host = window.location.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  const isCloudOrigin = window.location.protocol === "https:" && !isLocalHost;
  if (window.location.port === "5000" || isCloudOrigin) return fetch(path, options);
  const targets = [
    "http://127.0.0.1:5000" + path,
    "http://10.86.67.6:5000" + path,
    path
  ];
  let lastError;
  for (const target of targets) {
    try {
      const response = await fetch(target, options);
      if (response.status !== 404 && response.status !== 502) return response;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return fetch(path, options);
}
async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.message || data.error || "Request failed. Please try again.");
  }
  return data;
}
function setMode(loginMode) {
  isLogin = loginMode;
  nameField.hidden = loginMode;
  nameInput.required = !loginMode;
  passwordInput.autocomplete = loginMode ? "current-password" : "new-password";
  passwordInput.minLength = loginMode ? 1 : 8;
  passwordInput.placeholder = loginMode ? "Enter your password" : "At least 8 characters";
  formTitle.textContent = loginMode ? "Welcome back." : "Farmer sign up.";
  formIntro.textContent = loginMode ? "Log in with the Gmail and password you registered with." : "Create your farmer account with your name and Gmail.";
  loginBtn.textContent = loginMode ? "Log in" : "Create account";
  switchPrompt.textContent = loginMode ? "New to Smart Farm?" : "Already have an account?";
  switchModeBtn.textContent = loginMode ? "Create account" : "Log in";
  msg.textContent = "";
}
function finishLogin(farmer) {
  localStorage.setItem("farmer", JSON.stringify(farmer));
  msg.style.color = "#22734c";
  msg.textContent = "Success! Opening Smart Farm...";
  const nextPath = new URLSearchParams(window.location.search).get("next");
  const safeNext = nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/pages/index.html";
  setTimeout(() => {
    window.location.href = safeNext;
  }, 350);
}
switchModeBtn.addEventListener("click", () => setMode(!isLogin));
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginBtn.disabled = true;
  msg.style.color = "#22734c";
  msg.textContent = isLogin ? "Logging in..." : "Creating your account...";
  try {
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    if (!email.endsWith("@gmail.com")) throw new Error("Please use a Gmail address ending in @gmail.com.");
    if (!isLogin && password.length < 8) throw new Error("Password must be at least 8 characters.");
    const response = await apiFetch(isLogin ? "/api/auth/login" : "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nameInput.value.trim(),
        email,
        password
      })
    });
    const data = await readJson(response);
    if (!data.farmer) throw new Error("Account response was incomplete. Please try again.");
    finishLogin(data.farmer);
  } catch (error) {
    msg.style.color = "#c62828";
    msg.textContent = error.message || "Could not complete sign in. Please try again.";
  } finally {
    loginBtn.disabled = false;
  }
});
setMode(false);
