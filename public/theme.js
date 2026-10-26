(() => {
  const media = matchMedia("(prefers-color-scheme: dark)");
  let preference = "system";
  try {
    const saved = localStorage.getItem("relay-appearance");
    if (["system", "light", "dark"].includes(saved)) preference = saved;
  } catch {}
  const palettes = {
    midnight: {
      name: "Midnight Burgundy",
      accent: "#D99AC7",
      background: "#09080C",
    },
    orchid: {
      name: "Electric Orchid",
      accent: "#C3A0FF",
      background: "#100B1C",
    },
    cream: {
      name: "Mawada Signature",
      accent: "#DDA9CF",
      background: "#231321",
    },
  };
  let palette = "midnight",
    custom = {};
  try {
    const saved = JSON.parse(localStorage.getItem("mawada-palette") || "{}");
    if (palettes[saved.palette]) palette = saved.palette;
    custom = saved.custom || {};
  } catch {}
  const apply = () => {
    document.documentElement.dataset.theme =
      preference === "system" ? (media.matches ? "dark" : "light") : preference;
    document.documentElement.style.colorScheme =
      document.documentElement.dataset.theme;
    const root = document.documentElement;
    root.dataset.palette = palette;
    const colours = { ...custom };
    for (const [key, variable] of Object.entries({
      accent: "--accent",
      background: "--bg",
    })) {
      root.style.removeProperty(variable);
      if (/^#[0-9a-f]{6}$/i.test(colours[key] || ""))
        root.style.setProperty(variable, colours[key]);
    }
    root.dataset.motion = custom.motion === false ? "off" : "on";
  };
  window.MawadaTheme = {
    palettes,
    get: () => ({ palette, custom: { ...custom }, preference }),
    set: (next) => {
      if (palettes[next.palette]) palette = next.palette;
      if (next.custom) custom = next.custom;
      if (["system", "light", "dark"].includes(next.preference))
        preference = next.preference;
      try {
        localStorage.setItem(
          "mawada-palette",
          JSON.stringify({ palette, custom }),
        );
        localStorage.setItem("relay-appearance", preference);
      } catch {}
      apply();
      const select = document.querySelector("#themeSelect");
      if (select) select.value = preference;
    },
  };
  apply();
  media.addEventListener("change", apply);
  document.addEventListener("DOMContentLoaded", () => {
    const select = document.querySelector("#themeSelect");
    select.value = preference;
    select.addEventListener("change", () => {
      preference = select.value;
      try {
        localStorage.setItem("relay-appearance", preference);
      } catch {}
      apply();
    });
  });
})();
