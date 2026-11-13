
/* =========================================================
   MEDIHORA - Aplicativo de controle de medicamentos
   Supabase Auth + PostgreSQL
   ========================================================= */

const SUPABASE_URL = "https://dtwfettaesywyczfyvpr.supabase.co";
const SUPABASE_KEY = "sb_publishable_WsqtiIuq2h_4e1gtVGg8PQ_L4LW7px0";

let supabaseClient;
let currentUser = null;
let medications = [];
let schedulesByMedication = {};
let currentFilter = "all";

const $ = (id) => document.getElementById(id);

function showMessage(message, isError = false) {
  const box = $("message");
  box.textContent = message;
  box.classList.remove("hidden", "error");
  if (isError) box.classList.add("error");

  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => box.classList.add("hidden"), 4500);
}

function setLoading(button, loading, loadingText = "Aguarde...") {
  if (!button) return;
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function showAuthBox(name) {
  ["loginBox", "registerBox", "recoveryBox"].forEach(id => {
    $(id).classList.add("hidden");
  });
  $(name).classList.remove("hidden");
}

function showApplication(user) {
  currentUser = user;
  $("authSection").classList.add("hidden");
  $("appSection").classList.remove("hidden");

  const metadata = user.user_metadata || {};
  const firstName = metadata.full_name || user.email?.split("@")[0] || "tudo bem?";
  $("userName").textContent = firstName.split(" ")[0];

  loadMedications();
}

function showLogin() {
  currentUser = null;
  $("appSection").classList.add("hidden");
  $("authSection").classList.remove("hidden");
  showAuthBox("loginBox");
}

function todayLocalDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/* -------------------- HORÁRIOS -------------------- */

function addTimeRow(value = "08:00") {
  const row = document.createElement("div");
  row.className = "time-row";

  const input = document.createElement("input");
  input.type = "time";
  input.className = "schedule-time";
  input.value = value;
  input.required = true;
  input.setAttribute("aria-label", "Horário do medicamento");

  const description = document.createElement("span");
  description.textContent = "Horário da dose";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-time";
  remove.textContent = "Remover";
  remove.addEventListener("click", () => {
    if ($("scheduleList").children.length <= 1) {
      showMessage("Mantenha pelo menos um horário.", true);
      return;
    }
    row.remove();
  });

  row.append(input, description, remove);
  $("scheduleList").appendChild(row);
}

function getSelectedTimes() {
  return [...document.querySelectorAll(".schedule-time")]
    .map(input => input.value)
    .filter(Boolean)
    .filter((time, index, array) => array.indexOf(time) === index)
    .sort();
}

function resetMedicationForm() {
  $("medicationForm").reset();
  $("medicationId").value = "";
  $("startDate").value = todayLocalDate();
  $("scheduleList").innerHTML = "";
  addTimeRow("08:00");
  $("formTitle").textContent = "Adicionar medicamento";
  $("saveMedicationButton").textContent = "Salvar medicamento";
  $("cancelEditButton").classList.add("hidden");
}

function fillMedicationForm(medication, times) {
  $("medicationId").value = medication.id;
  $("medName").value = medication.name || "";
  $("medDose").value = medication.dose || "";
  $("medInstructions").value = medication.instructions || "";
  $("startDate").value = medication.start_date || todayLocalDate();
  $("durationDays").value = medication.prescribed_days || "";

  $("scheduleList").innerHTML = "";
  (times.length ? times : ["08:00"]).forEach(time => addTimeRow(time));

  $("formTitle").textContent = "Editar medicamento";
  $("saveMedicationButton").textContent = "Salvar alterações";
  $("cancelEditButton").classList.remove("hidden");

  $("medicationPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* -------------------- AUTENTICAÇÃO -------------------- */

async function login(event) {
  event.preventDefault();

  const button = $("loginForm").querySelector("button[type=submit]");
  setLoading(button, true, "Entrando...");

  try {
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;
    if (data.user) showApplication(data.user);
  } catch (error) {
    showMessage(error.message || "Não foi possível entrar.", true);
  } finally {
    setLoading(button, false);
  }
}

async function register(event) {
  event.preventDefault();

  const button = $("registerForm").querySelector("button[type=submit]");
  setLoading(button, true, "Criando conta...");

  try {
    const fullName = $("registerName").value.trim();
    const email = $("registerEmail").value.trim();
    const password = $("registerPassword").value;

    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName }
      }
    });

    if (error) throw error;

    if (data.session && data.user) {
      showApplication(data.user);
      showMessage("Sua conta foi criada com sucesso!");
    } else {
      showMessage("Conta criada! Confira seu e-mail para confirmar o cadastro.");
      showAuthBox("loginBox");
    }
  } catch (error) {
    showMessage(error.message || "Não foi possível criar a conta.", true);
  } finally {
    setLoading(button, false);
  }
}

