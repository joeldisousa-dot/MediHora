
/* ============================================================
   MEDIHORA
   Aplicativo de organização de medicamentos
   Supabase + GitHub Pages
   ============================================================ */

const SUPABASE_URL = "https://dtwfettaesywyczfyvpr.supabase.co";
const SUPABASE_KEY = "sb_publishable_WsqtiIuq2h_4e1gtVGg8PQ_L4LW7px0";
const APP_TIMEZONE = "America/Sao_Paulo";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true
    }
  }
);

let currentUser = null;
let medications = [];
let schedulesByMedication = {};
let editingMedicationId = null;
let restockMedicationId = null;
let toastTimeout = null;
let savingMedication = false;
let savingRestock = false;
let passwordRecoveryInProgress = false;
let applicationLoading = false;

const $ = id => document.getElementById(id);

/* ============================================================
   DATA, FORMATAÇÃO E MENSAGENS
   ============================================================ */

function todayLocalDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function nextDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function localDayBounds() {
  const date = todayLocalDate();

  return {
    start: `${date}T00:00:00-03:00`,
    end: `${nextDate(date)}T00:00:00-03:00`
  };
}

function localScheduleTimestamp(dateString, timeString) {
  return `${dateString}T${String(timeString).slice(0, 5)}:00-03:00`;
}

function formatDate(dateString) {
  if (!dateString) return "";

  const [year, month, day] = dateString.split("-").map(Number);

  return new Date(year, month - 1, day).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

function formatQuantity(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    maximumFractionDigits: 2
  });
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function showMessage(message, isError = false) {
  const toast = $("toast");

  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");

  clearTimeout(toastTimeout);

  toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
}

function cleanTime(value) {
  return String(value || "").slice(0, 5);
}

function showAuthPanel(panelId) {
  [
    "loginPanel",
    "registerPanel",
    "recoveryPanel",
    "passwordResetPanel"
  ].forEach(id => {
    const panel = $(id);
    if (panel) {
      panel.classList.toggle("hidden", id !== panelId);
    }
  });

  $("authSection").classList.remove("hidden");
  $("appSection").classList.add("hidden");
}

/* ============================================================
   AUTENTICAÇÃO
   ============================================================ */

async function handleRegister(event) {
  event.preventDefault();

  const name = $("registerName").value.trim();
  const email = $("registerEmail").value.trim();
  const password = $("registerPassword").value;

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name
        },
        emailRedirectTo:
          window.location.origin + window.location.pathname
      }
    });

    if (error) throw error;

    if (data.session && data.user) {
      await showApplication(data.user);
      showMessage("Conta criada com sucesso!");
    } else {
      showMessage(
        "Cadastro realizado! Confira seu e-mail para confirmar a conta."
      );
      showAuthPanel("loginPanel");
    }
  } catch (error) {
    console.error("Erro no cadastro:", error);
    showMessage(
      error.message || "Não foi possível criar a conta.",
      true
    );
  }
}

async function handleLogin(event) {
  event.preventDefault();

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  const button = $("loginForm").querySelector(
    'button[type="submit"]'
  );

  button.disabled = true;
  button.textContent = "Entrando...";

  try {
    const { data, error } =
      await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

    if (error) throw error;

    passwordRecoveryInProgress = false;

    await showApplication(data.user);

    showMessage("Bem-vindo(a) ao MediHora!");
  } catch (error) {
    console.error("Erro no login:", error);

    showMessage(
      error.message || "E-mail ou senha inválidos.",
      true
    );
  } finally {
    button.disabled = false;
    button.textContent = "Entrar";
  }
}

async function handleRecovery(event) {
  event.preventDefault();

  const email = $("recoveryEmail").value.trim();
  const button = $("recoveryForm").querySelector(
    'button[type="submit"]'
  );

  button.disabled = true;
  button.textContent = "Enviando...";

  try {
    const redirectUrl =
      window.location.origin + window.location.pathname;

    const { error } =
      await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl
      });

    if (error) throw error;

    $("recoveryForm").reset();

    showMessage(
      "Link enviado! Abra o e-mail no mesmo navegador em que usa o MediHora."
    );

    showAuthPanel("loginPanel");
  } catch (error) {
    console.error("Erro ao solicitar recuperação:", error);

    showMessage(
      error.message || "Não foi possível enviar o link.",
      true
    );
  } finally {
    button.disabled = false;
    button.textContent = "Enviar link";
  }
}

/*
  O Supabase envia o evento PASSWORD_RECOVERY quando o usuário
  abre um link válido de recuperação de senha.

  Nesse momento, mostramos o formulário de nova senha,
  em vez de abrir diretamente a área dos medicamentos.
*/

