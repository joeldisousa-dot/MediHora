
/* =========================================================
   MEDIHORA
   Interface: GitHub Pages
   Banco de dados: Supabase
   ========================================================= */

const SUPABASE_URL = "https://dtwfettaesywyczfyvpr.supabase.co";
const SUPABASE_KEY = "sb_publishable_WsqtiIuq2h_4e1gtVGg8PQ_L4LW7px0";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let medications = [];
let schedules = [];
let currentFilter = "all";
let authMode = "login";
let saving = false;

const $ = (id) => document.getElementById(id);

function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  if (!value) return "Não informado";
  const parts = value.split("-");
  if (parts.length !== 3) return value;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function statusLabel(status) {
  return {
    active: "Em uso",
    paused: "Pausado",
    completed: "Concluído"
  }[status] || status;
}

function getMedicationSchedules(medicationId) {
  return schedules
    .filter(item => item.medication_id === medicationId && item.enabled !== false)
    .sort((a, b) => String(a.scheduled_time).localeCompare(String(b.scheduled_time)));
}

function cleanTime(value) {
  return String(value || "").slice(0, 5);
}

function getNextTime(medicationId) {
  const times = getMedicationSchedules(medicationId);
  if (!times.length) return "Horários não cadastrados";

  const now = new Date();
  const current = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const upcoming = times.find(item => cleanTime(item.scheduled_time) >= current);

  if (upcoming) return cleanTime(upcoming.scheduled_time);

  return `${cleanTime(times[0].scheduled_time)} (amanhã)`;
}

/* =========================================================
   AUTENTICAÇÃO
   ========================================================= */

function setAuthMode(mode) {
  authMode = mode;

  $("nameGroup").classList.toggle("hidden", mode !== "register");
  $("forgotPassword").classList.toggle("hidden", mode !== "login");

  if (mode === "register") {
    $("authTitle").textContent = "Criar minha conta";
    $("authDescription").textContent = "Preencha seus dados para começar.";
    $("authSubmit").textContent = "Criar conta";
    $("switchText").textContent = "Já tem uma conta?";
    $("switchAuth").textContent = "Entrar";
  } else {
    $("authTitle").textContent = "Bem-vindo!";
    $("authDescription").textContent =
      "Entre na sua conta para acompanhar seus medicamentos.";
    $("authSubmit").textContent = "Entrar";
    $("switchText").textContent = "Ainda não tem uma conta?";
    $("switchAuth").textContent = "Criar conta";
  }

  showMessage($("authMessage"), "");
}

$("switchAuth").addEventListener("click", () => {
  setAuthMode(authMode === "login" ? "register" : "login");
});

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("email").value.trim();
  const password = $("password").value;
  const fullName = $("fullName").value.trim();

  $("authSubmit").disabled = true;
  showMessage($("authMessage"), "Aguarde...");

  try {
    if (authMode === "register") {
      if (!fullName) {
        throw new Error("Informe seu nome.");
      }

      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: window.location.origin + window.location.pathname
        }
      });

      if (error) throw error;

      if (data.session) {
        showMessage($("authMessage"), "Conta criada com sucesso!");
      } else {
        showMessage(
          $("authMessage"),
          "Conta criada! Verifique seu e-mail para confirmar o cadastro."
        );
      }
    } else {
      const { error } = await db.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;
    }
  } catch (error) {
    showMessage($("authMessage"), error.message || "Não foi possível continuar.", true);
  } finally {
    $("authSubmit").disabled = false;
  }
});

$("forgotPassword").addEventListener("click", async () => {
  const email = $("email").value.trim();

  if (!email) {
    showMessage($("authMessage"), "Informe seu e-mail primeiro.", true);
    $("email").focus();
    return;
  }

  showMessage($("authMessage"), "Enviando solicitação...");

  try {
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });

    if (error) throw error;

    showMessage(
      $("authMessage"),
      "Se o endereço estiver cadastrado, você receberá um e-mail para redefinir a senha."
    );
  } catch (error) {
    showMessage($("authMessage"), error.message, true);
  }
});

