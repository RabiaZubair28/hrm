/** @odoo-module **/

import publicWidget from "@web/legacy/js/public/public_widget";

const _LOG = (...args) => console.log("[HRMIS_OTHER]", ...args);

function _norm(str) {
  return (str || "").toString().trim().toLowerCase();
}

function _ensureOtherOption(selectEl) {
  if (!selectEl) return null;
  const has = Array.from(selectEl.options).some((o) => o.value === "__other__");
  if (!has) {
    const opt = document.createElement("option");
    opt.value = "__other__";
    opt.textContent = "Other";
    selectEl.appendChild(opt);
    _LOG("Injected missing __other__ option:", selectEl.name || selectEl);
  }
  return Array.from(selectEl.options).find((o) => o.value === "__other__") || null;
}

function _computeOtherInputName(selectEl) {
  const explicit = selectEl.dataset.otherName;
  if (explicit) return explicit;

  const n = selectEl.getAttribute("name") || "other";
  if (n.endsWith("[]")) return n.slice(0, -2) + "_other[]";
  return n + "_other";
}

function _getOrCreateOtherWrap(selectEl) {
  const field = selectEl.closest(".hrmis-field");
  if (!field) return null;

  let wrap = field.querySelector(".js-other-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "js-other-wrap";
    wrap.style.cssText = "display:none; margin-top:6px;";
    field.appendChild(wrap);
  }

  let input = wrap.querySelector(".js-other-input");
  if (!input) {
    input = document.createElement("input");
    input.className = "hrmis-input js-other-input";
    input.type = "text";
    input.name = _computeOtherInputName(selectEl);
    input.placeholder = "Enter value";
    wrap.appendChild(input);
  }
  return { wrap, input };
}

function _toggleOther(selectEl) {
  const pair = _getOrCreateOtherWrap(selectEl);
  if (!pair) return;

  const isOther = selectEl.value === "__other__";
  pair.wrap.style.display = isOther ? "block" : "none";
  pair.input.disabled = !isOther;

  pair.input.required = !!isOther;   // ALWAYS required if Other selected

  if (!isOther) pair.input.value = "";
}

function _syncSubmittedOtherDisplay(selectEl) {
  const pair = _getOrCreateOtherWrap(selectEl);
  if (!pair) return;

  const otherOpt = _ensureOtherOption(selectEl);
  const isOther = selectEl.value === "__other__";
  const otherValue = (pair.input.value || "").trim();

  if (isOther && otherOpt && otherValue) {
    otherOpt.textContent = otherValue;
  }

  pair.wrap.style.display = "none";
  pair.input.disabled = true;
  pair.input.required = false;
}

function _injectSearch(selectEl) {
  const enabled = selectEl.dataset.enableSearch === "1";
  if (!enabled) return null;

  const field = selectEl.closest(".hrmis-field");
  if (!field) return null;

  // prevent duplicates
  if (field.querySelector(".js-select-search")) return null;

  const search = document.createElement("input");
  search.type = "text";
  search.className = "hrmis-input js-select-search";
  search.placeholder = "Search…";
  search.autocomplete = "off";
  search.style.marginBottom = "6px";

  // Insert right before select
  selectEl.parentNode.insertBefore(search, selectEl);

  // Cache original options (clone)
  const originalOptions = Array.from(selectEl.options).map((o) => ({
    value: o.value,
    text: o.textContent || "",
    disabled: o.disabled,
    hidden: o.hidden,
    selected: o.selected,
    // keep dataset attrs if any
    dataset: { ...o.dataset },
  }));


  const rebuild = (q) => {
    const query = _norm(q);
    const otherOpt = originalOptions.find((o) => o.value === "__other__") || { value: "__other__", text: "Other" };

    // keep placeholder (first disabled/hidden option OR empty-value option)
    const placeholder =
      originalOptions.find((o) => o.disabled && (o.hidden || o.value === "")) ||
      originalOptions.find((o) => o.value === "") ||
      null;

    const matches = originalOptions.filter((o) => {
      if (!o.value || o.disabled) return false; // skip placeholder
      if (o.value === "__other__") return false;
      return _norm(o.text).includes(query);
    });

    // Clear and rebuild
    selectEl.innerHTML = "";

    if (placeholder) {
      const ph = document.createElement("option");
      ph.value = placeholder.value || "";
      ph.disabled = true;
      ph.hidden = true;
      ph.textContent = placeholder.text || "Select";
      // keep placeholder selected if nothing chosen
      ph.selected = !selectEl.value;
      selectEl.appendChild(ph);
    }

    if (query && matches.length === 0) {
      // No matches -> show only Other (no matches)
      const o = document.createElement("option");
      o.value = "__other__";
      o.textContent = "Other (no matches)";
      selectEl.appendChild(o);
      _LOG("No matches. Showing Other (no matches) for", selectEl.name || selectEl);
      return;
    }

    // Normal matches or full list (if query empty)
    const toRender = query ? matches : originalOptions.filter((o) => !o.disabled && o.value && o.value !== "__other__");

    for (const item of toRender) {
      const opt = document.createElement("option");
      opt.value = item.value;
      opt.textContent = item.text;
      // restore datasets (district filters etc.)
      Object.assign(opt.dataset, item.dataset || {});
      selectEl.appendChild(opt);
    }

    // Always keep Other at bottom
    const other = document.createElement("option");
    other.value = "__other__";
    other.textContent = otherOpt.text || "Other";
    selectEl.appendChild(other);
  };

  search.addEventListener("input", (ev) => rebuild(ev.target.value));
  return search;
}

publicWidget.registry.HrmisOtherOption = publicWidget.Widget.extend({
  selector: "#profile_update_form",

  events: {
    "change select.js-other-select": "_onSelectChange",
    "change select": "_onSelectChangeFallback",
  },

  start() {
    const isSubmittedView = this.el.classList.contains("is-submitted");

    const selects = this.el.querySelectorAll("select.js-other-select");

    selects.forEach((sel) => {
      _ensureOtherOption(sel);
      if (isSubmittedView) {
        _syncSubmittedOtherDisplay(sel);
      } else {
        _toggleOther(sel); // initial state
      }
    });

    return this._super(...arguments);
  },

  _onSelectChange(ev) {
    const sel = ev.currentTarget;
    _toggleOther(sel);
  },

  // in case some selects missed class, this still won’t break anything
  _onSelectChangeFallback(ev) {
    const sel = ev.currentTarget;
    if (!sel.classList.contains("js-other-select")) return;
    _toggleOther(sel);
  },
});