function openPasswordResetScreen() {
  passwordRecoveryInProgress = true;
  currentUser = null;

  $("appSection").classList.add("hidden");
  $("authSection").classList.remove("hidden");
  $("logoutButton").classList.add("hidden");

  showAuthPanel("passwordResetPanel");

  $("passwordResetForm").reset();

  showMessage("Link validado. Cadastre sua nova senha.");
}

async function handlePasswordUpdate(event) {
  event.preventDefault();

  if (!passwordRecoveryInProgress) {
    showMessage(
      "Solicite um novo link de recuperação pelo e-mail.",
      true
    );
    return;
  }

  const password = $("newPassword").value;
  const confirmation = $("confirmNewPassword").value;

  if (password.length < 6) {
    showMessage(
      "A senha precisa ter pelo menos 6 caracteres.",
      true
    );
    return;
  }

  if (password !== confirmation) {
    showMessage("As senhas não são iguais.", true);
    return;
  }

  const button = $("passwordResetForm").querySelector(
    'button[type="submit"]'
  );

  button.disabled = true;
  button.textContent = "Salvando...";

  try {
    const { error } = await supabaseClient.auth.updateUser({
      password
    });

    if (error) throw error;

    passwordRecoveryInProgress = false;

    $("passwordResetForm").reset();

    /*
      Encerramos a sessão de recuperação para que o próximo
      acesso seja feito com o e-mail e a nova senha.
    */

    const { error: logoutError } =
      await supabaseClient.auth.signOut();

    if (logoutError) {
      console.warn(
        "A senha foi alterada, mas a sessão não foi encerrada:",
        logoutError
      );
    }

    currentUser = null;
    medications = [];
    schedulesByMedication = {};

    $("appSection").classList.add("hidden");
    $("authSection").classList.remove("hidden");
    $("logoutButton").classList.add("hidden");

    $("loginEmail").value = $("recoveryEmail").value.trim();
    $("loginPassword").value = "";

    showAuthPanel("loginPanel");

    showMessage(
      "Senha alterada com sucesso! Entre usando sua nova senha."
    );
  } catch (error) {
    console.error("Erro ao atualizar senha:", error);

    showMessage(
      error.message || "Não foi possível alterar a senha.",
      true
    );
  } finally {
    button.disabled = false;
    button.textContent = "Salvar nova senha";
  }
}

async function logout() {
  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    showMessage(error.message, true);
    return;
  }

  currentUser = null;
  medications = [];
  schedulesByMedication = {};
  passwordRecoveryInProgress = false;

  closeRestockForm(false);

  $("appSection").classList.add("hidden");
  $("authSection").classList.remove("hidden");
  $("logoutButton").classList.add("hidden");

  showAuthPanel("loginPanel");

  showMessage("Você saiu da sua conta.");
}

async function showApplication(user) {
  if (!user || passwordRecoveryInProgress || applicationLoading) {
    return;
  }

  applicationLoading = true;
  currentUser = user;

  try {
    $("authSection").classList.add("hidden");
    $("appSection").classList.remove("hidden");
    $("logoutButton").classList.remove("hidden");

    const metadata = user.user_metadata || {};

    const displayName =
      metadata.full_name ||
      user.email?.split("@")[0] ||
      "bem-vindo(a)";

    $("userName").textContent = displayName;
    $("medicationStartDate").value = todayLocalDate();

    await loadMedications();
  } finally {
    applicationLoading = false;
  }
}

/* ============================================================
   CARREGAR MEDICAMENTOS, HORÁRIOS E REGISTROS DO DIA
   ============================================================ */

async function loadMedications() {
  if (!currentUser) return;

  try {
    const {
      data: medicationData,
      error: medicationError
    } = await supabaseClient
      .from("medications")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("name", { ascending: true });

    if (medicationError) throw medicationError;

    medications = medicationData || [];
    schedulesByMedication = {};

    if (medications.length) {
      const medicationIds = medications.map(item => item.id);

      const {
        data: scheduleData,
        error: scheduleError
      } = await supabaseClient
        .from("medication_schedules")
        .select("*")
        .in("medication_id", medicationIds)
        .eq("user_id", currentUser.id)
        .eq("enabled", true)
        .order("scheduled_time", { ascending: true });

      if (scheduleError) throw scheduleError;

      (scheduleData || []).forEach(schedule => {
        if (!schedulesByMedication[schedule.medication_id]) {
          schedulesByMedication[schedule.medication_id] = [];
        }

        schedulesByMedication[schedule.medication_id].push(schedule);
      });
    }

    const allSchedules =
      Object.values(schedulesByMedication).flat();

    if (allSchedules.length) {
      const bounds = localDayBounds();

      const {
        data: logs,
        error: logsError
      } = await supabaseClient
        .from("dose_logs")
        .select("schedule_id,status,scheduled_for")
        .in(
          "schedule_id",
          allSchedules.map(item => item.id)
        )
        .eq("user_id", currentUser.id)
        .gte("scheduled_for", bounds.start)
        .lt("scheduled_for", bounds.end);

      if (logsError) throw logsError;

      const statusBySchedule = new Map(
        (logs || []).map(log => [
          log.schedule_id,
          log.status
        ])
      );

      allSchedules.forEach(schedule => {
        schedule.doseStatus =
          statusBySchedule.get(schedule.id) || "pending";
      });
    }

    $("todayDate").textContent =
      formatDate(todayLocalDate());

    updateCounters();
    renderMedications();
    renderTodayMedications();

  } catch (error) {
    console.error("Erro ao carregar medicamentos:", error);

    showMessage(
      error.message || "Erro ao carregar seus medicamentos.",
      true
    );
  }
}

