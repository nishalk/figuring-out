(() => {
  const media = matchMedia("(prefers-color-scheme: dark)");
  let preference = "system";
  try {
    const saved = localStorage.getItem("relay-appearance");
    if (["system", "light", "dark"].includes(saved)) preference = saved;
  } catch {}
  const apply = () => {
    document.documentElement.dataset.theme =
      preference === "system" ? (media.matches ? "dark" : "light") : preference;
    document.documentElement.style.colorScheme =
      document.documentElement.dataset.theme;
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
