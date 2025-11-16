/* script.js – US 24355 app: core logic + JSON loading + PDF + share */
const STORAGE_KEY = "TECH_DATA";
let data;
try {
  data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || { answers: {}, name: "", id: "", teacher: "", username: "" };
} catch (_) {
  data = { answers: {}, name: "", id: "", teacher: "", username: "" };
}

// Auto-detect Chromebook user
let detectedUsername = "";
if (window.chrome?.identity) {
  chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (info) => {
    if (info?.email) {
      detectedUsername = info.email.split('@')[0];
      const el = document.getElementById("username");
      if (el && !el.value.trim()) {
        el.value = detectedUsername;
        data.username = detectedUsername;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      }
    }
  });
}

let currentAssessment = null;
let finalData = null;

// XOR obfuscation
const XOR_KEY = 42;
const xor = s => btoa([...s].map(c => String.fromCharCode(c.charCodeAt(0) ^ XOR_KEY)).join(""));
const unxor = s => {
  try { return atob(s).split("").map(c => String.fromCharCode(c.charCodeAt(0) ^ XOR_KEY)).join(""); }
  catch { return ""; }
};

// Global config
let APP_TITLE, APP_SUBTITLE, TEACHERS, ASSESSMENTS;

/* --------------------------------------------------------------
   Load questions.json – robust & safe
   -------------------------------------------------------------- */