/* ============================================================
   PAINEL DE HOJE E REGISTRO DE DOSES
   ============================================================ */

function isMedicationScheduledToday(medication) {
  if (medication.status !== "active") return false;

  const today = todayLocalDate();

  if (medication.start_date && medication.start_date > today) {
    return false;
  }

  if (medication.start_date && medication.prescribed_days) {
    const [year, month, day] =
      medication.start_date.split("-").map(Number);

    const end = new Date(Date.UTC(year, month - 1, day));

    end.setUTCDate(
      end.getUTCDate() + Number(medication.prescribed_days) - 1
    );

    const endDate = [
      end.getUTCFullYear(),
      String(end.getUTCMonth() + 1).padStart(2, "0"),
      String(end.getUTCDate()).padStart(2, "0")
    ].join("-");

    if (today > endDate) return false;
  }

  return true;
}

function periodEmoji(time) {
  const hour = Number(String(time).slice(0, 2));

  if (hour >= 6 && hour < 12) return "☀️";
  if (hour >= 12 && hour < 18) return "🌤️";

  return "🌙";
}

function renderTodayMedications() {
  const container = $("todayMedicationList");

  const items = medications
    .filter(isMedicationScheduledToday)
    .map(medication => ({
      medication,
      schedules:
        schedulesByMedication[medication.id] || []
    }))
    .filter(item => item.schedules.length > 0);

  if (!items.length) {
    container.innerHTML = `
      <div class="today-empty">
        <div style="font-size:32px">💊</div>
        <strong>Nenhum medicamento programado para hoje.</strong>
        <p>Cadastre um medicamento para visualizar seus horários aqui.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map(({ medication, schedules }) => {
    const stockUnit =
      medication.stock_unit || "unidades";

    const currentStock =
      formatQuantity(medication.stock_quantity);

    const doseCards = schedules.map(schedule => {
      const status = schedule.doseStatus || "pending";
      const time = cleanTime(schedule.scheduled_time);

      const statusText =
        status === "taken"
          ? "💎 Tomado"
          : status === "not_taken"
            ? "😟 Não tomado"
            : "⏳ Aguardando registro";

      const statusEmoji =
        status === "taken"
          ? "💎"
          : status === "not_taken"
            ? "😟"
            : "⏳";

      const stockInfo = status === "taken" ? `
        <div class="dose-stock-info">
          <span>📦</span>
          <span>
            Estoque restante:
            <strong>${escapeHTML(currentStock)} ${escapeHTML(stockUnit)}</strong>
          </span>
        </div>
      ` : "";

      return `
        <div class="today-dose status-${escapeHTML(status)}">
          <div class="today-dose-heading">
            <span class="today-dose-time">
              ${periodEmoji(time)} Às ${escapeHTML(time)}
            </span>
            <span class="today-dose-state">
              ${statusText}
            </span>
          </div>

          <p>
            Quantidade desta dose:
            ${escapeHTML(formatQuantity(schedule.dose_quantity))}
            ${escapeHTML(stockUnit)}
          </p>

          <div class="today-dose-actions">
            <button
              type="button"
              class="button-taken ${status === "taken" ? "selected" : ""}"
              data-action="today-taken"
              data-id="${escapeHTML(schedule.id)}"
              data-time="${escapeHTML(time)}"
              ${status === "taken" ? "disabled" : ""}
            >
              Tomado
            </button>

            <button
              type="button"
              class="button-not-taken ${status === "not_taken" ? "selected" : ""}"
              data-action="today-not-taken"
              data-id="${escapeHTML(schedule.id)}"
              data-time="${escapeHTML(time)}"
              ${status === "taken" ? "disabled" : ""}
            >
              Não tomado
            </button>
          </div>

          ${stockInfo}
        </div>
      `;
    }).join("");

    return `
      <article class="today-medication-card">
        <h3>${escapeHTML(medication.name)}</h3>
        <p class="medication-dose">
          ${escapeHTML(medication.dose)}
        </p>
        ${doseCards}
      </article>
    `;
  }).join("");
}

async function markDoseTaken(scheduleId, time) {
  const scheduledFor =
    localScheduleTimestamp(todayLocalDate(), time);

  try {
    const { data, error } =
      await supabaseClient.rpc("mark_dose_taken", {
        p_schedule_id: scheduleId,
        p_scheduled_for: scheduledFor
      });

    if (error) throw error;

    await loadMedications();

    showMessage(
      data?.already_taken
        ? "Esta dose já estava registrada como tomada."
        : "Dose registrada como tomada. Estoque atualizado."
    );

  } catch (error) {
    console.error(error);

    showMessage(
      error.message || "Não foi possível registrar a dose.",
      true
    );
  }
}

async function markDoseNotTaken(scheduleId, time) {
  if (!confirm("Confirma que esta dose não foi tomada?")) {
    return;
  }

  const scheduledFor =
    localScheduleTimestamp(todayLocalDate(), time);

  try {
    const { error } =
      await supabaseClient.rpc("mark_dose_not_taken", {
        p_schedule_id: scheduleId,
        p_scheduled_for: scheduledFor
      });

    if (error) throw error;

    await loadMedications();

    showMessage("Registro atualizado: dose não tomada.");

  } catch (error) {
    console.error(error);

    showMessage(
      error.message || "Não foi possível registrar a dose.",
      true
    );
  }
}

/* ============================================================
   CADASTRO E EDIÇÃO DE MEDICAMENTOS
   ============================================================ */

function addScheduleRow(time = "", quantity = "1") {
  const row = document.createElement("div");

  row.className = "schedule-row";

  row.innerHTML = `
    <div>
      <label>Horário</label>
      <input
        class="schedule-time"
        type="time"
        required
        value="${escapeHTML(time)}"
      >
    </div>

    <div>
      <label>Quantidade por horário</label>
      <input
        class="schedule-quantity"
        type="number"
        min="0.01"
        step="0.01"
        required
        value="${escapeHTML(quantity)}"
      >
    </div>

    <button class="remove-schedule" type="button">
      Remover
    </button>
  `;

  row.querySelector(".remove-schedule").addEventListener(
    "click",
    () => {
      const rows =
        $("scheduleList").querySelectorAll(".schedule-row");

      if (rows.length <= 1) {
        showMessage("Mantenha pelo menos um horário.", true);
        return;
      }

      row.remove();
    }
  );

  $("scheduleList").appendChild(row);
}

function resetMedicationForm() {
  editingMedicationId = null;

  $("medicationForm").reset();
  $("medicationId").value = "";

  $("formTitle").textContent = "Novo medicamento";
  $("saveMedicationButton").textContent =
    "Salvar medicamento";

  $("medicationStartDate").value = todayLocalDate();
  $("medicationStock").value = "0";
  $("medicationUnit").value = "comprimidos";

  $("scheduleList").innerHTML = "";

  addScheduleRow();
}

function openNewMedicationForm() {
  closeRestockForm(false);
  resetMedicationForm();

  $("medicationPanel").classList.remove("hidden");

  $("medicationPanel").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function closeMedicationForm() {
  resetMedicationForm();
  $("medicationPanel").classList.add("hidden");
}

function fillMedicationForm(medication, schedules) {
  editingMedicationId = medication.id;

  $("medicationId").value = medication.id;
  $("medicationName").value = medication.name || "";
  $("medicationDose").value = medication.dose || "";

  $("medicationUnit").value =
    medication.stock_unit || "comprimidos";

  $("medicationStock").value =
    medication.stock_quantity ?? 0;

  $("medicationStartDate").value =
    medication.start_date || todayLocalDate();

  $("medicationDays").value =
    medication.prescribed_days || "";

  $("medicationInstructions").value =
    medication.instructions || "";

  $("formTitle").textContent = "Editar medicamento";
  $("saveMedicationButton").textContent =
    "Salvar alterações";

  $("scheduleList").innerHTML = "";

  if (schedules.length) {
    schedules.forEach(schedule => {
      addScheduleRow(
        cleanTime(schedule.scheduled_time),
        String(schedule.dose_quantity || 1)
      );
    });
  } else {
    addScheduleRow();
  }
}

function editMedication(id) {
  const medication =
    medications.find(item => item.id === id);

  if (!medication) return;

  if (medication.status === "completed") {
    showMessage(
      "Tratamentos concluídos não podem ser editados.",
      true
    );
    return;
  }

  closeRestockForm(false);

  fillMedicationForm(
    medication,
    schedulesByMedication[id] || []
  );

  $("medicationPanel").classList.remove("hidden");

  $("medicationPanel").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

async function saveMedication(event) {
  event.preventDefault();

  if (!currentUser || savingMedication) return;

  const wasEditing = Boolean(editingMedicationId);

  const name = $("medicationName").value.trim();
  const dose = $("medicationDose").value.trim();
  const stockUnit = $("medicationUnit").value;

  const stockQuantity =
    Number($("medicationStock").value || 0);

  const startDate = $("medicationStartDate").value;

  const prescribedDays = $("medicationDays").value
    ? Number($("medicationDays").value)
    : null;

  const instructions =
    $("medicationInstructions").value.trim();

  if (!name || !dose || !startDate) {
    showMessage("Preencha os campos obrigatórios.", true);
    return;
  }

  if (
    !Number.isFinite(stockQuantity) ||
    stockQuantity < 0
  ) {
    showMessage("O estoque não pode ser negativo.", true);
    return;
  }

  if (
    prescribedDays !== null &&
    (!Number.isInteger(prescribedDays) || prescribedDays < 1)
  ) {
    showMessage(
      "Informe uma duração válida em dias.",
      true
    );
    return;
  }

  const scheduleValues = [
    ...$("scheduleList").querySelectorAll(".schedule-row")
  ].map(row => ({
    scheduled_time:
      row.querySelector(".schedule-time").value,

    dose_quantity:
      Number(row.querySelector(".schedule-quantity").value)
  }));

  if (
    !scheduleValues.length ||
    scheduleValues.some(item =>
      !item.scheduled_time ||
      !Number.isFinite(item.dose_quantity) ||
      item.dose_quantity <= 0
    )
  ) {
    showMessage(
      "Confira os horários e as quantidades informadas.",
      true
    );
    return;
  }

  const uniqueTimes =
    scheduleValues.map(item => item.scheduled_time);

  if (new Set(uniqueTimes).size !== uniqueTimes.length) {
    showMessage(
      "Não repita o mesmo horário no cadastro.",
      true
    );
    return;
  }

  savingMedication = true;

  const saveButton = $("saveMedicationButton");

  saveButton.disabled = true;
  saveButton.textContent = "Salvando...";

  try {
    let medicationId = editingMedicationId;
    let previousStock = 0;

    if (wasEditing) {
      const existing =
        medications.find(item => item.id === editingMedicationId);

      if (!existing) {
        throw new Error("Medicamento não encontrado.");
      }

      previousStock =
        Number(existing.stock_quantity || 0);

      const { error } = await supabaseClient
        .from("medications")
        .update({
          name,
          dose,
          stock_unit: stockUnit,
          stock_quantity: stockQuantity,
          start_date: startDate,
          prescribed_days: prescribedDays,
          instructions,
          updated_at: new Date().toISOString()
        })
        .eq("id", medicationId)
        .eq("user_id", currentUser.id);

      if (error) throw error;

    } else {
      const { data, error } = await supabaseClient
        .from("medications")
        .insert({
          user_id: currentUser.id,
          name,
          dose,
          stock_unit: stockUnit,
          stock_quantity: stockQuantity,
          start_date: startDate,
          prescribed_days: prescribedDays,
          instructions,
          status: "active"
        })
        .select()
        .single();

      if (error) throw error;

      medicationId = data.id;

      if (stockQuantity > 0) {
        const { error: movementError } =
          await supabaseClient
            .from("stock_movements")
            .insert({
              user_id: currentUser.id,
              medication_id: medicationId,
              movement_type: "in",
              quantity: stockQuantity,
              note: "Estoque inicial do cadastro"
            });

        if (movementError) throw movementError;
      }
    }

    // Registra ajustes manuais de estoque na edição.
    if (wasEditing && stockQuantity !== previousStock) {
      const difference = stockQuantity - previousStock;

      const { error: movementError } =
        await supabaseClient
          .from("stock_movements")
          .insert({
            user_id: currentUser.id,
            medication_id: medicationId,
            movement_type: difference > 0 ? "in" : "out",
            quantity: Math.abs(difference),
            note: "Ajuste manual de estoque"
          });

      if (movementError) throw movementError;
    }

    // Preserva os horários existentes para não apagar
    // o histórico de registros de doses.
    const {
      data: oldSchedules,
      error: oldError
    } = await supabaseClient
      .from("medication_schedules")
      .select("*")
      .eq("medication_id", medicationId)
      .eq("user_id", currentUser.id)
      .eq("enabled", true);

    if (oldError) throw oldError;

    const oldList = oldSchedules || [];
    const schedulesToKeep = [];

    for (const value of scheduleValues) {
      const existing = oldList.find(item =>
        !schedulesToKeep.includes(item.id) &&
        cleanTime(item.scheduled_time) === value.scheduled_time
      );

      if (existing) {
        const { error } = await supabaseClient
          .from("medication_schedules")
          .update({
            dose_quantity: value.dose_quantity,
            enabled: true
          })
          .eq("id", existing.id)
          .eq("user_id", currentUser.id);

        if (error) throw error;

        schedulesToKeep.push(existing.id);

      } else {
        const { data, error } = await supabaseClient
          .from("medication_schedules")
          .insert({
            user_id: currentUser.id,
            medication_id: medicationId,
            scheduled_time: value.scheduled_time,
            dose_quantity: value.dose_quantity,
            enabled: true
          })
          .select()
          .single();

        if (error) throw error;

        schedulesToKeep.push(data.id);
      }
    }

    const schedulesToDisable = oldList
      .filter(item => !schedulesToKeep.includes(item.id))
      .map(item => item.id);

    if (schedulesToDisable.length) {
      const { error } = await supabaseClient
        .from("medication_schedules")
        .update({ enabled: false })
        .in("id", schedulesToDisable)
        .eq("user_id", currentUser.id);

      if (error) throw error;
    }

    $("medicationPanel").classList.add("hidden");

    resetMedicationForm();

    await loadMedications();

    showMessage(
      wasEditing
        ? "Medicamento atualizado com sucesso."
        : "Medicamento cadastrado com sucesso."
    );

  } catch (error) {
    console.error(error);

    showMessage(
      error.message || "Não foi possível salvar o medicamento.",
      true
    );

  } finally {
    savingMedication = false;

    saveButton.disabled = false;

    saveButton.textContent = wasEditing
      ? "Salvar alterações"
      : "Salvar medicamento";
  }
}

/* ============================================================
   REPOSIÇÃO DE ESTOQUE
   ============================================================ */

function openRestockForm(medicationId) {
  const medication =
    medications.find(item => item.id === medicationId);

  if (!medication) {
    showMessage("Medicamento não encontrado.", true);
    return;
  }

  $("medicationPanel").classList.add("hidden");

  restockMedicationId = medicationId;

  $("restockMedicationName").textContent =
    `${medication.name} • Estoque atual: ${
      formatQuantity(medication.stock_quantity)
    } ${medication.stock_unit || "unidades"}`;

  $("restockForm").reset();

  $("restockPanel").classList.remove("hidden");

  $("restockPanel").scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  $("restockQuantity").focus();
}

function closeRestockForm(scroll = false) {
  if (!$("restockPanel")) return;

  $("restockPanel").classList.add("hidden");

  if ($("restockForm")) {
    $("restockForm").reset();
  }

  restockMedicationId = null;

  if (scroll) {
    $("medicationList").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
}

async function saveRestock(event) {
  event.preventDefault();

  if (
    !currentUser ||
    !restockMedicationId ||
    savingRestock
  ) {
    return;
  }

  const quantity = Number($("restockQuantity").value);

  const note =
    $("restockNote").value.trim() ||
    "Reposição de estoque";

  if (!Number.isFinite(quantity) || quantity <= 0) {
    showMessage(
      "Informe uma quantidade maior que zero.",
      true
    );
    return;
  }

  savingRestock = true;

  const button = $("saveRestockButton");

  button.disabled = true;
  button.textContent = "Salvando...";

  try {
    const medicationId = restockMedicationId;

    const { error } = await supabaseClient.rpc(
      "restock_medication",
      {
        p_medication_id: medicationId,
        p_quantity: quantity,
        p_note: note
      }
    );

    if (error) throw error;

    closeRestockForm(false);

    await loadMedications();

    showMessage("Estoque adicionado com sucesso!");

  } catch (error) {
    console.error(error);

    showMessage(
      error.message || "Não foi possível atualizar o estoque.",
      true
    );

  } finally {
    savingRestock = false;

    button.disabled = false;
    button.textContent = "Salvar estoque";
  }
}

/* ============================================================
   STATUS DO MEDICAMENTO
   ============================================================ */

async function updateMedicationStatus(id, status) {
  const messages = {
    active: "Deseja reativar este medicamento?",
    paused: "Deseja pausar este medicamento?",
    completed: "Deseja marcar este tratamento como concluído?"
  };

  if (!confirm(messages[status])) return;

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

    const labels = {
      active: "reativado",
      paused: "pausado",
      completed: "concluído"
    };

    showMessage(`Medicamento ${labels[status]}.`);

  } catch (error) {
    console.error(error);

    showMessage(
      error.message || "Não foi possível atualizar o medicamento.",
      true
    );
  }
}

/* ============================================================
   LISTA DE MEDICAMENTOS, ESTOQUE E CONTADOR
   ============================================================ */

function updateCounters() {
  $("medicationCount").textContent = medications.length;
}

function stockMessage(medication) {
  const stock = Number(medication.stock_quantity || 0);

  const dailySchedules =
    schedulesByMedication[medication.id] || [];

  const dailyUse = dailySchedules.reduce(
    (sum, schedule) =>
      sum + Number(schedule.dose_quantity || 0),
    0
  );

  if (stock <= 0) {
    return `<span class="stock-empty">Estoque esgotado</span>`;
  }

  if (dailyUse <= 0) {
    return `Estoque atual: ${formatQuantity(stock)} ${
      escapeHTML(medication.stock_unit || "unidades")
    }`;
  }

  const days = Math.floor(stock / dailyUse);

  if (days <= Number(medication.stock_alert_days || 3)) {
    return `
      <span class="stock-warning">
        Estoque para aproximadamente ${days} dia(s)
      </span>
    `;
  }

  return `Estoque para aproximadamente ${days} dias`;
}

function renderMedications() {
  const container = $("medicationList");

  if (!medications.length) {
    container.innerHTML = `
      <div class="empty-state">
        Você ainda não cadastrou medicamentos.
        <br>
        Use o botão “Adicionar novo medicamento” para começar.
      </div>
    `;
    return;
  }

  container.innerHTML = medications.map(medication => {
    const schedules =
      schedulesByMedication[medication.id] || [];

    const times = schedules
      .map(item => cleanTime(item.scheduled_time))
      .join(", ");

    const statusLabel =
      medication.status === "paused"
        ? "Pausado"
        : medication.status === "completed"
          ? "Concluído"
          : "Em uso";

    return `
      <article class="medication-item">
        <div class="medication-item-top">
          <div>
            <h3>${escapeHTML(medication.name)}</h3>
            <p class="medication-dose">
              ${escapeHTML(medication.dose)}
            </p>
          </div>
          <span class="small-text">${statusLabel}</span>
        </div>

        <div class="medication-meta">
          <div>
            Horários:
            ${escapeHTML(times || "Não definidos")}
          </div>

          <div>
            Estoque:
            <strong>
              ${escapeHTML(formatQuantity(medication.stock_quantity))}
              ${escapeHTML(medication.stock_unit || "unidades")}
            </strong>
          </div>

          <div>${stockMessage(medication)}</div>

          ${
            medication.instructions
              ? `<div>Orientações: ${
                  escapeHTML(medication.instructions)
                }</div>`
              : ""
          }
        </div>

        <div class="item-actions">
          ${
            medication.status !== "completed"
              ? `
                <button
                  class="edit-button"
                  data-action="edit"
                  data-id="${escapeHTML(medication.id)}"
                  type="button"
                >Editar</button>

                <button
                  class="restock-button"
                  data-action="restock"
                  data-id="${escapeHTML(medication.id)}"
                  type="button"
                >＋ Adicionar estoque</button>
              `
              : ""
          }

          ${
            medication.status === "active"
              ? `
                <button
                  class="pause-button"
                  data-action="pause"
                  data-id="${escapeHTML(medication.id)}"
                  type="button"
                >Pausar</button>
              `
              : ""
          }

          ${
            medication.status === "paused"
              ? `
                <button
                  class="edit-button"
                  data-action="activate"
                  data-id="${escapeHTML(medication.id)}"
                  type="button"
                >Reativar</button>
              `
              : ""
          }

          ${
            medication.status !== "completed"
              ? `
                <button
                  class="complete-button"
                  data-action="complete"
                  data-id="${escapeHTML(medication.id)}"
                  type="button"
                >Concluir</button>
              `
              : ""
          }
        </div>
      </article>
    `;
  }).join("");
}

/* ============================================================
   EVENTOS DA INTERFACE
   ============================================================ */

function configureEvents() {
  $("loginForm").addEventListener(
    "submit",
    handleLogin
  );

  $("registerForm").addEventListener(
    "submit",
    handleRegister
  );

  $("recoveryForm").addEventListener(
    "submit",
    handleRecovery
  );

  $("passwordResetForm").addEventListener(
    "submit",
    handlePasswordUpdate
  );

  $("showRegisterButton").addEventListener(
    "click",
    () => showAuthPanel("registerPanel")
  );

  $("showRecoveryButton").addEventListener(
    "click",
    () => {
      $("recoveryEmail").value =
        $("loginEmail").value.trim();

      showAuthPanel("recoveryPanel");
    }
  );

  $("backToLoginFromRegister").addEventListener(
    "click",
    () => showAuthPanel("loginPanel")
  );

  $("backToLoginFromRecovery").addEventListener(
    "click",
    () => showAuthPanel("loginPanel")
  );

  $("logoutButton").addEventListener(
    "click",
    logout
  );

  $("newMedicationButton").addEventListener(
    "click",
    openNewMedicationForm
  );

  $("cancelEditButton").addEventListener(
    "click",
    closeMedicationForm
  );

  $("addScheduleButton").addEventListener(
    "click",
    () => addScheduleRow()
  );

  $("medicationForm").addEventListener(
    "submit",
    saveMedication
  );

  $("cancelRestockButton").addEventListener(
    "click",
    () => closeRestockForm(true)
  );

  $("restockForm").addEventListener(
    "submit",
    saveRestock
  );

  $("todayMedicationList").addEventListener(
    "click",
    event => {
      const button = event.target.closest("[data-action]");

      if (!button) return;

      if (button.dataset.action === "today-taken") {
        markDoseTaken(
          button.dataset.id,
          button.dataset.time
        );
      } else if (
        button.dataset.action === "today-not-taken"
      ) {
        markDoseNotTaken(
          button.dataset.id,
          button.dataset.time
        );
      }
    }
  );

  $("medicationList").addEventListener(
    "click",
    event => {
      const button = event.target.closest("[data-action]");

      if (!button) return;

      const { action, id } = button.dataset;

      if (action === "edit") {
        editMedication(id);
      }

      if (action === "restock") {
        openRestockForm(id);
      }

      if (action === "pause") {
        updateMedicationStatus(id, "paused");
      }

      if (action === "activate") {
        updateMedicationStatus(id, "active");
      }

      if (action === "complete") {
        updateMedicationStatus(id, "completed");
      }
    }
  );
}

/* ============================================================
   INICIALIZAÇÃO E RECUPERAÇÃO DE SESSÃO
   ============================================================ */

async function initializeApp() {
  configureEvents();

  /*
    Primeiro registramos o observador de autenticação.
    Assim, não perdemos o evento PASSWORD_RECOVERY.
  */

  supabaseClient.auth.onAuthStateChange(
    (event, session) => {

      if (event === "PASSWORD_RECOVERY") {
        openPasswordResetScreen();
        return;
      }

      if (
        event === "SIGNED_IN" &&
        session?.user &&
        !passwordRecoveryInProgress
      ) {
        /*
          Não abrir a área dos medicamentos enquanto
          o formulário de recuperação estiver ativo.
        */

        if (!$("passwordResetPanel").classList.contains("hidden")) {
          return;
        }

        showApplication(session.user);
        return;
      }

      if (event === "SIGNED_OUT") {
        currentUser = null;
        medications = [];
        schedulesByMedication = {};
        applicationLoading = false;

        $("appSection").classList.add("hidden");
        $("authSection").classList.remove("hidden");
        $("logoutButton").classList.add("hidden");

        if (!passwordRecoveryInProgress) {
          showAuthPanel("loginPanel");
        }
      }
    }
  );

  /*
    Verifica se a URL atual é um link de recuperação.
    O evento PASSWORD_RECOVERY é a identificação principal;
    este teste também ajuda a manter a tela correta durante
    a abertura do link no navegador.
  */

  const urlParams = new URLSearchParams(
    window.location.search
  );

  const hashParams = new URLSearchParams(
    window.location.hash.replace(/^#/, "")
  );

  const recoveryInUrl =
    urlParams.get("type") === "recovery" ||
    hashParams.get("type") === "recovery";

  if (recoveryInUrl) {
    passwordRecoveryInProgress = true;
    showAuthPanel("passwordResetPanel");
  }

  const {
    data,
    error
  } = await supabaseClient.auth.getSession();

  if (error) {
    showMessage(
      error.message || "Não foi possível verificar sua sessão.",
      true
    );
    return;
  }

  /*
    Se houver recuperação em andamento, não abrir o painel
    principal, mesmo que o Supabase já tenha criado uma sessão.
  */

  if (passwordRecoveryInProgress) {
    showAuthPanel("passwordResetPanel");
    return;
  }

  if (
    data.session?.user &&
    $("passwordResetPanel").classList.contains("hidden")
  ) {
    await showApplication(data.session.user);
  }
}

document.addEventListener(
  "DOMContentLoaded",
  initializeApp
);
