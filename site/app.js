(function () {
  var root = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  function store(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {}
  }
  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  var themeBtn = document.getElementById("theme");
  var themeNames = { system: "follow system", paper: "Paper", dark: "Dark" };
  var shotButtons = document.querySelectorAll("[data-shot]");

  function currentTheme() {
    return root.dataset.theme || "system";
  }
  function effectiveTheme() {
    var t = currentTheme();
    if (t !== "system") return t;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "paper";
  }
  function setTheme(t) {
    if (t === "system") delete root.dataset.theme;
    else root.dataset.theme = t;
    store("hongsasub-theme", t === "system" ? null : t);
    syncTheme();
  }
  function syncTheme() {
    themeBtn.setAttribute("aria-label", "Appearance: " + themeNames[currentTheme()] + ". Change appearance");
    var eff = effectiveTheme();
    shotButtons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.shot === eff)); });
  }
  themeBtn.addEventListener("click", function () {
    var order = ["system", "paper", "dark"];
    setTheme(order[(order.indexOf(currentTheme()) + 1) % order.length]);
  });
  shotButtons.forEach(function (b) {
    b.addEventListener("click", function () { setTheme(b.dataset.shot); });
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);
  syncTheme();

  var osButtons = document.querySelectorAll("[data-os]");
  function setOS(os) {
    document.querySelectorAll("kbd[data-mac]").forEach(function (k) {
      k.textContent = os === "mac" ? k.dataset.mac : k.dataset.pc;
    });
    osButtons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.os === os)); });
  }
  osButtons.forEach(function (b) {
    b.addEventListener("click", function () { setOS(b.dataset.os); });
  });
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  setOS(isMac ? "mac" : "pc");

  if (!isMac && /Win/.test(navigator.platform || navigator.userAgent)) {
    var macDl = document.querySelector('.dl-row [data-dl="mac"]');
    var winDl = document.querySelector('.dl-row [data-dl="win"]');
    if (macDl && winDl) {
      macDl.classList.remove("btn--primary");
      winDl.classList.add("btn--primary");
      winDl.parentNode.insertBefore(winDl, macDl);
    }
  }

  if (!isMac && /Linux/.test(navigator.platform || navigator.userAgent) && !/Android/.test(navigator.userAgent)) {
    var firstDl = document.querySelector('.dl-row [data-dl="mac"]');
    var linuxDl = document.querySelector('.dl-row [data-dl="linux"]');
    if (firstDl && linuxDl) {
      firstDl.classList.remove("btn--primary");
      linuxDl.classList.add("btn--primary");
      linuxDl.hidden = false;
      linuxDl.parentNode.insertBefore(linuxDl, firstDl);
    }
  }

  document.querySelectorAll("[data-video]").forEach(function (box) {
    var poster = box.querySelector(".video__poster");
    if (!poster) return;
    poster.addEventListener("click", function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      var frame = document.createElement("iframe");
      frame.src = "https://www.youtube-nocookie.com/embed/" + box.dataset.video + "?autoplay=1&rel=0&playsinline=1";
      frame.title = "HongsaSub promo video";
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      box.replaceChild(frame, poster);
      frame.focus();
    });
  });

  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.dataset.copy;
      var done = function () {
        btn.classList.add("is-done");
        setTimeout(function () { btn.classList.remove("is-done"); }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(text); done(); });
      } else {
        fallback(text);
        done();
      }
    });
  });
  function fallback(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
  }

  var live = document.getElementById("live");
  if (!live) return;
  var el = {
    en: live.querySelector("[data-en]"),
    src: live.querySelector("[data-src]"),
    mon: live.querySelector("[data-mon]"),
    score: live.querySelector("[data-score]"),
    tags: live.querySelector("[data-tags]"),
    tc: live.querySelector("[data-tc]"),
    pill: live.querySelector("[data-pill]"),
    hint: live.querySelector("[data-hint]"),
    ghost: live.querySelector("[data-ghost-text]"),
    apply: live.querySelector('[data-act="apply"]'),
    confirm: live.querySelector('[data-act="confirm"]'),
    rows: document.getElementById("rows"),
    count: document.querySelector("[data-count]"),
    toggle: document.getElementById("demo-toggle")
  };

  var lines = [
    {
      tc: "0:00:18.40",
      en: "I hate this town!",
      keep: "I hate this town!",
      drop: "I hate this life!",
      score: 74,
      tags: ["Same scene", "This film"],
      match: "အဲဍုဟ်ဍုၚ်ဏံကွေံ!",
      extra: "အဲဍုဟ်ဘဝအဲဏံကွေံ!",
      found: "Memory found a 74% match from the same scene."
    },
    {
      tc: "0:01:24.06",
      en: "Itomori, the Town that Vanished",
      keep: "Itomori, the Town that Vanished",
      drop: "",
      score: 100,
      tags: ["This film"],
      match: "အိထဵုမဵုရိ, ဍုၚ်သုန်ဂြံ ကၠေံဗ္ဒမ်အာ",
      extra: "",
      found: "An exact match. You translated this line before.",
      bump: "itomori"
    },
    {
      tc: "0:00:02.90",
      en: "What? Who's it from?",
      keep: "What? Who's it from?",
      drop: "Tsukasa? Who's that?",
      score: 62,
      tags: ["Same scene"],
      match: "မု? နူညးဂှ်ရော?",
      extra: "Tsukasa ဟာ? ညးဂှ်ရော?",
      found: "Memory found a 62% match from the same scene."
    }
  ];

  var index = 0;
  var step = 0;
  var timers = [];
  var auto = !reduce.matches;
  var userPaused = false;
  var inView = false;
  var autoTimer = null;

  function later(fn, ms) {
    var id = setTimeout(fn, reduce.matches ? 0 : ms);
    timers.push(id);
    return id;
  }
  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }
  function text(node, value) { node.textContent = value; }
  function setPill(kind, label) {
    el.pill.className = "pill" + (kind ? " is-" + kind : "");
    text(el.pill.querySelector("span"), label);
  }

  function load(i, animate) {
    var line = lines[i];
    step = 0;
    live.dataset.step = "0";
    text(el.tc, line.tc);
    text(el.en, line.en);
    el.src.innerHTML = "";
    el.src.appendChild(document.createTextNode(line.keep));
    if (line.drop) {
      var d = document.createElement("del");
      d.textContent = line.drop;
      el.src.appendChild(document.createTextNode(" "));
      el.src.appendChild(d);
    }
    el.mon.textContent = "";
    text(el.ghost, line.extra ? line.match + " " + line.extra : line.match);
    text(el.score, line.score + "%");
    el.score.classList.toggle("score--exact", line.score === 100);
    el.tags.innerHTML = "";
    line.tags.forEach(function (t) {
      var s = document.createElement("span");
      s.className = "tag";
      s.textContent = t;
      el.tags.appendChild(s);
    });
    setPill("", "Untranslated");
    text(el.hint, line.found);
    el.apply.disabled = false;
    el.confirm.disabled = true;
    if (animate && !reduce.matches) {
      live.classList.remove("is-arriving");
      void live.offsetWidth;
      live.classList.add("is-arriving");
    }
  }

  function apply() {
    if (step !== 0) return;
    var line = lines[index];
    step = 1;
    live.dataset.step = "1";
    el.apply.disabled = true;
    el.confirm.disabled = false;
    setPill("draft", "Draft");
    el.mon.innerHTML = "";
    el.mon.appendChild(document.createTextNode(line.match));
    if (line.extra) {
      var gap = document.createTextNode(" ");
      var cut = document.createElement("del");
      cut.textContent = line.extra;
      el.mon.appendChild(gap);
      el.mon.appendChild(cut);
      text(el.hint, "Applied as a draft. Delete what the new line does not say…");
      later(function () {
        gap.remove();
        cut.remove();
        text(el.hint, "Draft ready. Confirm to keep it in memory.");
      }, 1100);
    } else {
      text(el.hint, "Applied as a draft. Confirm to keep it.");
    }
  }

  function confirm() {
    if (step !== 1) return;
    clearTimers();
    var line = lines[index];
    var cut = el.mon.querySelector("del");
    if (cut) {
      if (cut.previousSibling && cut.previousSibling.nodeType === 3 && cut.previousSibling.textContent === " ") cut.previousSibling.remove();
      cut.remove();
    }
    step = 2;
    live.dataset.step = "2";
    el.confirm.disabled = true;
    setPill("done", "Confirmed");
    var key = line.bump || "line-" + index;
    var existing = el.rows.querySelector('[data-key="' + key + '"]');
    if (existing) {
      var used = existing.querySelector("[data-used]");
      var times = (parseInt(existing.dataset.times || "1", 10) || 1) + 1;
      existing.dataset.times = String(times);
      if (used) used.textContent = "used " + times + " times";
      existing.classList.remove("is-bumped", "is-new");
      void existing.offsetWidth;
      existing.classList.add("is-bumped");
      text(el.hint, "Confirmed. The memory now knows you used this line " + times + " times.");
    } else {
      addRow(line, key);
      var n = parseInt(el.count.textContent, 10) + 1;
      el.count.textContent = String(n);
      text(el.hint, "Confirmed and remembered. The next film will offer it back.");
    }
    later(function () {
      index = (index + 1) % lines.length;
      if (index === 0) {
        auto = false;
        el.toggle.hidden = true;
      }
      load(index, true);
      scheduleAuto();
    }, 1500);
  }

  function addRow(line, key) {
    var li = document.createElement("li");
    li.className = "row is-new";
    li.dataset.key = key;
    li.innerHTML =
      '<div class="cell cell--en"><p class="en"></p></div>' +
      '<div class="cell cell--mon"><p class="mon" lang="mnw"></p></div>' +
      '<div class="cell cell--score"><span class="score score--exact">New</span></div>' +
      '<div class="cell cell--from"><span class="film">Your Name · <span data-used>just now</span></span></div>';
    li.querySelector(".en").textContent = line.en;
    li.querySelector(".mon").textContent = line.match;
    el.rows.insertBefore(li, el.rows.firstChild);
    var all = el.rows.querySelectorAll(".row");
    if (all.length > 8) all[all.length - 1].remove();
  }

  function scheduleAuto() {
    clearTimeout(autoTimer);
    if (!auto || userPaused || !inView) return;
    autoTimer = setTimeout(function () {
      if (step === 0) apply();
      else if (step === 1) confirm();
      scheduleAuto();
    }, step === 0 ? 2400 : 2200);
  }

  function stopAuto() {
    auto = false;
    clearTimeout(autoTimer);
    el.toggle.hidden = true;
  }

  el.apply.addEventListener("click", function () { stopAuto(); apply(); });
  el.confirm.addEventListener("click", function () { stopAuto(); confirm(); });
  live.addEventListener("keydown", function (e) {
    var mod = e.metaKey || e.ctrlKey;
    if (e.key === "1") {
      e.preventDefault();
      stopAuto();
      apply();
    } else if (e.key === "Enter" && (mod || e.target === live)) {
      e.preventDefault();
      stopAuto();
      confirm();
    }
  });
  el.toggle.addEventListener("click", function () {
    userPaused = !userPaused;
    el.toggle.setAttribute("aria-pressed", String(userPaused));
    el.toggle.textContent = userPaused ? "Play demo" : "Pause demo";
    if (userPaused) clearTimeout(autoTimer);
    else scheduleAuto();
  });

  if (reduce.matches) {
    el.toggle.hidden = true;
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      inView = entries[0].isIntersecting;
      if (inView) scheduleAuto();
      else clearTimeout(autoTimer);
    }, { threshold: 0.6 }).observe(live);
  }

  load(0, false);
  if (reduce.matches) apply();
})();
