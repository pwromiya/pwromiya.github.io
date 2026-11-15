(function () {
  var root = document.documentElement;
  var titleNode = document.getElementById("doc-title");
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  var themeButton = document.getElementById("theme-toggle");
  var header = document.querySelector(".site-header");
  var form = document.getElementById("contact-form");
  var statusNode = document.getElementById("form-status");
  var started = document.getElementById("started");
  var langField = document.getElementById("lang-field");

  var titles = {
    ru: "Роман Кошеленко — разработчик игр",
    en: "Roman Koshelenko — game developer"
  };

  var formUi = {
    ru: {
      need: "Заполните имя, почту и сообщение.",
      email: "Почта выглядит неполной.",
      sending: "Отправляю…",
      sent: "Сообщение отправлено. Отвечу на указанную почту.",
      fallback: "Форма не дошла до хостинга. Открыл письмо в почтовой программе.",
      themeDark: "Включить светлую тему",
      themeLight: "Включить тёмную тему"
    },
    en: {
      need: "Add your name, email, and a message.",
      email: "That email looks incomplete.",
      sending: "Sending…",
      sent: "Message sent. I will reply to the email you left.",
      fallback: "The form did not reach the host. I opened a letter in your mail app.",
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
    if (langField) langField.value = lang();
    document.querySelectorAll("[data-set-lang]").forEach(function (button) {
      button.setAttribute("aria-pressed", button.getAttribute("data-set-lang") === lang() ? "true" : "false");
    });
    syncChrome();
  }

  function syncChrome() {
    if (!themeButton) return;
    var dark = root.getAttribute("data-theme") !== "light";
    themeButton.setAttribute("aria-label", dark ? formUi[lang()].themeDark : formUi[lang()].themeLight);
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

  function setStatus(text, kind) {
    if (!statusNode) return;
    statusNode.textContent = text;
    statusNode.classList.remove("is-error", "is-ok");
    if (kind) statusNode.classList.add(kind);
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function mailtoFallback(name, email, message) {
    var href = "mailto:pwromiya.dev@gmail.com"
      + "?subject=" + encodeURIComponent("Portfolio: " + name)
      + "&body=" + encodeURIComponent(message + "\n\n— " + name + "\n" + email);
    window.location.href = href;
  }

  if (started) started.value = String(Date.now());
  applyLang(lang());
  applyTheme(root.getAttribute("data-theme") || "dark");

  if (!form) return;

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var data = new FormData(form);
    var name = String(data.get("name") || "").trim();
    var email = String(data.get("email") || "").trim();
    var message = String(data.get("message") || "").trim();
    var ui = formUi[lang()];

    if (!name || !email || !message) {
      setStatus(ui.need, "is-error");
      return;
    }
    if (!validEmail(email)) {
      setStatus(ui.email, "is-error");
      return;
    }

    var submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    setStatus(ui.sending, "");

    fetch("send.php", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: data
    }).then(function (response) {
      return response.json().then(function (payload) {
        return { ok: response.ok, status: response.status, payload: payload };
      });
    }).then(function (result) {
      if (result.ok && result.payload && result.payload.ok) {
        form.reset();
        if (started) started.value = String(Date.now());
        if (langField) langField.value = lang();
        setStatus(result.payload.message || ui.sent, "is-ok");
        return;
      }
      if (result.status >= 400 && result.status < 500 && result.payload && result.payload.message) {
        setStatus(result.payload.message, "is-error");
        return;
      }
      setStatus(ui.fallback, "is-error");
      mailtoFallback(name, email, message);
    }).catch(function () {
      setStatus(ui.fallback, "is-error");
      mailtoFallback(name, email, message);
    }).finally(function () {
      if (submit) submit.disabled = false;
    });
  });
})();
