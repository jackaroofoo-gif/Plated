/* Plated · AI Kitchen
   Everything runs in the browser. The API key and saved recipes live in localStorage. */

const KEY = "plated.geminiKey";
const MODEL = "plated.geminiModel";
const LIB = "plated.recipes";
const DIETS = ["Vegetarian", "Vegan", "Gluten-free", "Dairy-free", "Nut-free", "Halal", "Kosher", "Low-carb"];

const $ = (s) => document.querySelector(s);

const store = {
  get(k, d) {
    try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
  },
  remove(k) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  },
};

// Build DOM safely (AI text is always inserted as text, never as HTML)
function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  kids.flat().filter(Boolean).forEach((c) => n.append(c));
  return n;
}
const bullets = (items, cls) => h("ul", cls ? { class: cls } : {}, (items || []).map((t) => h("li", { text: String(t) })));
const block = (title, items) => (items && items.length ? [h("h3", { text: title }), bullets(items)] : null);

/* ---------- Tabs ---------- */
function showTab(name) {
  for (const t of ["kitchen", "library"]) {
    $("#" + t).hidden = t !== name;
    $("#tab-" + t).setAttribute("aria-selected", String(t === name));
  }
  if (name === "library") renderLibrary();
}
$("#tab-kitchen").addEventListener("click", () => showTab("kitchen"));
$("#tab-library").addEventListener("click", () => showTab("library"));

/* ---------- API key ---------- */
function refreshKeyState() {
  const has = !!store.get(KEY, "");
  const pill = $("#keyState");
  pill.textContent = has ? "Saved" : "Not set";
  pill.classList.toggle("ok", has);
  if (!has) $("#keyBox").open = true;
}
$("#model").value = store.get(MODEL, "gemini-flash-latest");
$("#saveKey").addEventListener("click", () => {
  const v = $("#apiKey").value.trim();
  if (!v) return setStatus("Paste your Gemini API key first.", true);
  store.set(KEY, v);
  store.set(MODEL, $("#model").value.trim() || "gemini-flash-latest");
  $("#apiKey").value = "";
  refreshKeyState();
  setStatus("Key saved in this browser.");
  $("#keyBox").open = false;
});
$("#clearKey").addEventListener("click", () => {
  store.remove(KEY);
  $("#apiKey").value = "";
  refreshKeyState();
  setStatus("Key removed.");
});
$("#model").addEventListener("change", () => store.set(MODEL, $("#model").value.trim() || "gemini-flash-latest"));

/* ---------- Form ---------- */
$("#diet").append(...DIETS.map((d) => h("label", {}, h("input", { type: "checkbox", value: d }), d)));

function setStatus(msg, isError = false) {
  const s = $("#status");
  s.textContent = msg;
  s.classList.toggle("error", isError);
}

function readBrief() {
  return {
    diet: [...document.querySelectorAll("#diet input:checked")].map((i) => i.value),
    dietOther: $("#dietOther").value.trim(),
    ingredients: $("#ingredients").value.trim(),
    inspiration: $("#inspiration").value.trim(),
    servings: Math.max(1, Math.min(12, parseInt($("#servings").value, 10) || 2)),
  };
}

const dietText = (b) => [...b.diet, b.dietOther].filter(Boolean).join(", ");

/* ---------- Gemini ---------- */
async function generate(b) {
  const key = store.get(KEY, "");
  if (!key) throw new Error("Add your Gemini API key above first.");
  const model = store.get(MODEL, "gemini-flash-latest");

  const prompt = `You are a careful home-cooking chef. Create ONE recipe.

Dietary requirements (follow strictly, no exceptions): ${dietText(b) || "none"}
Ingredients the cook has: ${b.ingredients}
Inspiration / kind of dish: ${b.inspiration || "anything that suits the ingredients"}
Servings: ${b.servings}

Rules:
- Build the recipe mainly from the listed ingredients. Assume only basic pantry staples (water, salt, pepper, cooking oil).
- Anything else the cook would need to buy goes in "also_needed".
- Never include an ingredient that breaks a dietary requirement or an allergy.
- Keep every bullet short and clear.

Reply with JSON only, exactly this shape:
{"title":"","summary":"one sentence","servings":${b.servings},"prep_time":"","cook_time":"","dietary_check":["one bullet per requirement, saying how the recipe meets it"],"ingredients_used":["quantity + ingredient from the cook's list"],"also_needed":[],"steps":["short step"],"tips":[]}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Gemini request failed (${res.status}).`);

  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  if (!text) throw new Error("Gemini returned no recipe. Try again, or loosen the requirements.");
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    throw new Error("The recipe came back in an unexpected format. Try again.");
  }
}

