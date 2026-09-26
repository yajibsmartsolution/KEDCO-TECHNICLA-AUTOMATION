/*
=============================================================
KEDCO TECHNICAL AUTOMATION
HOURLY LOAD READING NORMALIZER V2
=============================================================

RULE:

VALID NUMERIC
    -> remains numeric / ACTIVE

ON / ON SOAK
    -> 0 / ACTIVE

KNOWN ABBREVIATION
    -> approved group name

UNKNOWN / NIL / N/A / TYPO / MALFORMED NUMBER
    -> DO NOT save UNCLASSIFIED or IGNORED
    -> force operator to select approved group
       OR enter corrected numeric MW reading.

=============================================================
*/

(function () {

  "use strict";


  if (
    window.__KEDCO_HOURLY_NORMALIZER_V2__
  ) {
    return;
  }


  window.__KEDCO_HOURLY_NORMALIZER_V2__ =
    true;


  const SELECTOR =
    "[data-lf33-reading]," +
    "[data-lf11-reading]";


  /*
  ===========================================================
  APPROVED GROUPS
  ===========================================================
  */

  const GROUP = {

    LOAD_SHEDDING:
      "LOAD SHEDDING",

    FAULT_OUTAGE:
      "FAULT / OUTAGE",

    BREAKER_FAULT:
      "BREAKER FAULT",

    PLANNED_OUTAGE:
      "PLANNED OUTAGE",

    EMERGENCY_OUTAGE:
      "EMERGENCY OUTAGE",

    MAINTENANCE:
      "MAINTENANCE",

    TCN_MAINTENANCE:
      "TCN MAINTENANCE",

    FREQUENCY_CONTROL:
      "FREQUENCY CONTROL"

  };


  const CANONICAL_GROUPS =
    new Set(
      Object.values(GROUP)
    );


  /*
  ===========================================================
  ABBREVIATION GROUPS
  ===========================================================
  */

  const LOAD_SHEDDING =
    new Set([

      "LS/GS",
      "L/S GS",
      "LG/GS",
      "L/LIM",
      "DIS/ALLO",
      "U/S",
      "OS",
      "O.S",
      "O/S",
      "I/S",
      "KS",
      "O/A",
      "SH",
      "LST",
      "LOAD SHEDDING"

    ]);


  const FAULT_OUTAGE =
    new Set([

      "E/F",
      "EF",
      "OC/EF",
      "O/C",

      "TR/F",
      "TR/2",
      "TR/FF",
      "TR/FTR/F",
      "TR2/F",
      "TRE2/F",

      "L/F",
      "LF",

      "F",
      "F/T",

      "O/E",
      "O/F",
      "FAULT",

      "0/F",
      "C/F",
      "L\\F",

      "N/S",
      "L/O",
      "0/D",
      "O/R",
      "C",

      "FAULT / OUTAGE",
      "FAULT OUTAGE"

    ]);


  const BREAKER_FAULT =
    new Set([

      "B/F",
      "TR2 CB F",
      "CB F",
      "CB//F",
      "BREAKER FAULT"

    ]);


  const PLANNED_OUTAGE =
    new Set([

      "P/O",
      "B/O",
      "BO",
      "GS",
      "B/P",
      "DISC/MAINT",
      "MTC-DISC",

      "PLANNED OUTAGE",
      "PLAN OUTAGE"

    ]);


  const EMERGENCY_OUTAGE =
    new Set([

      "EMG/DSC",
      "EMG D",
      "EMG/DISC",
      "EMG/DIC",

      "EMERGENCY",
      "EMERGENCY OUTAGE"

    ]);


  const MAINTENANCE =
    new Set([

      "E/OPENED",
      "MTCE/D",
      "MTC/DIS",
      "DISCO/MTN",
      "DISCO/MINT",
      "MAINTENANCE"

    ]);


  const TCN_MAINTENANCE =
    new Set([

      "MTC/TCN",
      "MTCE/TCN",
      "TCN/MNT",
      "EMERG/TCN",

      "132KV LINE/F",
      "132KV LINE/F(132KV LINE ON FAULT)",
      "132KV LINE/F (132KV LINE ON FAULT)",

      "SBEF",

      "TCN MAINTENANCE"

    ]);


  const FREQUENCY_CONTROL =
    new Set([

      "FREQ/C",
      "FREQUENCY CONTROL"

    ]);


  /*
  ===========================================================
  VALUES THAT MUST NOW BE CORRECTED BY USER
  ===========================================================
  */

  const REQUIRES_USER_DECISION =
    new Set([

      ",",
      "NIL",
      "N/A",
      "NA",
      "N.A",
      "N.A."

    ]);


  const ACTIVE_ZERO =
    new Set([

      "ON",
      "ON SOAK",
      "ON-SOAK",
      "ONSOAK"

    ]);


  /*
  ===========================================================
  TEXT NORMALIZER
  ===========================================================
  */

  function token(value) {

    return String(
      value ?? ""
    )
      .trim()
      .toUpperCase()
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ");

  }


  /*
  ===========================================================
  NUMERIC PARSER

  ACCEPT:
      4
      4.5
      .5
      0.1
      4,5     -> 4.5

  REJECT:
      4..5.0
      4.5.0
      5..2
      abc4.5
  ===========================================================
  */

  function parseNumeric(value) {

    let text =
      String(
        value ?? ""
      )
        .trim()
        .replace(/\s+/g, "");


    if (!text) {

      return {
        valid:
          false
      };

    }


    /*
    Nigerian/Excel decimal correction:

       4,5 -> 4.5

    Only when there is no existing decimal point.
    */

    if (
      text.includes(",") &&
      !text.includes(".") &&
      (
        text.match(/,/g) ||
        []
      ).length === 1
    ) {

      text =
        text.replace(
          ",",
          "."
        );

    }


    const valid =
      /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/
        .test(text);


    if (!valid) {

      return {
        valid:
          false
      };

    }


    const numeric =
      Number(text);


    if (
      !Number.isFinite(numeric)
    ) {

      return {
        valid:
          false
      };

    }


    return {

      valid:
        true,

      number:
        numeric,

      value:
        String(numeric)

    };

  }


  /*
  ===========================================================
  KNOWN CLASSIFICATION
  ===========================================================
  */

  function classify(value) {

    const raw =
      String(
        value ?? ""
      ).trim();


    const code =
      token(raw);


    // Empty future hour stays blank.

    if (!raw) {

      return {

        type:
          "blank",

        value:
          ""

      };

    }


    // Numeric = ACTIVE.

    const numeric =
      parseNumeric(raw);


    if (
      numeric.valid
    ) {

      return {

        type:
          "numeric",

        value:
          numeric.value,

        group:
          "ACTIVE",

        original:
          raw

      };

    }


    // ON / ON SOAK = active with 0 MW.

    if (
      ACTIVE_ZERO.has(code)
    ) {

      return {

        type:
          "numeric",

        value:
          "0",

        group:
          "ACTIVE",

        original:
          raw

      };

    }


    if (
      LOAD_SHEDDING.has(code)
    ) {

      return {

        type:
          "group",

        value:
          GROUP.LOAD_SHEDDING,

        group:
          GROUP.LOAD_SHEDDING,

        original:
          raw

      };

    }


    if (
      FAULT_OUTAGE.has(code)
    ) {

      return {

        type:
          "group",

        value:
          GROUP.FAULT_OUTAGE,

        group:
          GROUP.FAULT_OUTAGE,

        original:
          raw

      };

    }


    if (
      BREAKER_FAULT.has(code)
    ) {

      return {

        type:
          "group",

        value:
          GROUP.BREAKER_FAULT,

        group:
          GROUP.BREAKER_FAULT,

        original:
          raw

      };

    }


    if (
      PLANNED_OUTAGE.has(code)
    ) {

      return {

        type:
          "group",

        value:
          GROUP.PLANNED_OUTAGE,

        group:
          GROUP.PLANNED_OUTAGE,

        original:
          raw

      };

    }


    if (
      EMERGENCY_OUTAGE.has(code)
    ) {

      return {

        type:
          "group",

        value:
          GROUP.EMERGENCY_OUTAGE,

        group:
          GROUP.EMERGENCY_OUTAGE,

        original:
          raw

      };

    }


    if (
      MAINTENANCE.has(code)
    ) {

      return {

        type:
          "group",

        value:
          GROUP.MAINTENANCE,

        group:
          GROUP.MAINTENANCE,

        original:
          raw

      };

    }


    if (
      TCN_MAINTENANCE.has(code)
    ) {

      return {

        type:
          "group",

        value:
          GROUP.TCN_MAINTENANCE,

        group:
          GROUP.TCN_MAINTENANCE,

        original:
          raw

      };

    }


    if (
      FREQUENCY_CONTROL.has(code)
    ) {

      return {

        type:
          "group",

        value:
          GROUP.FREQUENCY_CONTROL,

        group:
          GROUP.FREQUENCY_CONTROL,

        original:
          raw

      };

    }


    /*
    Existing canonical group.
    */

    if (
      CANONICAL_GROUPS.has(code)
    ) {

      return {

        type:
          "group",

        value:
          code,

        group:
          code,

        original:
          raw

      };

    }


    /*
    NIL / N/A / comma etc. now also require
    operator decision.
    */

    if (
      REQUIRES_USER_DECISION.has(code)
    ) {

      return {

        type:
          "decision",

        original:
          raw,

        reason:
          "This value is not an approved hourly load reading."

      };

    }


    /*
    Everything else requires correction.
    */

    return {

      type:
        "decision",

      original:
        raw,

      reason:
        "The value is not a recognized numeric reading or approved operational code."

    };

  }


  /*
  ===========================================================
  STYLES
  ===========================================================
  */

  function addStyles() {

    if (
      document.getElementById(
        "kedco-hourly-choice-style"
      )
    ) {
      return;
    }


    const style =
      document.createElement(
        "style"
      );


    style.id =
      "kedco-hourly-choice-style";


    style.textContent = `

      .kedco-hour-needs-correction {

        outline:
          3px solid
          #dc3545 !important;

        outline-offset:
          -2px;

        background:
          #fff0f1 !important;

        color:
          #8b101b !important;

        font-weight:
          900 !important;

      }


      .kedco-hour-choice-backdrop {

        position:
          fixed;

        inset:
          0;

        z-index:
          1000000;

        display:
          none;

        align-items:
          center;

        justify-content:
          center;

        padding:
          20px;

        background:
          rgba(
            3,
            17,
            32,
            .72
          );

        backdrop-filter:
          blur(5px);

      }


      .kedco-hour-choice-backdrop.open {

        display:
          flex;

      }


      .kedco-hour-choice-modal {

        width:
          min(
            560px,
            100%
          );

        max-height:
          calc(
            100vh - 40px
          );

        overflow:
          auto;

        border-radius:
          18px;

        background:
          #ffffff;

        color:
          #13243b;

        box-shadow:
          0 24px 80px
          rgba(
            0,
            0,
            0,
            .36
          );

        font-family:
          Inter,
          Segoe UI,
          Arial,
          sans-serif;

      }


      .kedco-hour-choice-head {

        padding:
          18px 20px;

        background:
          linear-gradient(
            135deg,
            #08284e,
            #0c4c7b
          );

        color:
          #fff;

      }


      .kedco-hour-choice-head h3 {

        margin:
          0 0 5px;

        font-size:
          18px;

      }


      .kedco-hour-choice-head p {

        margin:
          0;

        opacity:
          .86;

        font-size:
          12px;

      }


      .kedco-hour-choice-body {

        display:
          grid;

        gap:
          14px;

        padding:
          20px;

      }


      .kedco-hour-original {

        padding:
          12px;

        border:
          1px solid
          #f2b8bd;

        border-radius:
          10px;

        background:
          #fff4f5;

        font-size:
          12px;

      }


      .kedco-hour-original strong {

        display:
          block;

        margin-top:
          4px;

        font-size:
          18px;

        color:
          #9d1c28;

        word-break:
          break-word;

      }


      .kedco-hour-field {

        display:
          grid;

        gap:
          6px;

      }


      .kedco-hour-field label {

        font-size:
          11px;

        font-weight:
          900;

        color:
          #34465e;

      }


      .kedco-hour-field select,

      .kedco-hour-field input {

        width:
          100%;

        box-sizing:
          border-box;

        min-height:
          42px;

        padding:
          9px 11px;

        border:
          1px solid
          #bdc9d6;

        border-radius:
          9px;

        background:
          #fff;

        color:
          #10253f;

        font-size:
          13px;

        font-weight:
          700;

        outline:
          none;

      }


      .kedco-hour-field select:focus,

      .kedco-hour-field input:focus {

        border-color:
          #1677bd;

        box-shadow:
          0 0 0 3px
          rgba(
            22,
            119,
            189,
            .14
          );

      }


      .kedco-hour-numeric-panel {

        display:
          none;

        padding:
          12px;

        border:
          1px solid
          #bcd9ef;

        border-radius:
          10px;

        background:
          #f4faff;

      }


      .kedco-hour-numeric-panel.open {

        display:
          grid;

        gap:
          6px;

      }


      .kedco-hour-error {

        min-height:
          18px;

        color:
          #b42318;

        font-size:
          11px;

        font-weight:
          800;

      }


      .kedco-hour-choice-actions {

        display:
          flex;

        justify-content:
          flex-end;

        gap:
          8px;

        padding:
          14px 20px 18px;

        border-top:
          1px solid
          #e1e6eb;

      }


      .kedco-hour-choice-actions button {

        min-height:
          38px;

        padding:
          8px 16px;

        border:
          0;

        border-radius:
          9px;

        cursor:
          pointer;

        font-size:
          12px;

        font-weight:
          900;

      }


      .kedco-hour-cancel {

        background:
          #e8edf2;

        color:
          #26384d;

      }


      .kedco-hour-save {

        background:
          #087443;

        color:
          #fff;

      }


      .kedco-hour-save:hover {

        background:
          #056238;

      }

    `;


    document.head.appendChild(
      style
    );

  }


  /*
  ===========================================================
  MODAL
  ===========================================================
  */

  let activeInput =
    null;


  let originalValue =
    "";


  function buildModal() {

    let backdrop =
      document.getElementById(
        "kedcoHourlyChoice"
      );


    if (backdrop) {

      return backdrop;

    }


    backdrop =
      document.createElement(
        "div"
      );


    backdrop.id =
      "kedcoHourlyChoice";


    backdrop.className =
      "kedco-hour-choice-backdrop";


    backdrop.innerHTML = `

      <div
        class="kedco-hour-choice-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kedcoHourlyChoiceTitle">

        <div class="kedco-hour-choice-head">

          <h3 id="kedcoHourlyChoiceTitle">
            Hourly Reading Correction Required
          </h3>

          <p>
            Choose the correct operational group or enter the correct numeric MW reading.
          </p>

        </div>

        <div class="kedco-hour-choice-body">

          <div class="kedco-hour-original">

            Entered value

            <strong data-kedco-original-value>
              —
            </strong>

          </div>


          <div class="kedco-hour-field">

            <label>
              Correct value / classification
            </label>

            <select data-kedco-choice>

              <option value="">
                -- Select Correct Option --
              </option>

              <option value="NUMERIC">
                Numeric / Active MW Reading
              </option>

              <option value="LOAD SHEDDING">
                Load Shedding
              </option>

              <option value="FAULT / OUTAGE">
                Fault / Outage
              </option>

              <option value="BREAKER FAULT">
                Breaker Fault
              </option>

              <option value="PLANNED OUTAGE">
                Planned Outage
              </option>

              <option value="EMERGENCY OUTAGE">
                Emergency Outage
              </option>

              <option value="MAINTENANCE">
                Maintenance
              </option>

              <option value="TCN MAINTENANCE">
                TCN Maintenance
              </option>

              <option value="FREQUENCY CONTROL">
                Frequency Control
              </option>

            </select>

          </div>


          <div
            class="kedco-hour-numeric-panel"
            data-kedco-numeric-panel>

            <div class="kedco-hour-field">

              <label>
                Correct Load Reading (MW)
              </label>

              <input
                type="text"
                inputmode="decimal"
                autocomplete="off"
                data-kedco-numeric
                placeholder="Example: 4.5">

            </div>

            <small>
              Enter one valid number only, for example:
              0, 0.1, 4.5, 12.75.
            </small>

          </div>


          <div
            class="kedco-hour-error"
            data-kedco-error>
          </div>

        </div>


        <div class="kedco-hour-choice-actions">

          <button
            type="button"
            class="kedco-hour-cancel"
            data-kedco-cancel>

            Cancel

          </button>

          <button
            type="button"
            class="kedco-hour-save"
            data-kedco-save>

            Apply Correct Value

          </button>

        </div>

      </div>

    `;


    document.body.appendChild(
      backdrop
    );


    const choice =
      backdrop.querySelector(
        "[data-kedco-choice]"
      );


    const numericPanel =
      backdrop.querySelector(
        "[data-kedco-numeric-panel]"
      );


    const numericInput =
      backdrop.querySelector(
        "[data-kedco-numeric]"
      );


    const error =
      backdrop.querySelector(
        "[data-kedco-error]"
      );


    choice.addEventListener(
      "change",
      function () {

        const numeric =
          choice.value ===
          "NUMERIC";


        numericPanel.classList.toggle(
          "open",
          numeric
        );


        error.textContent =
          "";


        if (numeric) {

          setTimeout(
            () =>
              numericInput.focus(),
            20
          );

        }

      }
    );


    backdrop
      .querySelector(
        "[data-kedco-save]"
      )
      .addEventListener(
        "click",
        applyChoice
      );


    backdrop
      .querySelector(
        "[data-kedco-cancel]"
      )
      .addEventListener(
        "click",
        function () {

          /*
          Cancel does NOT classify the value.
          It remains visibly marked red until corrected.
          */

          closeModal();

          if (activeInput) {

            activeInput.classList.add(
              "kedco-hour-needs-correction"
            );

          }

        }
      );


    numericInput.addEventListener(
      "keydown",
      function (event) {

        if (
          event.key === "Enter"
        ) {

          event.preventDefault();

          applyChoice();

        }

      }
    );


    return backdrop;

  }


  function openCorrection(
    input,
    raw
  ) {

    if (
      !input
    ) {
      return;
    }


    activeInput =
      input;


    originalValue =
      String(
        raw ?? input.value ?? ""
      ).trim();


    input.classList.add(
      "kedco-hour-needs-correction"
    );


    const modal =
      buildModal();


    modal
      .querySelector(
        "[data-kedco-original-value]"
      )
      .textContent =
        originalValue || "(blank)";


    const choice =
      modal.querySelector(
        "[data-kedco-choice]"
      );


    const numeric =
      modal.querySelector(
        "[data-kedco-numeric]"
      );


    const numericPanel =
      modal.querySelector(
        "[data-kedco-numeric-panel]"
      );


    const error =
      modal.querySelector(
        "[data-kedco-error]"
      );


    choice.value =
      "";


    numeric.value =
      originalValue;


    error.textContent =
      "";


    numericPanel.classList.remove(
      "open"
    );


    /*
    If it looks like the operator was trying to type a
    number, automatically select Numeric so correction is
    faster.

    Example:
       4..5.0
       5..2
       4.5.0

    We DO NOT guess the correct number.
    */

    if (
      /^[0-9.,+\-\s]+$/
        .test(originalValue)
    ) {

      choice.value =
        "NUMERIC";


      numericPanel.classList.add(
        "open"
      );

    }


    modal.classList.add(
      "open"
    );


    setTimeout(
      function () {

        if (
          choice.value ===
          "NUMERIC"
        ) {

          numeric.focus();

          numeric.select();

        }
        else {

          choice.focus();

        }

      },
      30
    );

  }


  function closeModal() {

    const modal =
      document.getElementById(
        "kedcoHourlyChoice"
      );


    modal?.classList.remove(
      "open"
    );

  }


  /*
  ===========================================================
  SAVE USER SELECTION
  ===========================================================
  */

  function applyChoice() {

    if (
      !activeInput
    ) {
      return;
    }


    const modal =
      buildModal();


    const choice =
      modal.querySelector(
        "[data-kedco-choice]"
      );


    const numeric =
      modal.querySelector(
        "[data-kedco-numeric]"
      );


    const error =
      modal.querySelector(
        "[data-kedco-error]"
      );


    const selected =
      choice.value;


    if (!selected) {

      error.textContent =
        "Please choose the correct classification or Numeric / Active MW Reading.";

      return;

    }


    let correctedValue =
      "";


    let group =
      "";


    /*
    NUMERIC / ACTIVE
    */

    if (
      selected ===
      "NUMERIC"
    ) {

      const parsed =
        parseNumeric(
          numeric.value
        );


      if (
        !parsed.valid
      ) {

        error.textContent =
          "Invalid numeric reading. Enter one valid value, for example 4.5 — not 4..5.0.";

        numeric.focus();

        numeric.select();

        return;

      }


      correctedValue =
        parsed.value;


      group =
        "ACTIVE";

    }
    else {

      /*
      Approved operational group.
      */

      if (
        !CANONICAL_GROUPS.has(
          selected
        )
      ) {

        error.textContent =
          "Please select an approved operational group.";

        return;

      }


      correctedValue =
        selected;


      group =
        selected;

    }


    const target =
      activeInput;


    target.dataset.kedcoOriginalCode =
      originalValue;


    target.dataset.kedcoHourGroup =
      group;


    target.value =
      correctedValue;


    target.classList.remove(
      "kedco-hour-needs-correction"
    );


    target.title =

      group === "ACTIVE"

        ? `Active numeric reading: ${correctedValue} MW`

        : `Classification: ${group}`;


    closeModal();


    activeInput =
      null;


    /*
    Notify existing KEDCO Local Cloud autosave logic.
    */

    target.dispatchEvent(
      new Event(
        "input",
        {
          bubbles:
            true
        }
      )
    );


    target.dispatchEvent(
      new Event(
        "change",
        {
          bubbles:
            true
        }
      )
    );


    target.focus();

  }


  /*
  ===========================================================
  APPLY KNOWN VALUE
  ===========================================================
  */

  function applyKnown(
    input,
    result
  ) {

    if (
      !input ||
      !result
    ) {
      return;
    }


    const previous =
      String(
        input.value ?? ""
      );


    if (
      result.original &&
      result.original !==
        result.value
    ) {

      input.dataset.kedcoOriginalCode =
        result.original;

    }


    if (
      result.group
    ) {

      input.dataset.kedcoHourGroup =
        result.group;

    }


    input.classList.remove(
      "kedco-hour-needs-correction"
    );


    input.value =
      result.value;


    if (
      result.group ===
      "ACTIVE"
    ) {

      input.title =
        `Active numeric reading: ${result.value} MW`;

    }
    else {

      input.title =
        `Classification: ${result.group}`;

    }


    return (
      previous !==
      result.value
    );

  }


  /*
  ===========================================================
  VALIDATE ONE CELL
  ===========================================================
  */

  function validateInput(
    input,
    {
      interactive =
        true,

      notify =
        true
    } = {}
  ) {

    if (
      !input?.matches?.(
        SELECTOR
      )
    ) {

      return true;

    }


    const result =
      classify(
        input.value
      );


    if (
      result.type ===
      "blank"
    ) {

      input.classList.remove(
        "kedco-hour-needs-correction"
      );

      return true;

    }


    if (
      result.type ===
        "numeric" ||

      result.type ===
        "group"
    ) {

      const changed =
        applyKnown(
          input,
          result
        );


      if (
        changed &&
        notify
      ) {

        input.dispatchEvent(
          new Event(
            "input",
            {
              bubbles:
                true
            }
          )
        );

      }


      return true;

    }


    /*
    Unknown / N/A / NIL / malformed numeric.

    NO UNCLASSIFIED.
    NO IGNORED.
    */

    input.classList.add(
      "kedco-hour-needs-correction"
    );


    input.title =
      "Correction required: choose approved group or enter a valid numeric MW reading.";


    if (
      interactive
    ) {

      openCorrection(
        input,
        result.original
      );

    }


    return false;

  }


  /*
  ===========================================================
  EVENT HANDLING
  ===========================================================
  */

  document.addEventListener(

    "change",

    function (event) {

      const target =
        event.target;


      if (
        !target?.matches?.(
          SELECTOR
        )
      ) {

        return;

      }


      const valid =
        validateInput(
          target,
          {
            interactive:
              true,

            notify:
              true
          }
        );


      /*
      Prevent invalid value reaching later change listeners.
      */

      if (!valid) {

        event.preventDefault();

        event.stopImmediatePropagation();

      }

    },

    true

  );


  /*
  Enter key:
  validate immediately.
  */

  document.addEventListener(

    "keydown",

    function (event) {

      const target =
        event.target;


      if (
        event.key !== "Enter" ||
        !target?.matches?.(
          SELECTOR
        )
      ) {

        return;

      }


      const valid =
        validateInput(
          target,
          {
            interactive:
              true,

            notify:
              true
          }
        );


      if (!valid) {

        event.preventDefault();

        event.stopImmediatePropagation();

      }

    },

    true

  );


  /*
  Paste:
  wait until browser has placed the pasted value,
  then immediately inspect it.
  */

  document.addEventListener(

    "paste",

    function (event) {

      const target =
        event.target;


      if (
        !target?.matches?.(
          SELECTOR
        )
      ) {

        return;

      }


      setTimeout(
        function () {

          validateInput(
            target,
            {
              interactive:
                true,

              notify:
                true
            }
          );

        },
        0
      );

    },

    true

  );


  /*
  If a previously-marked bad cell is clicked again,
  reopen correction dialog.
  */

  document.addEventListener(

    "dblclick",

    function (event) {

      const target =
        event.target;


      if (
        target?.matches?.(
          SELECTOR
        ) &&
        target.classList.contains(
          "kedco-hour-needs-correction"
        )
      ) {

        openCorrection(
          target,
          target.value
        );

      }

    },

    true

  );


  /*
  ===========================================================
  INITIAL / DYNAMIC FORM SCAN

  Known old abbreviations are displayed using their group.

  Unknown historical values are highlighted red but we do
  not automatically interrupt the operator on page load.
  ===========================================================
  */

  function scan() {

    document
      .querySelectorAll(
        SELECTOR
      )
      .forEach(
        input => {

          const raw =
            String(
              input.value ?? ""
            ).trim();


          if (!raw) {
            return;
          }


          validateInput(
            input,
            {
              interactive:
                false,

              notify:
                false
            }
          );

        }
      );

  }


  let scanTimer;


  function scheduleScan() {

    clearTimeout(
      scanTimer
    );


    scanTimer =
      setTimeout(
        scan,
        100
      );

  }


  function start() {

    addStyles();

    buildModal();

    scan();


    const observer =
      new MutationObserver(
        scheduleScan
      );


    observer.observe(
      document.body,
      {
        childList:
          true,

        subtree:
          true
      }
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
        once:
          true
      }
    );

  }
  else {

    start();

  }


  /*
  Public API.
  */

  window.KEDCO_HOURLY_CODES = {

    classify,

    validateInput,

    groups:
      GROUP

  };


  console.info(
    "KEDCO Hourly Reading Normalizer V2 active"
  );

})();