async function recoverPassword(event) {
  event.preventDefault();

  const button = $("recoveryForm").querySelector("button[type=submit]");
  setLoading(button, true, "Enviando...");

  try {
    const email = $("recoveryEmail").value.trim();

    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });

    if (error) throw error;

    showMessage("Se o e-mail estiver cadastrado, você receberá o link de recuperação.");
    showAuthBox("loginBox");
  } catch (error) {
    showMessage(error.message || "Não foi possível enviar o link.", true);
  } finally {
    setLoading(button, false);
  }
}

async function logout() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    showMessage(error.message, true);
    return;
  }

  medications = [];
  schedulesByMedication = {};
  showLogin();
}

/* -------------------- MEDICAMENTOS -------------------- */

async function loadMedications() {
  $("medicationList").innerHTML =
    '<div class="empty-state">Carregando seus medicamentos...</div>';

  try {
    const { data, error } = await supabaseClient
      .from("medications")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    medications = data || [];
    schedulesByMedication = {};

    if (medications.length) {
      const ids = medications.map(item => item.id);

      const { data: schedules, error: scheduleError } = await supabaseClient
        .from("medication_schedules")
        .select("*")
        .in("medication_id", ids)
        .eq("user_id", currentUser.id)
        .eq("enabled", true)
        .order("scheduled_time");

      if (scheduleError) throw scheduleError;

      (schedules || []).forEach(schedule => {
        if (!schedulesByMedication[schedule.medication_id]) {
          schedulesByMedication[schedule.medication_id] = [];
        }
        schedulesByMedication[schedule.medication_id].push(schedule.scheduled_time);
      });
    }

    updateCounters();
    renderMedications();
  } catch (error) {
    $("medicationList").innerHTML =
      '<div class="empty-state">Não foi possível carregar os medicamentos.</div>';
    showMessage(error.message || "Erro ao carregar dados.", true);
  }
}

async function saveMedication(event) {
  event.preventDefault();

  if (!currentUser) {
    showMessage("Entre na sua conta novamente.", true);
    return;
  }

  const button = $("saveMedicationButton");
  setLoading(button, true, "Salvando...");

  try {
    const id = $("medicationId").value;
    const name = $("medName").value.trim();
    const dose = $("medDose").value.trim();
    const instructions = $("medInstructions").value.trim();
    const startDate = $("startDate").value;
    const duration = Number($("durationDays").value);
    const times = getSelectedTimes();

    if (!name || !dose || !startDate || !duration) {
      throw new Error("Preencha os campos obrigatórios.");
    }

    if (!Number.isInteger(duration) || duration < 1) {
      throw new Error("Informe uma duração válida em dias.");
    }

    if (!times.length) {
      throw new Error("Adicione pelo menos um horário.");
    }

    const medicationData = {
      user_id: currentUser.id,
      name,
      dose,
      instructions,
      start_date: startDate,
      prescribed_days: duration,
      timezone: "America/Sao_Paulo",
      updated_at: new Date().toISOString()
    };

    let medicationId = id;

    if (id) {
      const { error } = await supabaseClient
        .from("medications")
        .update(medicationData)
        .eq("id", id)
        .eq("user_id", currentUser.id);

      if (error) throw error;
    } else {
      medicationData.status = "active";

      const { data, error } = await supabaseClient
        .from("medications")
        .insert(medicationData)
        .select("id")
        .single();

      if (error) throw error;
      medicationId = data.id;
    }

    // Substitui os horários anteriores pelos horários informados.
    const { error: deleteError } = await supabaseClient
      .from("medication_schedules")
      .delete()
      .eq("medication_id", medicationId)
      .eq("user_id", currentUser.id);

    if (deleteError) {
      throw new Error("Medicamento salvo, mas não foi possível atualizar os horários: " + deleteError.message);
    }

    const scheduleRows = times.map(time => ({
      user_id: currentUser.id,
      medication_id: medicationId,
      scheduled_time: time,
      enabled: true
    }));

    const { error: insertScheduleError } = await supabaseClient
      .from("medication_schedules")
      .insert(scheduleRows);

    if (insertScheduleError) {
      throw new Error("Medicamento salvo, mas houve um problema ao gravar os horários: " + insertScheduleError.message);
    }

    resetMedicationForm();
    await loadMedications();
    showMessage(id ? "Medicamento atualizado!" : "Medicamento cadastrado com sucesso!");
  } catch (error) {
    showMessage(error.message || "Não foi possível salvar.", true);
  } finally {
    setLoading(button, false);
  }
}

/* -------------------- AÇÕES DOS CARTÕES -------------------- */

