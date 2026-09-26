(() => {
  "use strict";

  const VERSION = "20260915-supervisors-v2";
  const SUPERVISOR_STORE = "KEDCO_LOCAL_SUPERVISORS_V1";
  const USERS_STORE = "KEDCO_LOCAL_USERS_V1";
  const ACTIVE_USER = "KEDCO_ACTIVE_USER";
  const PASSWORD_HASH = "da06192001c05876d72dfe23b33f30f0056d58652c6f9ff4a15388bfe4d29512";
  const LOGIN_PAGE = "/index.html";

  const ACCOUNTS = [
    {
      id: "kedco-super-operator-001",
      email: "superoperator@kedco.com",
      full_name: "Supervisor - Station Operators",
      company: "KEDCO",
      department: "SYSTEM OPERATIONS",
      role: "super_operator",
      roleKey: "super_operator",
      supervisor: true,
      elevated: true,
      scope: "ALL",
      assignments: ["ALL"],
      authorized_stations: ["ALL"],
      supervises: ["operator"],
      subordinatePages: ["operator.html"],
      landingPage: "/pages/system-operations/super_operator.html",
      is_active: true
    },
    {
      id: "kedco-super-trans-001",
      email: "supertrans@kedco.com",
      full_name: "Supervisor - Transmission Operators",
      company: "KEDCO",
      department: "SYSTEM OPERATIONS",
      role: "super_trans",
      roleKey: "super_trans",
      supervisor: true,
      elevated: true,
      scope: "ALL",
      assignments: ["ALL"],
      authorized_stations: ["ALL"],
      supervises: ["transmission_operator"],
      subordinatePages: ["trans.html"],
      landingPage: "/pages/tmo/super_trans.html",
      is_active: true
    },
    {
      id: "kedco-super-re-te-001",
      email: "superre@kedco.com",
      full_name: "Supervisor - RE / TE",
      company: "KEDCO",
      department: "TECHNICAL SERVICES",
      role: "super_re_te",
      roleKey: "super_re_te",
      supervisor: true,
      elevated: true,
      scope: "ALL",
      assignments: ["ALL"],
      authorized_regions: ["ALL"],
      supervises: [
        "re",
        "te",
        "regional_engineer",
        "technical_engineer"
      ],
      subordinatePages: ["re_te.html"],
      landingPage: "/pages/operations-maintenance/super_re_te.html",
      is_active: true
    }
  ];

  function parse(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value == null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function installAccounts() {
    localStorage.setItem(
      SUPERVISOR_STORE,
      JSON.stringify(
        ACCOUNTS.map(account => ({
          ...account,
          password_hash: PASSWORD_HASH,
          auth_source: "local-storage"
        }))
      )
    );

    const existing = parse(USERS_STORE, []);
    const users = Array.isArray(existing) ? existing.slice() : [];

    ACCOUNTS.forEach(account => {
      const i = users.findIndex(
        user =>
          String(user?.email || "").trim().toLowerCase() ===
          account.email.toLowerCase()
      );

      const record = {
        ...(i >= 0 ? users[i] : {}),
        ...account,
        password_hash: PASSWORD_HASH,
        auth_source: "local-storage",
        updatedAt: new Date().toISOString()
      };

      if (!record.createdAt) {
        record.createdAt = new Date().toISOString();
      }

      // Never keep a plaintext password in this compatibility store.
      delete record.password;

      if (i >= 0) users[i] = record;
      else users.push(record);
    });

    localStorage.setItem(USERS_STORE, JSON.stringify(users));
  }

  async function sha256(text) {
    const bytes = new TextEncoder().encode(String(text ?? ""));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function currentUser() {
    for (const storage of [sessionStorage, localStorage]) {
      try {
        const user = JSON.parse(storage.getItem(ACTIVE_USER) || "null");
        if (user && typeof user === "object") return user;
      } catch (_) {}
    }
    return null;
  }

  function setActiveUser(account) {
    const sessionUser = {
      ...account,
      loginAt: new Date().toISOString(),
      auth_source: "local-storage",
      supervisor: true,
      elevated: true,
      scope: "ALL"
    };

    delete sessionUser.password;
    delete sessionUser.password_hash;

    localStorage.setItem(ACTIVE_USER, JSON.stringify(sessionUser));
    sessionStorage.setItem(ACTIVE_USER, JSON.stringify(sessionUser));

    localStorage.setItem("KEDCO_AUTH_USER_ID", sessionUser.id);
    localStorage.setItem("KEDCO_AUTH_EMAIL", sessionUser.email);
    localStorage.setItem("KEDCO_AUTH_ROLE", sessionUser.roleKey);
    localStorage.setItem("KEDCO_LOGIN_ROLE", sessionUser.roleKey);
    localStorage.setItem(
      "KEDCO_AUTH_ASSIGNMENTS",
      JSON.stringify(sessionUser.assignments || ["ALL"])
    );
    localStorage.setItem(
      "KEDCO_USER_ASSIGNMENTS",
      JSON.stringify(sessionUser.assignments || ["ALL"])
    );

    window.KEDCO_ACTIVE_USER = sessionUser;

    try {
      window.dispatchEvent(
        new CustomEvent("kedco-auth-changed", {
          detail: sessionUser
        })
      );
    } catch (_) {}

    return sessionUser;
  }

  function accountByEmail(email) {
    const normalized = String(email || "").trim().toLowerCase();
    return ACCOUNTS.find(account => account.email === normalized) || null;
  }

  function findEmailInput() {
    const inputs = Array.from(document.querySelectorAll("input"));
    return (
      inputs.find(input => String(input.type || "").toLowerCase() === "email") ||
      inputs.find(input =>
        /email|username|user|login/i.test(
          [input.name, input.id, input.placeholder]
            .filter(Boolean)
            .join(" ")
        )
      ) ||
      null
    );
  }

  function findPasswordInput() {
    return (
      document.querySelector('input[type="password"]') ||
      Array.from(document.querySelectorAll("input")).find(input =>
        /password|passcode|passwd/i.test(
          [input.name, input.id, input.placeholder]
            .filter(Boolean)
            .join(" ")
        )
      ) ||
      null
    );
  }

  function loginMessage(message, error = false) {
    let box = document.getElementById("kedcoSupervisorLoginMessage");

    if (!box) {
      box = document.createElement("div");
      box.id = "kedcoSupervisorLoginMessage";
      box.style.cssText =
        "position:fixed;top:18px;left:50%;transform:translateX(-50%);" +
        "z-index:2147483647;max-width:520px;padding:12px 18px;border-radius:12px;" +
        "font:700 13px/1.45 Arial,sans-serif;box-shadow:0 12px 34px rgba(0,0,0,.22)";
      document.body.appendChild(box);
    }

    box.style.background = error ? "#fff0f0" : "#eaf9f4";
    box.style.color = error ? "#951f1f" : "#075e49";
    box.style.border = error ? "1px solid #edb9b9" : "1px solid #a7dfcf";
    box.textContent = message;

    clearTimeout(loginMessage.timer);
    loginMessage.timer = setTimeout(() => box.remove(), 4500);
  }

  async function completeSupervisorLogin(account, passwordInput) {
    const hash = await sha256(passwordInput?.value || "");

    if (hash !== PASSWORD_HASH) {
      loginMessage("Incorrect email or password.", true);
      passwordInput?.focus();
      passwordInput?.select?.();
      return;
    }

    if (!account.is_active) {
      loginMessage("This KEDCO supervisor account is inactive.", true);
      return;
    }

    setActiveUser(account);

    loginMessage(
      "Login successful. Opening " + account.full_name + " console..."
    );

    setTimeout(() => {
      window.location.href = account.landingPage;
    }, 120);
  }

  function interceptSupervisorLogin(event) {
    const emailInput = findEmailInput();
    const passwordInput = findPasswordInput();

    if (!emailInput || !passwordInput) return false;

    const account = accountByEmail(emailInput.value);
    if (!account) return false;

    // Supervisor email detected: our local supervisor auth owns this attempt.
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    }

    void completeSupervisorLogin(account, passwordInput);
    return true;
  }

  function isLoginLikeButton(target) {
    const element = target?.closest?.(
      'button, input[type="submit"], input[type="button"], [role="button"]'
    );

    if (!element) return false;

    const text = String(
      element.innerText ||
      element.value ||
      element.getAttribute("aria-label") ||
      element.id ||
      element.className ||
      ""
    );

    return /login|log in|sign in|signin|submit|continue/i.test(text);
  }

  function logout() {
    sessionStorage.removeItem(ACTIVE_USER);
    localStorage.removeItem(ACTIVE_USER);
    localStorage.removeItem("KEDCO_AUTH_USER_ID");
    localStorage.removeItem("KEDCO_AUTH_EMAIL");
    localStorage.removeItem("KEDCO_AUTH_ROLE");
    localStorage.removeItem("KEDCO_LOGIN_ROLE");
    localStorage.removeItem("KEDCO_AUTH_ASSIGNMENTS");
    localStorage.removeItem("KEDCO_USER_ASSIGNMENTS");

    delete window.KEDCO_ACTIVE_USER;

    try {
      window.dispatchEvent(
        new CustomEvent("kedco-auth-changed", { detail: null })
      );
    } catch (_) {}
  }

  function roleOf(user) {
    return String(user?.roleKey || user?.role || "")
      .trim()
      .toLowerCase();
  }

  const REQUIRED_PAGE_ROLES = {
    "super_operator.html": "super_operator",
    "super_trans.html": "super_trans",
    "super_re_te.html": "super_re_te"
  };

  function protectSupervisorPage() {
    const page = decodeURIComponent(
      String(location.pathname || "")
        .split("/")
        .filter(Boolean)
        .pop() || ""
    ).toLowerCase();

    const requiredRole = REQUIRED_PAGE_ROLES[page];
    if (!requiredRole) return true;

    const user = currentUser();

    if (roleOf(user) === requiredRole && user?.is_active !== false) {
      window.KEDCO_ACTIVE_USER = user;
      document.documentElement.setAttribute(
        "data-kedco-supervisor-role",
        requiredRole
      );
      return true;
    }

    alert(
      "Access denied. Please sign in with the authorized " +
      requiredRole.replaceAll("_", " ") +
      " account."
    );

    window.location.replace(LOGIN_PAGE || "/");
    return false;
  }

  installAccounts();

  window.KEDCO_SUPERVISOR_LOCAL_AUTH = {
    version: VERSION,
    accounts: ACCOUNTS.map(({ ...account }) => ({ ...account })),
    currentUser,
    setActiveUser,
    logout,
    protectSupervisorPage,
    installAccounts
  };

  // Use capture phase so these 3 supervisor credentials are handled before
  // the existing normal KEDCO login handler. Other emails are untouched.
  document.addEventListener(
    "submit",
    event => {
      interceptSupervisorLogin(event);
    },
    true
  );

  document.addEventListener(
    "click",
    event => {
      if (isLoginLikeButton(event.target)) {
        interceptSupervisorLogin(event);
      }
    },
    true
  );

  function ready() {
    installAccounts();
    protectSupervisorPage();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready, { once: true });
  } else {
    ready();
  }
})();