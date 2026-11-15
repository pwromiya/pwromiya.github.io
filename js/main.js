(function () {
  var root = document.documentElement;
  var titleNode = document.getElementById("doc-title");
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  var themeButton = document.getElementById("theme-toggle");
  var header = document.querySelector(".site-header");

  var titles = {
    ru: "Роман Кошеленко — разработчик игр",
    en: "Roman Koshelenko — game developer"
  };

  var chromeUi = {
    ru: {
      themeDark: "Включить светлую тему",
      themeLight: "Включить тёмную тему"
    },
    en: {
      themeDark: "Switch to light theme",
      themeLight: "Switch to dark theme"
    }
  };

  function lang() {
    return root.lang === "en" ? "en" : "ru";
  }

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme === "light" ? "light" : "dark");
    if (themeMeta) {
      themeMeta.setAttribute("content", theme === "light" ? "#e3e3e3" : "#1d1d1d");
    }
    syncChrome();
  }

  function applyLang(next) {
    root.lang = next === "en" ? "en" : "ru";
    if (titleNode) {
      document.title = titles[lang()];
      titleNode.textContent = document.title;
    }
    document.querySelectorAll("[data-set-lang]").forEach(function (button) {
      button.setAttribute("aria-pressed", button.getAttribute("data-set-lang") === lang() ? "true" : "false");
    });
    syncChrome();
  }

  function syncChrome() {
    if (!themeButton) return;
    var dark = root.getAttribute("data-theme") !== "light";
    themeButton.setAttribute("aria-label", dark ? chromeUi[lang()].themeDark : chromeUi[lang()].themeLight);
    themeButton.setAttribute("aria-pressed", dark ? "true" : "false");
  }

  if (themeButton) {
    themeButton.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      localStorage.setItem("theme", next);
      applyTheme(next);
    });
  }

  document.querySelectorAll("[data-set-lang]").forEach(function (button) {
    button.addEventListener("click", function () {
      var next = button.getAttribute("data-set-lang");
      localStorage.setItem("lang", next);
      applyLang(next);
    });
  });

  var media = window.matchMedia("(prefers-color-scheme: light)");
  if (media.addEventListener) {
    media.addEventListener("change", function (event) {
      if (!localStorage.getItem("theme")) {
        applyTheme(event.matches ? "light" : "dark");
      }
    });
  }

  function onScroll() {
    if (header) header.classList.toggle("is-stuck", window.scrollY > 8);
  }
  onScroll();
  document.addEventListener("scroll", onScroll, { passive: true });

  document.querySelectorAll(".menu a").forEach(function (link) {
    link.addEventListener("click", function () {
      var menu = link.closest("details");
      if (menu) menu.open = false;
    });
  });

  function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-999px";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy") ? resolve() : reject();
      } catch (error) {
        reject(error);
      } finally {
        area.remove();
      }
    });
  }

  document.querySelectorAll(".copy").forEach(function (button) {
    button.addEventListener("click", function () {
      var value = button.getAttribute("data-copy") || "";
      copyText(value).then(function () {
        button.classList.add("is-done");
        window.setTimeout(function () {
          button.classList.remove("is-done");
        }, 1800);
      }).catch(function () {
        window.location.href = "mailto:" + value;
      });
    });
  });

  applyLang(lang());
  applyTheme(root.getAttribute("data-theme") || "dark");
})();