$("logoutButton").addEventListener("click", async () => {
  const { error } = await db.auth.signOut();

  if (error) {
    showMessage($("appMessage"), error.message, true);
  }
});

/* =========================================================
   MOSTRAR E ESCONDER TELAS
   ========================================================= */

function showApp(user) {
  currentUser = user;
  $("authView").classList.add("hidden");
  $("appView").classList.remove("hidden");

  const metadataName = user.user_metadata?.full_name;
  const firstName = metadataName
    ? metadataName.trim().split(/\s+/)[0]
    : user.email.split("@")[0];

  $("userName").textContent = firstName || "tudo bem?";

  loadData();
}

function showLogin() {
  currentUser = null;
  medications = [];
  schedules = [];

  $("appView").classList.add("hidden");
  $("authView").classList.remove("hidden");
}

db.auth.onAuthStateChange((event, session) => {
  if (session?.user) {
    showApp(session.user);
  } else {
    showLogin();
  }
});

async function checkSession() {
  const { data, error } = await db.auth.getSession();

  if (error) {
    showMessage($("authMessage"), error.message, true);
    return;
  }

  if (data.session?.user) {
    showApp(data.session.user);
  } else {
    showLogin();
  }
}

/* =========================================================
   CARREGAMENTO DOS DADOS
   ========================================================= */

async function loadData() {
  if (!currentUser) return;

  $("loading").classList.remove("hidden");
  $("emptyState").classList.add("hidden");
  $("medicationList").innerHTML = "";

  try {
    const [medicationResult, scheduleResult] = await Promise.all([
      db.from("medications")
        .select("*")
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false }),

      db.from("medication_schedules")
        .select("*")
        .eq("user_id", currentUser.id)
    ]);

    if (medicationResult.error) throw medicationResult.error;
    if (scheduleResult.error) throw scheduleResult.error;

    medications = medicationResult.data || [];
    schedules = scheduleResult.data || [];

    updateCounters();
    renderMedications();
  } catch (error) {
    showMessage(
      $("appMessage"),
      "Não foi possível carregar os dados: " + error.message,
      true
    );
  } finally {
    $("loading").classList.add("hidden");
  }
}

function updateCounters() {
  $("activeCount").textContent =
    medications.filter(item => item.status === "active").length;

  $("pausedCount").textContent =
    medications.filter(item => item.status === "paused").length;

  $("completedCount").textContent =
    medications.filter(item => item.status === "completed").length;
}

/* =========================================================
   LISTAGEM DOS MEDICAMENTOS
   ========================================================= */

function renderMedications() {
  const list = $("medicationList");
  list.innerHTML = "";

  const filtered = medications.filter(item =>
    currentFilter === "all" || item.status === currentFilter
  );

  if (filtered.length === 0) {
    $("emptyState").classList.remove("hidden");
    $("emptyState").querySelector("h3").textContent =
      medications.length === 0
        ? "Nenhum medicamento por aqui"
        : "Nenhum medicamento nesta categoria";

    $("emptyState").querySelector("p").textContent =
      medications.length === 0
        ? "Adicione seu primeiro medicamento para organizar seus horários."
        : "Experimente selecionar outra categoria.";

    $("emptyAddButton").classList.toggle("hidden", medications.length > 0);
    return;
  }

  $("emptyState").classList.add("hidden");

  filtered.forEach(medication => {
    const times = getMedicationSchedules(medication.id);
    const timesText = times.length
      ? times.map(item => cleanTime(item.scheduled_time)).join(" • ")
      : "Nenhum horário cadastrado";

    const nextTime = medication.status === "active"
      ? getNextTime(medication.id)
      : "—";

    const card = document.createElement("article");
    card.className = "medication-card";

    card.innerHTML = `
      <div class="medication-top">
        <div>
          <h3>${escapeHTML(medication.name)}</h3>
          <p class="dose">${escapeHTML(medication.dose)}</p>
        </div>
        <span class="status ${escapeHTML(medication.status)}">
          ${statusLabel(medication.status)}
        </span>
      </div>

      <div class="card-info">
        <p><strong>Horários:</strong> ${escapeHTML(timesText)}</p>
        <p><strong>Próximo horário:</strong> ${escapeHTML(nextTime)}</p>
        <p><strong>Início:</strong> ${formatDate(medication.start_date)}</p>
        <p><strong>Duração:</strong> ${Number(medication.prescribed_days)} dias</p>
        ${medication.instructions
          ? `<p><strong>Orientações:</strong> ${escapeHTML(medication.instructions)}</p>`
          : ""}
      </div>

      <div class="card-actions">
        <button type="button" data-action="edit" data-id="${medication.id}">
          Editar
        </button>

        ${medication.status === "active" ? `
          <button type="button" data-action="pause" data-id="${medication.id}">
            Pausar
          </button>
        ` : ""}

        ${medication.status === "paused" ? `
          <button type="button" data-action="resume" data-id="${medication.id}">
            Retomar
          </button>
        ` : ""}

        ${medication.status !== "completed" ? `
          <button type="button" class="danger-action"
                  data-action="complete" data-id="${medication.id}">
            Concluir
          </button>
        ` : ""}
      </div>
    `;

    list.appendChild(card);
  });
}