async function changeMedicationStatus(id, status) {
  const labels = {
    active: "retomar",
    paused: "pausar",
    completed: "concluir"
  };

  const question = {
    active: "Deseja retomar este medicamento?",
    paused: "Deseja pausar este medicamento?",
    completed: "Deseja marcar este tratamento como concluído?"
  };

  if (!confirm(question[status])) return;

  try {
    const { error } = await supabaseClient
      .from("medications")
      .update({
        status,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("user_id", currentUser.id);

    if (error) throw error;

    await loadMedications();
    showMessage("Medicamento atualizado.");
  } catch (error) {
    showMessage(error.message || "Não foi possível atualizar.", true);
  }
}

function editMedication(id) {
  const medication = medications.find(item => item.id === id);
  if (!medication) return;

  if (medication.status === "completed") {
    showMessage("Tratamentos concluídos não podem ser editados.", true);
    return;
  }

  fillMedicationForm(medication, schedulesByMedication[id] || []);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function statusLabel(status) {
  return {
    active: "Em uso",
    paused: "Pausado",
    completed: "Concluído"
  }[status] || status;
}

function renderMedications() {
  const list = $("medicationList");

  const filtered = medications.filter(item =>
    currentFilter === "all" || item.status === currentFilter
  );

  if (!filtered.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div style="font-size:32px;margin-bottom:8px">💊</div>
        <strong>Nenhum medicamento por aqui.</strong>
        <p>Use o formulário acima para cadastrar seu primeiro medicamento.</p>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(medication => {
    const times = schedulesByMedication[medication.id] || [];
    const timeText = times.length
      ? times.map(time => escapeHTML(String(time).slice(0, 5))).join(" • ")
      : "Nenhum horário cadastrado";

    const status = medication.status || "active";
    let actions = "";

    if (status === "active") {
      actions = `
        <button class="action-edit" data-action="edit" data-id="${medication.id}">Editar</button>
        <button class="action-pause" data-action="pause" data-id="${medication.id}">Pausar</button>
        <button class="action-complete" data-action="complete" data-id="${medication.id}">Concluir</button>`;
    } else if (status === "paused") {
      actions = `
        <button class="action-edit" data-action="edit" data-id="${medication.id}">Editar</button>
        <button class="action-resume" data-action="resume" data-id="${medication.id}">Retomar</button>
        <button class="action-complete" data-action="complete" data-id="${medication.id}">Concluir</button>`;
    }

    return `
      <article class="medication-card">
        <div class="medication-card-top">
          <div>
            <h3>${escapeHTML(medication.name)}</h3>
            <p class="medication-dose">${escapeHTML(medication.dose)}</p>
          </div>
          <span class="status status-${escapeHTML(status)}">${statusLabel(status)}</span>
        </div>

        <div class="card-details">
          <p><strong>Horários:</strong> ${timeText}</p>
          <p><strong>Início:</strong> ${escapeHTML(medication.start_date || "Não informado")}</p>
          <p><strong>Duração:</strong> ${escapeHTML(medication.prescribed_days)} dias</p>
          ${medication.instructions
            ? `<p><strong>Instruções:</strong> ${escapeHTML(medication.instructions)}</p>`
            : ""}
        </div>

        ${actions ? `<div class="card-actions">${actions}</div>` : ""}
      </article>`;
  }).join("");
}

function updateCounters() {
  $("activeCount").textContent =
    medications.filter(item => item.status === "active").length;
  $("pausedCount").textContent =
    medications.filter(item => item.status === "paused").length;
  $("completedCount").textContent =
    medications.filter(item => item.status === "completed").length;
}

/* -------------------- EVENTOS -------------------- */

function configureEvents() {
  $("loginForm").addEventListener("submit", login);
  $("registerForm").addEventListener("submit", register);
  $("recoveryForm").addEventListener("submit", recoverPassword);
  $("medicationForm").addEventListener("submit", saveMedication);

  $("showRegister").addEventListener("click", () => showAuthBox("registerBox"));
  $("showRecovery").addEventListener("click", () => showAuthBox("recoveryBox"));
  $("showLoginFromRegister").addEventListener("click", () => showAuthBox("loginBox"));
  $("showLoginFromRecovery").addEventListener("click", () => showAuthBox("loginBox"));

  $("logoutButton").addEventListener("click", logout);
  $("addTimeButton").addEventListener("click", () => addTimeRow("12:00"));

  $("cancelEditButton").addEventListener("click", resetMedicationForm);

  $("filters").addEventListener("click", event => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;

    currentFilter = button.dataset.filter;

    document.querySelectorAll(".filter-button").forEach(item => {
      item.classList.toggle("selected", item === button);
    });

    renderMedications();
  });

  $("medicationList").addEventListener("click", event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const id = button.dataset.id;
    const action = button.dataset.action;

    if (action === "edit") editMedication(id);
    if (action === "pause") changeMedicationStatus(id, "paused");
    if (action === "resume") changeMedicationStatus(id, "active");
    if (action === "complete") changeMedicationStatus(id, "completed");
  });
}

/* -------------------- INICIALIZAÇÃO -------------------- */

async function initializeApp() {
  configureEvents();
  resetMedicationForm();

  if (!window.supabase || !window.supabase.createClient) {
    showMessage("Não foi possível carregar o serviço de acesso. Atualize a página.", true);
    return;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    showMessage("Não foi possível verificar seu acesso. Entre novamente.", true);
    showLogin();
    return;
  }

  if (data.session?.user) {
    showApplication(data.session.user);
  } else {
    showLogin();
  }

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session?.user) {
      showApplication(session.user);
    }

    if (event === "SIGNED_OUT") {
      showLogin();
    }
  });
}

document.addEventListener("DOMContentLoaded", initializeApp);
