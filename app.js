/* ============================================================
   FREE PERIOD — app logic
   All data lives in localStorage on this device. No server.
   Days follow the EWU academic week: S=Sun M=Mon T=Tue W=Wed R=Thu
   ============================================================ */
(() => {
  "use strict";

  const STORAGE_KEY = "free-period.ewu.v1";
  const DAYS = ["S", "M", "T", "W", "R"];
  const DAY_NAMES = { S: "Sunday", M: "Monday", T: "Tuesday", W: "Wednesday", R: "Thursday" };
  const DAY_START = timeToMinutes("08:30"); // 510
  const DAY_END = timeToMinutes("19:50");   // 1190
  const PALETTE = ["#7C1F2E", "#1C2B45", "#2F6F6B", "#6B3F69", "#3E7C4A", "#8A5A2E", "#4A5568", "#A6432F"];
  const MIN_GAP_MINUTES = 15; // ignore slivers shorter than this

  // ---------- state ----------
  let data = loadData();
  let selectedIds = new Set();

  // ---------- persistence ----------
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { friends: [] };
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.friends)) return { friends: [] };
      return parsed;
    } catch (e) {
      console.error("Could not read saved routine data:", e);
      return { friends: [] };
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("Could not save routine data:", e);
    }
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  // ---------- time helpers ----------
  function timeToMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  function minutesToLabel(mins) {
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    const suffix = h >= 12 ? "pm" : "am";
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return `${h12}:${String(m).padStart(2, "0")}${suffix}`;
  }

  function durationLabel(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
  }

  // ============================================================
  //  FRIEND FORM
  // ============================================================
  const friendForm = document.getElementById("friend-form");
  const friendListEl = document.getElementById("friend-list");
  const friendEmptyEl = document.getElementById("friend-empty");

  friendForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("friend-name").value.trim();
    const sem = document.getElementById("friend-sem").value.trim();
    if (!name || !sem) return;

    const color = PALETTE[data.friends.length % PALETTE.length];
    data.friends.push({ id: uid(), name, sem, color, classes: [] });
    saveData();
    friendForm.reset();
    document.getElementById("friend-name").focus();
    renderFriends();
    renderPicker();
  });

  function renderFriends() {
    friendListEl.innerHTML = "";
    friendEmptyEl.hidden = data.friends.length > 0;

    data.friends.forEach((friend) => {
      const card = document.createElement("div");
      card.className = "friend-card";
      card.dataset.id = friend.id;
      card.style.setProperty("--friend-color", friend.color);

      const head = document.createElement("div");
      head.className = "friend-card__head";
      head.innerHTML = `
        <div class="friend-card__id">
          <div>
            <div class="friend-card__name">${escapeHTML(friend.name)}</div>
            <div class="friend-card__sem">Semester ${escapeHTML(friend.sem)}</div>
          </div>
        </div>
        <div class="friend-card__actions">
          <span class="friend-card__count">${friend.classes.length} class${friend.classes.length === 1 ? "" : "es"}</span>
          <button type="button" class="friend-card__remove" data-action="remove-friend">remove</button>
          <span class="friend-card__chevron">›</span>
        </div>
      `;
      head.addEventListener("click", (e) => {
        if (e.target.closest('[data-action="remove-friend"]')) return;
        card.classList.toggle("is-open");
      });
      head.querySelector('[data-action="remove-friend"]').addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirm(`Remove ${friend.name} and all their classes?`)) return;
        data.friends = data.friends.filter((f) => f.id !== friend.id);
        selectedIds.delete(friend.id);
        saveData();
        renderFriends();
        renderPicker();
        renderResultsIfVisible();
      });

      const body = document.createElement("div");
      body.className = "friend-card__body";

      const formTpl = document.getElementById("class-row-template").content.cloneNode(true);
      const classForm = formTpl.querySelector(".class-form");
      classForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(classForm);
        const days = fd.getAll("day");
        if (days.length === 0) {
          alert("Pick at least one day for this class.");
          return;
        }
        const start = fd.get("start");
        const end = fd.get("end");
        if (timeToMinutes(end) <= timeToMinutes(start)) {
          alert("End time has to be after start time.");
          return;
        }
        friend.classes.push({
          id: uid(),
          course: fd.get("course").trim(),
          section: fd.get("section").trim(),
          building: fd.get("building"),
          room: fd.get("room").trim(),
          lab: fd.get("lab") === "on",
          days,
          start,
          end,
        });
        saveData();
        classForm.reset();
        renderFriends();
        renderPicker();
        renderResultsIfVisible();
        // keep this card open after re-render
        const reopened = friendListEl.querySelector(`[data-id="${friend.id}"]`);
        if (reopened) reopened.classList.add("is-open");
      });
      body.appendChild(formTpl);

      body.appendChild(renderClassTable(friend));

      card.appendChild(head);
      card.appendChild(body);
      friendListEl.appendChild(card);
    });
  }

  function renderClassTable(friend) {
    const wrap = document.createElement("div");
    if (friend.classes.length === 0) {
      wrap.innerHTML = `<p class="no-classes">No classes added yet.</p>`;
      return wrap;
    }
    const table = document.createElement("table");
    table.className = "class-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Course</th><th>Sec</th><th>Building / Room</th><th>Days</th><th>Time</th><th></th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody");
    friend.classes
      .slice()
      .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))
      .forEach((cls) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHTML(cls.course)}${cls.lab ? '<span class="lab-tag">lab</span>' : ""}</td>
          <td class="mono">${escapeHTML(cls.section)}</td>
          <td class="mono">${escapeHTML(cls.building)} · ${escapeHTML(cls.room)}</td>
          <td class="mono">${cls.days.join("")}</td>
          <td class="mono">${minutesToLabel(timeToMinutes(cls.start))}–${minutesToLabel(timeToMinutes(cls.end))}</td>
          <td><button type="button" class="del-btn">remove</button></td>
        `;
        tr.querySelector(".del-btn").addEventListener("click", () => {
          friend.classes = friend.classes.filter((c) => c.id !== cls.id);
          saveData();
          renderFriends();
          renderPicker();
          renderResultsIfVisible();
          const reopened = friendListEl.querySelector(`[data-id="${friend.id}"]`);
          if (reopened) reopened.classList.add("is-open");
        });
        tbody.appendChild(tr);
      });
    wrap.appendChild(table);
    return wrap;
  }

  // ============================================================
  //  PICKER (choose which friends to compare)
  // ============================================================
  const pickerListEl = document.getElementById("picker-list");
  const pickerEmptyEl = document.getElementById("picker-empty");
  const findGapBtn = document.getElementById("find-gap-btn");

  function renderPicker() {
    pickerListEl.innerHTML = "";
    pickerEmptyEl.hidden = data.friends.length >= 2;

    data.friends.forEach((friend) => {
      const label = document.createElement("label");
      label.className = "picker-item";
      const checked = selectedIds.has(friend.id);
      label.innerHTML = `
        <input type="checkbox" ${checked ? "checked" : ""}>
        <span class="picker-item__dot" style="background:${friend.color}"></span>
        <span>
          <span class="picker-item__name">${escapeHTML(friend.name)}</span>
          <span class="picker-item__meta">${friend.classes.length} class${friend.classes.length === 1 ? "" : "es"}</span>
        </span>
      `;
      label.querySelector("input").addEventListener("change", (e) => {
        if (e.target.checked) selectedIds.add(friend.id);
        else selectedIds.delete(friend.id);
        updateFindBtn();
      });
      pickerListEl.appendChild(label);
    });
    // drop selections for friends that no longer exist
    selectedIds = new Set([...selectedIds].filter((id) => data.friends.some((f) => f.id === id)));
    updateFindBtn();
  }

  function updateFindBtn() {
    findGapBtn.disabled = selectedIds.size < 2;
  }

  findGapBtn.addEventListener("click", () => {
    renderResults();
    document.getElementById("results").hidden = false;
    document.getElementById("results").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function renderResultsIfVisible() {
    const results = document.getElementById("results");
    if (!results.hidden) {
      if (selectedIds.size >= 2) renderResults();
      else results.hidden = true;
    }
  }

  // ============================================================
  //  RESULTS: timetable + free-gap computation
  // ============================================================
  function renderResults() {
    const friends = data.friends.filter((f) => selectedIds.has(f.id));

    renderLegend(friends);
    renderTimetable(friends);
    renderGapSummary(friends);
  }

  function renderLegend(friends) {
    const legend = document.getElementById("legend");
    legend.innerHTML = "";
    friends.forEach((f) => {
      const item = document.createElement("div");
      item.className = "legend__item";
      item.innerHTML = `<span class="legend__swatch" style="background:${f.color}"></span> ${escapeHTML(f.name)}`;
      legend.appendChild(item);
    });
    const free = document.createElement("div");
    free.className = "legend__item";
    free.innerHTML = `<span class="legend__swatch legend__swatch--free"></span> Free for everyone`;
    legend.appendChild(free);
  }

  function renderTimetable(friends) {
    const dayLabelsEl = document.getElementById("tt-daylabels");
    const timeLabelsEl = document.getElementById("tt-timelabels");
    const gridEl = document.getElementById("tt-grid");

    dayLabelsEl.innerHTML = DAYS.map((d) => `<span>${d} <span style="opacity:.55">· ${DAY_NAMES[d].slice(0, 3)}</span></span>`).join("");

    // hour labels every hour from 8:30 to 19:50
    timeLabelsEl.innerHTML = "";
    const totalRange = DAY_END - DAY_START;
    for (let h = 9; h <= 19; h++) {
      const mins = h * 60;
      if (mins < DAY_START || mins > DAY_END) continue;
      const pct = ((mins - DAY_START) / totalRange) * 100;
      const span = document.createElement("span");
      span.style.top = pct + "%";
      span.textContent = minutesToLabel(mins).replace(":00", "");
      timeLabelsEl.appendChild(span);
    }
    gridEl.style.height = "620px";
    gridEl.innerHTML = "";

    DAYS.forEach((day, dayIndex) => {
      const col = document.createElement("div");
      col.className = "tt-day-col";
      col.style.gridColumn = String(dayIndex + 1);
      col.style.gridRow = "1";

      // hour gridlines
      for (let h = 9; h <= 19; h++) {
        const mins = h * 60;
        if (mins < DAY_START || mins > DAY_END) continue;
        const pct = ((mins - DAY_START) / totalRange) * 100;
        const line = document.createElement("div");
        line.className = "tt-hourline";
        line.style.top = pct + "%";
        col.appendChild(line);
      }

      // busy blocks per friend
      const intervalsForDay = [];
      friends.forEach((friend) => {
        friend.classes
          .filter((c) => c.days.includes(day))
          .forEach((c) => {
            const start = clamp(timeToMinutes(c.start), DAY_START, DAY_END);
            const end = clamp(timeToMinutes(c.end), DAY_START, DAY_END);
            if (end <= start) return;
            intervalsForDay.push({ start, end, friend, cls: c });
          });
      });

      intervalsForDay
        .sort((a, b) => a.start - b.start)
        .forEach((iv) => {
          const block = document.createElement("div");
          block.className = "tt-block" + (iv.cls.lab ? " is-lab" : "");
          const top = ((iv.start - DAY_START) / totalRange) * 100;
          const height = ((iv.end - iv.start) / totalRange) * 100;
          block.style.top = top + "%";
          block.style.height = Math.max(height, 3) + "%";
          block.style.background = iv.friend.color;
          block.title = `${iv.friend.name} · ${iv.cls.course} · ${iv.cls.building} ${iv.cls.room}`;
          block.innerHTML = `${escapeHTML(iv.friend.name.split(" ")[0])}<small>${escapeHTML(iv.cls.course)}${iv.cls.lab ? " lab" : ""}</small>`;
          col.appendChild(block);
        });

      // free gaps (union of busy time removed from full range)
      const gaps = computeFreeGaps(intervalsForDay, DAY_START, DAY_END);
      gaps
        .filter((g) => g.end - g.start >= MIN_GAP_MINUTES)
        .forEach((g) => {
          const free = document.createElement("div");
          free.className = "tt-free";
          const top = ((g.start - DAY_START) / totalRange) * 100;
          const height = ((g.end - g.start) / totalRange) * 100;
          free.style.top = top + "%";
          free.style.height = height + "%";
          if (g.end - g.start >= 40) {
            free.textContent = `${minutesToLabel(g.start)}–${minutesToLabel(g.end)}`;
          }
          col.appendChild(free);
        });

      gridEl.appendChild(col);
    });
  }

  function renderGapSummary(friends) {
    const summaryEl = document.getElementById("gap-summary");
    summaryEl.innerHTML = "";

    DAYS.forEach((day) => {
      const intervalsForDay = [];
      friends.forEach((friend) => {
        friend.classes
          .filter((c) => c.days.includes(day))
          .forEach((c) => {
            const start = clamp(timeToMinutes(c.start), DAY_START, DAY_END);
            const end = clamp(timeToMinutes(c.end), DAY_START, DAY_END);
            if (end > start) intervalsForDay.push({ start, end });
          });
      });

      const gaps = computeFreeGaps(intervalsForDay, DAY_START, DAY_END).filter(
        (g) => g.end - g.start >= MIN_GAP_MINUTES
      );

      const dayBlock = document.createElement("div");
      dayBlock.className = "gap-day";
      const heading = document.createElement("h3");
      heading.textContent = `${DAY_NAMES[day]} (${day})`;
      dayBlock.appendChild(heading);

      if (gaps.length === 0) {
        const p = document.createElement("p");
        p.className = "gap-none";
        p.textContent = intervalsForDay.length === 0
          ? "No one has class this day — you're all free all day."
          : "No shared gap of 15+ minutes this day. Back to back.";
        dayBlock.appendChild(p);
      } else {
        const row = document.createElement("div");
        row.className = "gap-pill-row";
        gaps.forEach((g) => {
          const pill = document.createElement("span");
          pill.className = "gap-pill";
          pill.textContent = `${minutesToLabel(g.start)} – ${minutesToLabel(g.end)} (${durationLabel(g.end - g.start)})`;
          row.appendChild(pill);
        });
        dayBlock.appendChild(row);
      }
      summaryEl.appendChild(dayBlock);
    });
  }

  // merge overlapping/touching busy intervals, then invert within [rangeStart, rangeEnd]
  function computeFreeGaps(intervals, rangeStart, rangeEnd) {
    if (intervals.length === 0) return [{ start: rangeStart, end: rangeEnd }];
    const sorted = intervals
      .map((iv) => ({ start: iv.start, end: iv.end }))
      .sort((a, b) => a.start - b.start);

    const merged = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const last = merged[merged.length - 1];
      const cur = sorted[i];
      if (cur.start <= last.end) {
        last.end = Math.max(last.end, cur.end);
      } else {
        merged.push({ ...cur });
      }
    }

    const gaps = [];
    let cursor = rangeStart;
    merged.forEach((iv) => {
      if (iv.start > cursor) gaps.push({ start: cursor, end: iv.start });
      cursor = Math.max(cursor, iv.end);
    });
    if (cursor < rangeEnd) gaps.push({ start: cursor, end: rangeEnd });
    return gaps;
  }

  function clamp(v, lo, hi) {
    return Math.min(Math.max(v, lo), hi);
  }

  function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  // ============================================================
  //  RESET
  // ============================================================
  document.getElementById("reset-btn").addEventListener("click", () => {
    if (!confirm("This clears every friend and class from this device. Continue?")) return;
    data = { friends: [] };
    selectedIds = new Set();
    localStorage.removeItem(STORAGE_KEY);
    renderFriends();
    renderPicker();
    document.getElementById("results").hidden = true;
  });

  // ============================================================
  //  INIT
  // ============================================================
  renderFriends();
  renderPicker();
})();
                             