/* =========================================================
   FILTROS
   ========================================================= */

document.querySelectorAll(".filter").forEach(button => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;

    document.querySelectorAll(".filter").forEach(item => {
      item.classList.toggle("active", item === button);
    });

    renderMedications();
  });
});

/* =========================================================
   FORMULÁRIO E HORÁRIOS
   ========================================================= */

function buildTimeFields(count, existingTimes = []) {
  const container = $("timeFields");
  container.innerHTML = "";

  for (let index = 0; index < count; index++) {
    const defaultTimes = ["08:00", "12:00", "18:00", "22:00"];
    const value = existingTimes[index]
      ? cleanTime(existingTimes[index].scheduled_time || existingTimes[index])
      : defaultTimes[index];

    const field = document.createElement("div");
    field.className = "time-field";

    field.innerHTML = `
      <label for="scheduleTime${index}">Horário ${index + 1}</label>
      <input id="scheduleTime${index}" type="time" required
             value="${escapeHTML(value)}">
    `;

    container.appendChild(field);
  }
}

$("frequency").addEventListener("change", () => {
  buildTimeFields(Number($("frequency").value));
});

function openModal(medication = null) {
  $("medicationForm").reset();
  $("medicationId").value = "";
  $("modalTitle").textContent = "Adicionar medicamento";
  $("saveMedication").textContent = "Salvar medicamento";
  $("scheduleFields").classList.remove("hidden");
  $("editScheduleNote").classList.add("hidden");

  $("medStart").value = localDateString();
  $("frequency").value = "1";
  buildTimeFields(1);

  if (medication) {
    $("modalTitle").textContent = "Editar medicamento";
    $("saveMedication").textContent = "Salvar alterações";

    $("medicationId").value = medication.id;
    $("medName").value = medication.name || "";
    $("medDose").value = medication.dose || "";
    $("medInstructions").value = medication.instructions || "";
    $("medStart").value = medication.start_date || localDateString();
    $("medDays").value = medication.prescribed_days || "";

    $("scheduleFields").classList.add("hidden");
    $("editScheduleNote").classList.remove("hidden");
  }

  $("modal").classList.remove("hidden");
  $("medName").focus();
}

function closeModal() {
  $("modal").classList.add("hidden");
}

$("addButton").addEventListener("click", () => openModal());
$("emptyAddButton").addEventListener("click", () => openModal());
$("closeModal").addEventListener("click", closeModal);
$("cancelModal").addEventListener("click", closeModal);