async function loadQuestions() {
  try {
    const res = await fetch("questions.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    APP_TITLE = json.APP_TITLE || "Assessment";
    APP_SUBTITLE = json.APP_SUBTITLE || "";
    TEACHERS = Array.isArray(json.TEACHERS) ? json.TEACHERS : [];
    const raw = Array.isArray(json.ASSESSMENTS) ? json.ASSESSMENTS : [];
    ASSESSMENTS = raw
      .filter(a => a && a.id && Array.isArray(a.questions))
      .map(ass => ({
        ...ass,
        questions: ass.questions
          .filter(q => q && q.id && typeof q.maxPoints === "number")
          .map(q => ({
            ...q,
            rubric: Array.isArray(q.rubric)
              ? q.rubric.map(r => ({
                  ...r,
                  check: new RegExp(r.check || "", "i")
                }))
              : []
          }))
      }));
    if (ASSESSMENTS.length === 0) throw new Error("No valid assessments");
  } catch (err) {
    console.error("Load error:", err);
    document.body.innerHTML = `<div style="text-align:center;padding:40px;color:#e74c3c;font-family:sans-serif;">
      <h2>Failed to load assessment data</h2>
      <p>Check <code>questions.json</code> exists and is valid.</p>
      <p><strong>Error:</strong> ${err.message}</p>
    </div>`;
    throw err;
  }
}

/* --------------------------------------------------------------
   Initialize UI
   -------------------------------------------------------------- */
function initApp() {
  document.getElementById("loading")?.remove();
  document.getElementById("page-title").textContent = APP_TITLE;
  document.getElementById("header-title").textContent = APP_TITLE;
  document.getElementById("header-subtitle").textContent = APP_SUBTITLE;

  const nameEl = document.getElementById("name");
  const idEl = document.getElementById("id");
  const userEl = document.getElementById("username");
  nameEl.value = data.name || "";
  idEl.value = data.id || "";
  if (userEl) userEl.value = data.username || "";

  if (data.id) {
    document.getElementById("locked-msg").classList.remove("hidden");
    document.getElementById("locked-id").textContent = data.id;
    idEl.readOnly = true;
  }

  const teacherSel = document.getElementById("teacher");
  teacherSel.innerHTML = '<option value="">Select Teacher</option>';
  TEACHERS.forEach(t => {
    const o = document.createElement("option");
    o.value = t.email;
    o.textContent = t.name;
    if (t.email === data.teacher) o.selected = true;
    teacherSel.appendChild(o);
  });

  const assSel = document.getElementById("assessmentSelector");
  assSel.innerHTML = '<option value="">Select Assessment</option>';
  ASSESSMENTS.forEach((a, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = `${a.title} – ${a.subtitle}`;
    assSel.appendChild(o);
  });
}

/* --------------------------------------------------------------
   Save student info
   -------------------------------------------------------------- */
function saveStudentInfo() {
  data.name = document.getElementById("name").value.trim();
  data.id = document.getElementById("id").value.trim();
  data.teacher = document.getElementById("teacher").value;
  data.username = document.getElementById("username")?.value.trim() || "";
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/* --------------------------------------------------------------
   Load assessment
   -------------------------------------------------------------- */
function loadAssessment() {
  const idx = document.getElementById("assessmentSelector").value;
  if (idx === "") return;
  saveStudentInfo();
  currentAssessment = ASSESSMENTS[idx];
  const container = document.getElementById("questions");
  container.innerHTML = `<div class="assessment-header"><h2>${currentAssessment.title}</h2><p>${currentAssessment.subtitle}</p></div>`;
  currentAssessment.questions.forEach(q => {
    const saved = data.answers[currentAssessment.id]?.[q.id] ? unxor(data.answers[currentAssessment.id][q.id]) : "";
    const field = q.type === "long"
      ? `<textarea rows="5" id="a${q.id}" class="answer-field">${saved}</textarea>`
      : `<input type="text" id="a${q.id}" value="${saved}" class="answer-field">`;
    const div = document.createElement("div");
    div.className = "q";
    div.innerHTML = `<strong>${q.id.toUpperCase()} (${q.maxPoints} pts)</strong><br>${q.text}<br>${field}`;
    container.appendChild(div);
  });
  attachProtection();
}

/* --------------------------------------------------------------
   Save / get answer
   -------------------------------------------------------------- */
function saveAnswer(qid) {
  const el = document.getElementById("a" + qid);
  if (!el) return;
  const val = el.value;
  if (!data.answers[currentAssessment.id]) data.answers[currentAssessment.id] = {};
  data.answers[currentAssessment.id][qid] = xor(val);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
function getAnswer(id) {
  const raw = data.answers[currentAssessment.id]?.[id] || "";
  return raw ? unxor(raw) : "";
}

/* --------------------------------------------------------------
   Grade – 100% IDENTICAL TO YOUR WORKING SCRIPT
   -------------------------------------------------------------- */
function gradeIt() {
  let total = 0;
  const results = [];
  currentAssessment.questions.forEach(q => {
    const ans = getAnswer(q.id);
    let earned = 0;
    const hints = [];
    if (q.rubric) {
      q.rubric.forEach(r => {
        if (r.check.test(ans)) earned += r.points;
        else if (r.hint) hints.push(r.hint);
      });
    }
    earned = Math.min(earned, q.maxPoints);
    total += earned;
    const isCorrect = earned === q.maxPoints;
    results.push({
      id: q.id.toUpperCase(),
      question: q.text,
      answer: ans || "(blank)",
      earned,
      max: q.maxPoints,
      markText: isCorrect ? "Correct" : earned > 0 ? "Incorrect (partial)" : "Incorrect",
      hint: hints.length ? hints.join(" • ") : isCorrect ? "" : q.hint || "Check your answer"
    });
  });
  return { total, results };
}

/* --------------------------------------------------------------
   Submit – PRETTY + FULL INFO (MATCHES PDF)
   -------------------------------------------------------------- */
function submitWork() {
  saveStudentInfo();
  const name = data.name;
  const id = data.id;
  const username = data.username || "";
  if (!name || !id || !data.teacher) return alert("Fill Name, ID, and Teacher");
  if (!currentAssessment) return alert("Select an assessment");
  if (data.id && document.getElementById("id").value !== data.id) return alert("ID locked to: " + data.id);

  const { total, results } = gradeIt();
  const totalPoints = currentAssessment.totalPoints ||
    currentAssessment.questions.reduce((s, q) => s + q.maxPoints, 0);
  const pct = totalPoints ? Math.round((total / totalPoints) * 100) : 0;

  const teacherEmail = data.teacher || "";
  const teacher = TEACHERS.find(t => t.email === teacherEmail) || {};
  const teacherName = teacher.name || "";

  const submittedAt = new Date().toLocaleString("en-NZ", {
    timeZone: "Pacific/Auckland",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });

  finalData = {
    name, id, username,
    teacherName, teacherEmail,
    assessment: currentAssessment,
    submittedAt,
    points: total,
    totalPoints,
    pct,
    results
  };

  const displayUsername = username || detectedUsername || "";
  const autoTag = detectedUsername && detectedUsername === displayUsername ? " (Device Auto)" : "";

  // Update result header
  document.getElementById("student").textContent =
    `${name}${displayUsername ? ` (${displayUsername}${autoTag})` : ""} – ID: ${id}`;
  document.getElementById("teacher-name").textContent = teacherName;
  document.getElementById("grade").innerHTML = `${total}/${totalPoints}<br><small>(${pct}%)</small>`;

  const ansDiv = document.getElementById("answers");
  ansDiv.innerHTML = "";

  // === Rich Feedback – Uses your existing .feedback classes ===
  results.forEach(r => {
    const block = document.createElement("div");
    block.className = `feedback ${r.earned === r.max ? "correct" : r.earned > 0 ? "partial" : "wrong"}`;

    const hintHtml = r.earned < r.max && r.hint
      ? `<br><strong style="color:#c62828;">Tip:</strong> ${r.hint}`
      : r.earned === r.max ? `<em style="color:#2e7d32;">Perfect!</em>` : "";

    block.innerHTML = `
      <strong style="font-size:1.1em;">${r.id}: ${r.earned}/${r.max} — ${r.markText}</strong><br>
      <div style="margin:8px 0;"><strong>Question:</strong> ${r.question}</div>
      <div style="margin:8px 0;"><strong>Answer:</strong> <em>${r.answer}</em></div>
      ${hintHtml}
      <hr style="border:none;border-top:1px dashed #ddd;margin:12px 0 8px;">
    `;
    ansDiv.appendChild(block);
  });

  // === Footer Branding ===
  const footer = document.createElement("div");
  footer.style.cssText = "text-align:center;color:#7f8c8d;font-size:0.9em;margin-top:20px;";
  footer.textContent = "Generated by Pukekohe High School Technology Dept";
  ansDiv.appendChild(footer);

  // Show result
  document.getElementById("form").classList.add("hidden");
  document.getElementById("result").classList.remove("hidden");
}

function back() {
  document.getElementById("result").classList.add("hidden");
  document.getElementById("form").classList.remove("hidden");
}

/* --------------------------------------------------------------
   Email body – used in PDF
   -------------------------------------------------------------- */
function buildEmailBody(fd) {
  const username = fd.username || detectedUsername || "";
  const lines = [];
  lines.push(`Pukekohe High School – ${APP_TITLE}`);
  lines.push(APP_SUBTITLE);
  lines.push("");
  lines.push(`Assessment: ${fd.assessment.title} – ${fd.assessment.subtitle}`);
  lines.push(`Student: ${fd.name}${username ? ` (${username}${detectedUsername && detectedUsername === username ? " (Device Auto)" : ""})` : ""} – ID: ${fd.id}`);
  lines.push(`Teacher: ${fd.teacherName}${fd.teacherEmail ? ` <${fd.teacherEmail}>` : ""}`);
  lines.push(`Submitted: ${fd.submittedAt}`);
  lines.push("");
  lines.push(`Score: ${fd.points}/${fd.totalPoints} (${fd.pct}%)`);
  lines.push("=".repeat(60));
  lines.push("");
  fd.results.forEach(r => {
    lines.push(`${r.id}: ${r.earned}/${r.max} — ${r.markText}`);
    lines.push(`Question: ${r.question}`);
    lines.push(`Answer: ${r.answer}`);
    if (r.earned < r.max && r.hint) lines.push(`Tip: ${r.hint}`);
    lines.push("-".repeat(60));
    lines.push("");
  });
  lines.push("Generated by Pukekohe High School Technology Dept");
  return lines.join("\n");
}

/* --------------------------------------------------------------
   Share PDF
   -------------------------------------------------------------- */
async function sharePDF(file) {
  if (!finalData) return;
  const subject = `${finalData.assessment.title} – ${finalData.name} (${finalData.id})`;
  const fullBody = buildEmailBody(finalData);
  const shareData = { files: [file], title: subject, text: fullBody };
  if (navigator.canShare && navigator.canShare(shareData)) {
    try { await navigator.share(shareData); showToast("Shared"); return; }
    catch (err) { if (!String(err).includes("AbortError")) showToast("Share failed", false); }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a"); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  const shortBody = [
    `Assessment: ${finalData.assessment.title}`,
    `Student: ${finalData.name}${finalData.username ? ` (${finalData.username})` : ''} – ID: ${finalData.id}`,
    `Teacher: ${finalData.teacherName}`,
    `Score: ${finalData.points}/${finalData.totalPoints} (${finalData.pct}%)`,
    "", "Full report attached as PDF."
  ].join("\n");
  window.location.href = `mailto:${encodeURIComponent(finalData.teacherEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(shortBody)}`;
  showToast("Downloaded + email opened");
}

/* --------------------------------------------------------------
   Generate PDF – RED HEADER + FULL INFO
   -------------------------------------------------------------- */
async function emailWork() {
  if (!finalData) return alert("Submit first!");
  const load = src => new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
  try { await load("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"); }
  catch (e) { return showToast("Failed to load PDF tool", false); }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 15;
  const lineHeight = 6.5;
  let y = 45;

  pdf.setFillColor(110, 24, 24);
  pdf.rect(0, 0, pageWidth, 35, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(18); pdf.setFont("helvetica", "bold");
  pdf.text(APP_TITLE, margin, 20);
  pdf.setFontSize(12); pdf.setFont("helvetica", "normal");
  pdf.text(APP_SUBTITLE, margin, 28);

  const lines = buildEmailBody(finalData).split("\n");
  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(11);
  lines.forEach(line => {
    if (y > pageHeight - 20) {
      pdf.addPage();
      y = 20;
      pdf.setFillColor(110, 24, 24);
      pdf.rect(0, 0, pageWidth, 35, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(18); pdf.setFont("helvetica", "bold");
      pdf.text(APP_TITLE, margin, 20);
      pdf.setFontSize(12); pdf.text(APP_SUBTITLE, margin, 28);
      pdf.setTextColor(0, 0, 0);
      pdf.setFontSize(11);
      y = 45;
    }
    pdf.setFont(line.includes("Score:") || line.startsWith("=") || line.startsWith("-") ? "bold" : "normal", "helvetica");
    const wrapped = pdf.splitTextToSize(line, pageWidth - 2 * margin);
    wrapped.forEach(w => { pdf.text(w, margin, y); y += lineHeight; });
  });
  pdf.setFontSize(9);
  pdf.setTextColor(100, 100, 100);
  pdf.text("Generated by Pukekohe High School Technology Dept", margin, pageHeight - 10);

  const filename = `${finalData.name.replace(/\s+/g, "_")}_${finalData.assessment.id}_${finalData.pct}%.pdf`;
  const file = new File([pdf.output("blob")], filename, { type: "application/pdf" });
  await sharePDF(file);
}

/* --------------------------------------------------------------
   Toast + Protection
   -------------------------------------------------------------- */
function showToast(text, ok = true) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.style.background = ok ? "#2c3e50" : "#e74c3c";
  toast.style.opacity = "1";
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.style.opacity = "0", 3000);
}

const PASTE_BLOCKED_MESSAGE = "Pasting blocked!";
async function clearClipboard() { if (navigator.clipboard?.writeText) try { await navigator.clipboard.writeText(""); } catch (_) {} }
clearClipboard();

function attachProtection() {
  document.querySelectorAll(".answer-field").forEach(f => {
    f.addEventListener("input", () => saveAnswer(f.id.slice(1)));
    f.addEventListener("paste", e => { e.preventDefault(); showToast(PASTE_BLOCKED_MESSAGE, false); clearClipboard(); });
    f.addEventListener("copy", e => e.preventDefault());
    f.addEventListener("cut", e => e.preventDefault());
  });
}
document.addEventListener("contextmenu", e => { if (!e.target.matches("input, textarea")) e.preventDefault(); });

/* --------------------------------------------------------------
   Export
   -------------------------------------------------------------- */
window.loadAssessment = loadAssessment;
window.submitWork = submitWork;
window.back = back;
window.emailWork = emailWork;

/* --------------------------------------------------------------
   Start
   -------------------------------------------------------------- */
(async () => {
  try {
    await loadQuestions();
    initApp();
  } catch (_) {}
})();
