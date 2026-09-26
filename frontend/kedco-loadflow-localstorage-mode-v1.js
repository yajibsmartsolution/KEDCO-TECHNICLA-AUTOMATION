(() => {

  "use strict";

  if (
    window.__KEDCO_LOADFLOW_LOCAL_STORAGE_MODE_V1__
  ) {
    return;
  }

  window.__KEDCO_LOADFLOW_LOCAL_STORAGE_MODE_V1__ =
    true;


  /* ========================================================
     DATE
     ======================================================== */

  function pad(value) {

    return String(value)
      .padStart(2, "0");

  }


  function todayDate() {

    const d =
      new Date();

    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate())
    );

  }


  /* ========================================================
     TEXT CORRECTIONS
     ======================================================== */

  const replacements = [

    [
      /LIVE TODAY \+ LOCAL CLOUD HISTORY/gi,
      "LIVE TODAY + LOCAL STORAGE HISTORY"
    ],

    [
      /LIVE TODAY \+ SUPABASE HISTORY/gi,
      "LIVE TODAY + LOCAL STORAGE HISTORY"
    ],

    [
      /LOCAL CLOUD KEDCO DATA/gi,
      "LOCAL STORAGE KEDCO DATA"
    ],

    [
      /SUPABASE KEDCO DATA/gi,
      "LOCAL STORAGE KEDCO DATA"
    ],

    [
      /historical Local Cloud sheet/gi,
      "historical Local Storage sheet"
    ],

    [
      /historical Supabase sheet/gi,
      "historical Local Storage sheet"
    ],

    [
      /REFERENCE OVERRIDE/gi,
      "HISTORICAL VIEW"
    ],

    [
      /shared live sheet/gi,
      "LIVE Today sheet"
    ],

    [
      /LOCAL CLOUD SESSION REQUIRED[^.]*\.\s*Live entry remains available locally\./gi,
      "LOCAL STORAGE READY · No sign-in is required. Live entry and saved history are available on this workstation.n."
    ],

    [
      /LOCAL CLOUD SESSION REQUIRED/gi,
      "LOCAL STORAGE READY"
    ]

  ];


  function replaceText(text) {

    let output =
      String(text || "");

    for (
      const [
        pattern,
        replacement
      ] of replacements
    ) {

      output =
        output.replace(
          pattern,
          replacement
        );

    }

    return output;

  }


  function repairTextNodes(root) {

    if (!root) {
      return;
    }


    const walker =
      document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT
      );


    const nodes = [];


    while (
      walker.nextNode()
    ) {

      nodes.push(
        walker.currentNode
      );

    }


    for (
      const node
      of nodes
    ) {

      const before =
        node.nodeValue || "";

      const after =
        replaceText(
          before
        );


      if (
        before !== after
      ) {

        node.nodeValue =
          after;

      }

    }

  }


  /* ========================================================
     REMOVE CLOUD SESSION BUTTON
     ======================================================== */

  function removeSessionButtons(root) {

    const buttons =
      root.querySelectorAll?.(
        "button,a"
      ) || [];


    for (
      const button
      of buttons
    ) {

      const text =
        String(
          button.textContent || ""
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();


      if (
        /Sign in\s*\/\s*Refresh Session/i
          .test(text)
      ) {

        button.style.display =
          "none";

        button.setAttribute(
          "aria-hidden",
          "true"
        );

      }

    }

  }


  /* ========================================================
     LOCAL STORAGE STATUS
     ======================================================== */

  function repairStatus(form) {

    const status =
      form.querySelector(
        "[data-lf-history-status]"
      );


    if (!status) {
      return;
    }


    const text =
      String(
        status.textContent || ""
      );


    if (
      /LOCAL CLOUD SESSION REQUIRED/i
        .test(text)
    ) {

      status.textContent =
        "LOCAL STORAGE READY · Live entry and saved history are available without cloud sign-in.";

      status.className =
        "lf-history-status ok";

    }

  }


  /* ========================================================
     HISTORY HEADING
     ======================================================== */

  function repairHistoryHeading(form) {

    const bar =
      form.querySelector(
        "[data-lf-history-bar]"
      );


    if (!bar) {
      return;
    }


    repairTextNodes(
      bar
    );


    const badge =
      bar.querySelector(
        "[data-lf-history-count]"
      );


    if (
      badge &&
      /LOCAL CLOUD|SUPABASE/i.test(
        badge.textContent || ""
      )
    ) {

      badge.textContent =
        "LOCAL STORAGE KEDCO DATA";

    }

  }


  /* ========================================================
     SET SELECTORS TO TODAY
     ======================================================== */

  function selectToday(form) {

    const now =
      new Date();


    const year =
      form.querySelector(
        "[data-lf-history-year]"
      );


    const month =
      form.querySelector(
        "[data-lf-history-month]"
      );


    const day =
      form.querySelector(
        "[data-lf-history-day]"
      );


    if (year) {

      year.value =
        String(
          now.getFullYear()
        );

      year.dispatchEvent(
        new Event(
          "change",
          {
            bubbles: true
          }
        )
      );

    }


    if (month) {

      month.value =
        String(
          now.getMonth() + 1
        );

      month.dispatchEvent(
        new Event(
          "change",
          {
            bubbles: true
          }
        )
      );

    }


    window.setTimeout(
      () => {

        if (day) {

          day.value =
            String(
              now.getDate()
            );

          day.dispatchEvent(
            new Event(
              "change",
              {
                bubbles: true
              }
            )
          );

        }

      },
      20
    );

  }


  /* ========================================================
     FIND LIVE TODAY BUTTON
     ======================================================== */

  function liveButton(form) {

    const direct =
      form.querySelector(
        [
          "[data-lf-live-today]",
          "[data-lf-history-live]",
          "[data-live-today]",
          "[data-lf-live]"
        ].join(",")
      );


    if (direct) {
      return direct;
    }


    return (
      Array
        .from(
          form.querySelectorAll(
            "button"
          )
        )
        .find(
          button =>
            /^LIVE\s*Today/i.test(
              String(
                button.textContent || ""
              ).trim()
            )
        ) ||
      null
    );

  }


  /* ========================================================
     RETURN TO LIVE TODAY ON INITIAL FORM OPEN
     ======================================================== */

  const initialized =
    new Set();


  function initializeForm(form) {

    if (!form) {
      return;
    }


    const formId =
      form.dataset.form ||
      (
        form.querySelector(
          '[name^="lf33_"]'
        )
          ? "load33"
          : form.querySelector(
              '[name^="lf11_"]'
            )
            ? "load11"
            : ""
      );


    if (
      formId !== "load33" &&
      formId !== "load11"
    ) {

      return;

    }


    repairHistoryHeading(
      form
    );

    repairStatus(
      form
    );

    removeSessionButtons(
      form
    );


    /*
     * Run only ONCE per voltage form per page load.
     *
     * This prevents yesterday's historical sheet from remaining
     * mounted when the operator reopens the form.
     *
     * After initialization, the operator can still deliberately
     * select and view any historical date.
     */

    if (
      initialized.has(
        formId
      )
    ) {

      return;
    }


    initialized.add(
      formId
    );


    window.setTimeout(
      () => {

        const bodyText =
          String(
            form.textContent || ""
          );


        const staleHistoricalView =
          /REFERENCE OVERRIDE|HISTORICAL VIEW/i
            .test(
              bodyText
            );


        const sessionBlocked =
          /LOCAL CLOUD SESSION REQUIRED/i
            .test(
              bodyText
            );


        selectToday(
          form
        );


        const button =
          liveButton(
            form
          );


        if (
          button &&
          (
            staleHistoricalView ||
            sessionBlocked
          )
        ) {

          button.click();

        }


        const dateField =
          form.elements?.namedItem(
            formId === "load33"
              ? "lf33_date"
              : "lf11_date"
          );


        if (
          dateField &&
          (
            !dateField.value ||
            staleHistoricalView
          )
        ) {

          dateField.value =
            todayDate();

        }


        const status =
          form.querySelector(
            "[data-lf-history-status]"
          );


        if (
          status &&
          !/Viewing\s+\d{4}-\d{2}-\d{2}/i
            .test(
              status.textContent || ""
            )
        ) {

          status.textContent =
            "LIVE TODAY · LOCAL STORAGE READY · Select a historical date only when you want to review a previous sheet.";

          status.className =
            "lf-history-status ok";

        }

      },
      250
    );

  }


  /* ========================================================
     PAGE REPAIR
     ======================================================== */

  function repairPage() {

    repairTextNodes(
      document.body
    );


    removeSessionButtons(
      document
    );


    const forms =
      document.querySelectorAll(
        [
          'form[data-form="load33"]',
          'form[data-form="load11"]'
        ].join(",")
      );


    forms.forEach(
      initializeForm
    );

  }


  /* ========================================================
     OBSERVE DYNAMIC E-FORMS
     ======================================================== */

  let queued =
    false;


  const observer =
    new MutationObserver(
      () => {

        if (queued) {
          return;
        }


        queued =
          true;


        requestAnimationFrame(
          () => {

            queued =
              false;

            repairPage();

          }
        );

      }
    );


  function start() {

    repairPage();


    observer.observe(
      document.documentElement,
      {
        childList: true,
        subtree: true
      }
    );


    console.log(
      "KEDCO Load Flow Local Storage Mode v1 active"
    );

  }


  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      start,
      {
        once: true
      }
    );

  }
  else {

    start();

  }

})();