/* ---------- Recipe display ---------- */
function briefItems(b) {
  return [
    `Dietary: ${dietText(b) || "No requirements"}`,
    `Ingredients on hand: ${b.ingredients}`,
    `Inspiration: ${b.inspiration || "Open to anything"}`,
    `Servings: ${b.servings}`,
  ];
}

function showRecipe(container, entry, actions) {
  const r = entry.recipe;
  container.replaceChildren(
    ...[
      h("h2", { text: r.title || "Untitled recipe" }),
      r.summary ? h("p", { class: "lede", text: r.summary }) : null,
      bullets([`Serves ${r.servings || entry.brief.servings}`, `Prep: ${r.prep_time || "n/a"}`, `Cook: ${r.cook_time || "n/a"}`], "meta"),
      block("Your brief", briefItems(entry.brief)),
      block("Dietary check", r.dietary_check),
      block("Ingredients from your kitchen", r.ingredients_used),
      block("Also needed", r.also_needed),
      block("Method", r.steps),
      block("Tips", r.tips),
      h("div", { class: "actions" }, actions),
    ].flat().filter(Boolean)
  );
}

/* ---------- Library ---------- */
const getLib = () => store.get(LIB, []);
const updateCount = () => ($("#count").textContent = String(getLib().length));

function saveToLibrary(entry, btn) {
  const lib = getLib();
  if (!lib.some((e) => e.id === entry.id)) {
    lib.unshift({ ...entry, savedAt: new Date().toISOString() });
    store.set(LIB, lib);
  }
  updateCount();
  btn.disabled = true;
  btn.textContent = "Saved to library";
}

function renderLibrary() {
  const lib = getLib();
  $("#libView").hidden = true;
  const list = $("#libList");
  list.hidden = false;
  if (!lib.length) {
    list.replaceChildren(h("p", { class: "empty", text: "No saved recipes yet. Make one in the AI Kitchen and choose Save to library." }));
    return;
  }
  list.replaceChildren(
    h("div", { class: "libGrid" },
      lib.map((e) =>
        h("button", { class: "libItem", type: "button", onclick: () => openSaved(e) },
          h("strong", { text: e.recipe.title || "Untitled recipe" }),
          h("span", { text: new Date(e.savedAt).toLocaleDateString() + (dietText(e.brief) ? " · " + dietText(e.brief) : "") })
        )
      )
    )
  );
}

function openSaved(entry) {
  $("#libList").hidden = true;
  const view = $("#libView");
  view.hidden = false;
  showRecipe(view, entry, [
    h("button", { class: "ghost", type: "button", text: "Back to library", onclick: renderLibrary }),
    h("button", {
      class: "danger", type: "button", text: "Delete recipe",
      onclick: () => {
        if (!confirm("Delete this recipe from your library?")) return;
        store.set(LIB, getLib().filter((e) => e.id !== entry.id));
        updateCount();
        renderLibrary();
      },
    }),
  ]);
}

/* ---------- Submit ---------- */
$("#brief").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const b = readBrief();
  if (!b.ingredients) return setStatus("Add at least one ingredient.", true);
  const go = $("#go");
  go.disabled = true;
  setStatus("Cooking up your recipe…");
  try {
    const recipe = await generate(b);
    const entry = { id: Date.now(), brief: b, recipe };
    const save = h("button", { type: "button", text: "Save to library" });
    save.addEventListener("click", () => saveToLibrary(entry, save));
    showRecipe($("#result"), entry, [save]);
    setStatus("Done.");
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    go.disabled = false;
  }
});

refreshKeyState();
updateCount();