$("modal").addEventListener("click", (event) => {
  if (event.target === $("modal")) closeModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

/* =========================================================
   SALVAR MEDICAMENTO
   ========================================================= */

$("medicationForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser || saving) return;

  const medicationId = $("medicationId").value;
  const name = $("medName").value.trim();
  const dose = $("medDose").value.trim();
  const instructions = $("medInstructions").value.trim();
  const startDate = $("medStart").value;
  const prescribedDays = Number($("medDays").value);

  if (!name || !dose || !startDate || !prescribedDays) {
    showMessage($("appMessage"), "Preencha os campos obrigatórios.", true);
    return;
  }

  if (prescribedDays < 1 || prescribedDays > 3650) {
    showMessage($("appMessage"), "Informe uma duração válida.", true);
    return;
  }

  saving = true;
  $("saveMedication").disabled = true;
  $("saveMedication").textContent = "Salvando...";

  try {
    const medicationData = {
      name,
      dose,
      instructions: instructions || null,
      start_date: startDate,
      prescribed_days: prescribedDays,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo",
      updated_at: new Date().toISOString()
    };

    if (medicationId) {
      const { error } = await db.from("medications")
        .update(medicationData)
        .eq("id", medicationId)
        .eq("user_id", currentUser.id);

      if (error) throw error;

      showMessage($("appMessage"), "Medicamento atualizado!");
    } else {
      const { data: newMedication, error } = await db.from("medications")
        .insert({
          ...medicationData,
          user_id: currentUser.id,
          status: "active"
        })
        .select()
        .single();

      if (error) throw error;

      const frequency = Number($("frequency").value);
      const newSchedules = [];

      for (let index = 0; index < frequency; index++) {
        const timeInput = $(`scheduleTime${index}`);

        if (!timeInput || !timeInput.value) {
          throw new Error(`Informe o horário ${index + 1}.`);
        }

        newSchedules.push({
          user_id: currentUser.id,
          medication_id: newMedication.id,
          scheduled_time: timeInput.value,
          enabled: true
        });
      }

      const { error: scheduleError } = await db
        .from("medication_schedules")
        .insert(newSchedules);

      if (scheduleError) {
        // Evita deixar um medicamento sem os horários que foram solicitados.
        await db.from("medications")
          .delete()
          .eq("id", newMedication.id)
          .eq("user_id", currentUser.id);

        throw scheduleError;
      }

      showMessage($("appMessage"), "Medicamento cadastrado com sucesso!");
    }

    closeModal();
    await loadData();

  } catch (error) {
    showMessage(
      $("appMessage"),
      "Não foi possível salvar: " + (error.message || "Erro desconhecido."),
      true
    );
  } finally {
    saving = false;
    $("saveMedication").disabled = false;
    $("saveMedication").textContent = medicationId
      ? "Salvar alterações"
      : "Salvar medicamento";
  }
});

/* =========================================================
   EDITAR, PAUSAR, RETOMAR E CONCLUIR
   ========================================================= */

$("medicationList").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || !currentUser) return;

  const action = button.dataset.action;
  const medication = medications.find(item => item.id === button.dataset.id);

  if (!medication) return;

  if (action === "edit") {
    openModal(medication);
    return;
  }

  let newStatus = null;
  let confirmation = "";

  if (action === "pause") {
    newStatus = "paused";
    confirmation = "Deseja pausar este medicamento?";
  } else if (action === "resume") {
    newStatus = "active";
    confirmation = "Deseja retomar este medicamento?";
  } else if (action === "complete") {
    newStatus = "completed";
    confirmation =
      "Deseja marcar este tratamento como concluído? Esta ação não apaga o histórico.";
  }

  if (!newStatus || !window.confirm(confirmation)) return;

  button.disabled = true;

  try {
    const { error } = await db.from("medications")
      .update({
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq("id", medication.id)
      .eq("user_id", currentUser.id);

    if (error) throw error;

    showMessage($("appMessage"), "Situação atualizada.");
    await loadData();

  } catch (error) {
    showMessage($("appMessage"), error.message, true);
    button.disabled = false;
  }
});

/* =========================================================
   INICIALIZAÇÃO
   ========================================================= */

checkSession();
