document.addEventListener("click", (e) => {
  const tab = e.target.closest(".shrmis-tab");
  if (!tab) return;

  e.preventDefault();

  // FIX: Walk up to find the closest container that holds both tabs AND panels.
  // Try .shrmis-profile-page first, then .shrmis-grid, then fall back to document.
  const root =
    tab.closest(".shrmis-profile-page") ||
    tab.closest(".shrmis-grid") ||
    document;

  const target = tab.dataset.target || tab.getAttribute("href");
  if (!target) return;

  const panelId = target.startsWith("#") ? target.slice(1) : target;

  // Deactivate all tabs within the same tabs-bar only
  const tabsBar = tab.closest(".shrmis-tabs");
  if (tabsBar) {
    tabsBar
      .querySelectorAll(".shrmis-tab")
      .forEach((t) => t.classList.remove("is-active"));
  } else {
    root
      .querySelectorAll(".shrmis-tab")
      .forEach((t) => t.classList.remove("is-active"));
  }
  tab.classList.add("is-active");

  // Deactivate all panels within the same root scope
  root
    .querySelectorAll(".shrmis-tabPanel")
    .forEach((p) => p.classList.remove("is-active"));

  // Activate the target panel
  const panel = root.querySelector(`#${panelId}`);
  if (panel) {
    panel.classList.add("is-active");
  } else {
    // Fallback: search entire document if not found in root
    const panelFallback = document.getElementById(panelId);
    if (panelFallback) panelFallback.classList.add("is-active");
  }

  // Keep URL hash in sync
  history.replaceState(null, "", `#${panelId}`);
});

// On page load: activate the tab matching the URL hash (if any)
document.addEventListener("DOMContentLoaded", () => {
  const hash = window.location.hash;
  if (!hash) return;
  const panelId = hash.slice(1);
  const panel = document.getElementById(panelId);
  if (!panel || !panel.classList.contains("shrmis-tabPanel")) return;

  // Deactivate all panels & tabs first
  document
    .querySelectorAll(".shrmis-tabPanel")
    .forEach((p) => p.classList.remove("is-active"));
  document
    .querySelectorAll(".shrmis-tab")
    .forEach((t) => t.classList.remove("is-active"));

  // Activate matching panel & its tab
  panel.classList.add("is-active");
  const matchingTab = document.querySelector(
    `.shrmis-tab[data-target="#${panelId}"], .shrmis-tab[href="#${panelId}"]`,
  );
  if (matchingTab) matchingTab.classList.add("is-active");
});
