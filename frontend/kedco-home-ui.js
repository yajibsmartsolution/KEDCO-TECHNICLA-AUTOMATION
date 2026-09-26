/* Small dependency-free fallback for the public landing-page controls. */
(function () {
  "use strict";

  function openLogin(event) {
    const trigger = event.target?.closest?.("#openLogin, #heroSignin, #ctaSignin");
    if (!trigger) return;

    const modal = document.getElementById("loginModal");
    const dialog = document.getElementById("dialog");
    if (!modal || !dialog) return;

    event.preventDefault();
    dialog.classList.remove("reset");
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
    window.setTimeout(() => document.getElementById("email")?.focus(), 30);
  }

  document.addEventListener("click", openLogin, true);
})();
