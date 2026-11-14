
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
      autoRefreshToken: true,
      storage: window.localStorage
    }
  }
);

/* ============================================================
   VARIÁVEIS GLOBAIS
   ============================================================ */

let currentUser = null;
let medications = [];
let schedulesByMedication = {};
let editingMedicationId = null;
let restockMedicationId = null;
let toastTimeout = null;
let savingMedication = false;
let savingRestock = false;
let recoveryMode = false;
let applicationLoading = false;

let doseClockInterval = null;
let lastLoadedLocalDate = null;

const $ = id => document.getElementById(id);

function getFirstElement(...ids) {
  for (const id of ids) {
    const element = $(id);
    if (element) return element;
  }
  return null;
}

function getValue(...ids) {
  return getFirstElement(...ids)?.value ?? "";
}

/* ============================================================
   DATA E FORMATAÇÃO
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

function cleanTime(value) {
  return String(value || "").slice(0, 5);
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

function periodEmoji(time) {
  const hour = Number(String(time || "00:00").slice(0, 2));

  if (hour >= 6 && hour < 12) return "☀️";
  if (hour >= 12 && hour < 18) return "🌤️";
  return "🌙";
}

function statusEmoji(status) {
  if (status === "taken") return "💎";
  if (status === "not_taken") return "😟";
  if (status === "overdue") return "⚠️";
  return "⏳";
}

/* ============================================================
   STATUS INTELIGENTE DAS DOSES
   ============================================================ */

function getDoseDisplayStatus(schedule) {
  const status = schedule.doseStatus || "pending";

  // Registros confirmados pelo paciente.
  if (status === "taken" || status === "not_taken") {
    return status;
  }

  const time = cleanTime(schedule.scheduled_time);

  const scheduledTimestamp = Date.parse(
    localScheduleTimestamp(todayLocalDate(), time)
  );

  // Horário ultrapassado sem confirmação.
  // Não grava nada automaticamente no banco.
  if (Date.now() >= scheduledTimestamp) {
    return "overdue";
  }

  return "pending";
}

/* ============================================================
   MENSAGENS
   ============================================================ */

function showMessage(message, isError = false) {
  const toast = $("toast");

  if (!toast) {
    console.log(message);
    return;
  }

  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");

  clearTimeout(toastTimeout);

  toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
}

/* ============================================================
   AUTENTICAÇÃO
   ============================================================ */

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
}

function showLoginScreen() {
  recoveryMode = false;

  $("appSection")?.classList.add("hidden");
  $("authSection")?.classList.remove("hidden");
  $("logoutButton")?.classList.add("hidden");

  showAuthPanel("loginPanel");
}

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
        data: { full_name: name },
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

  if (recoveryMode) {
    showMessage("Conclua primeiro a alteração da sua senha.", true);
    return;
  }

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  const button = $("loginForm").querySelector('button[type="submit"]');

  button.disabled = true;
  button.textContent = "Entrando...";

  try {
    const { data, error } =
      await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

    if (error) throw error;

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

  try {
    const { error } =
      await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo:
          window.location.origin + window.location.pathname
      });

    if (error) throw error;

    showMessage(
      "Se o e-mail estiver cadastrado, você receberá as instruções."
    );

    showAuthPanel("loginPanel");

  } catch (error) {
    console.error("Erro ao solicitar recuperação:", error);

    showMessage(
      error.message || "Não foi possível enviar o link.",
      true
    );
  }
}

/* ============================================================
   RECUPERAÇÃO E ALTERAÇÃO DE SENHA
   ============================================================ */

function openPasswordResetScreen() {
  recoveryMode = true;
  currentUser = null;

  $("appSection")?.classList.add("hidden");
  $("authSection")?.classList.remove("hidden");
  $("logoutButton")?.classList.add("hidden");

  showAuthPanel("passwordResetPanel");

  if ($("newPassword")) $("newPassword").value = "";
  if ($("confirmNewPassword")) {
    $("confirmNewPassword").value = "";
  }

  setTimeout(() => $("newPassword")?.focus(), 100);
}

async function handlePasswordUpdate(event) {
  event.preventDefault();

  const password = $("newPassword").value;
  const confirmation = $("confirmNewPassword").value;

  if (password.length < 6) {
    showMessage("A senha deve ter pelo menos 6 caracteres.", true);
    return;
  }

  if (password !== confirmation) {
    showMessage("As senhas informadas são diferentes.", true);
    return;
  }

  const button =
    $("passwordResetForm").querySelector('button[type="submit"]');

  button.disabled = true;
  button.textContent = "Salvando...";

  try {
    const { error } =
      await supabaseClient.auth.updateUser({ password });

    if (error) throw error;

    recoveryMode = false;

    const { error: signOutError } =
      await supabaseClient.auth.signOut();

    if (signOutError) {
      console.warn(
        "Falha ao encerrar sessão após alterar senha:",
        signOutError
      );
    }

    $("newPassword").value = "";
    $("confirmNewPassword").value = "";

    showLoginScreen();
    showMessage("Nova senha cadastrada! Entre com sua nova senha.");

  } catch (error) {
    console.error("Erro ao atualizar senha:", error);

    showMessage(
      error.message ||
        "Não foi possível atualizar sua senha. Solicite um novo link.",
      true
    );

  } finally {
    button.disabled = false;
    button.textContent = "Salvar nova senha";
  }
}

async function logout() {
  try {
    const { error } = await supabaseClient.auth.signOut();

    if (error) throw error;

    currentUser = null;
    medications = [];
    schedulesByMedication = {};
    restockMedicationId = null;
    lastLoadedLocalDate = null;

    showLoginScreen();
    showMessage("Você saiu da sua conta.");

  } catch (error) {
    console.error("Erro ao sair:", error);

    showMessage(
      error.message || "Não foi possível sair da conta.",
      true
    );
  }
}

/* ============================================================
   ABRIR A ÁREA PESSOAL
   ============================================================ */

async function showApplication(user) {
  if (!user || recoveryMode || applicationLoading) return;

  applicationLoading = true;

  try {
    currentUser = user;

    $("authSection")?.classList.add("hidden");
    $("appSection")?.classList.remove("hidden");
    $("logoutButton")?.classList.remove("hidden");

    const metadata = user.user_metadata || {};

    const displayName =
      metadata.full_name ||
      user.email?.split("@")[0] ||
      "bem-vindo(a)";

    if ($("userName")) {
      $("userName").textContent = displayName;
    }

    if ($("medicationStartDate")) {
      $("medicationStartDate").value = todayLocalDate();
    }

    await loadMedications();

  } finally {
    applicationLoading = false;
  }
}

/* ============================================================
   CADASTRO E EDIÇÃO DE HORÁRIOS
   ============================================================ */

function addScheduleRow(time = "", quantity = "1") {
  const container = $("scheduleList");
  if (!container) return;

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

  row.querySelector(".remove-schedule").addEventListener("click", () => {
    const rows = container.querySelectorAll(".schedule-row");

    if (rows.length <= 1) {
      showMessage("Mantenha pelo menos um horário.", true);
      return;
    }

    row.remove();
  });

  container.appendChild(row);
}

function resetMedicationForm() {
  editingMedicationId = null;

  $("medicationForm")?.reset();

  if ($("medicationId")) $("medicationId").value = "";

  if ($("formTitle")) {
    $("formTitle").textContent = "Novo medicamento";
  }

  if ($("saveMedicationButton")) {
    $("saveMedicationButton").textContent = "Salvar medicamento";
  }

  if ($("medicationStartDate")) {
    $("medicationStartDate").value = todayLocalDate();
  }

  if ($("medicationStock")) {
    $("medicationStock").value = "0";
  }

  if ($("medicationUnit")) {
    $("medicationUnit").value = "comprimidos";
  }

  if ($("medicationStockAlert")) {
    $("medicationStockAlert").value = "3";
  }

  const daysField = getFirstElement(
    "medicationDays",
    "medicationPrescribedDays"
  );

  if (daysField) daysField.value = "";

  if ($("scheduleList")) {
    $("scheduleList").innerHTML = "";
  }

  addScheduleRow();
}

function openNewMedicationForm() {
  closeRestockForm(false);
  resetMedicationForm();

  $("medicationPanel")?.classList.remove("hidden");

  $("medicationPanel")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function closeMedicationForm() {
  $("medicationPanel")?.classList.add("hidden");
  resetMedicationForm();
}

function editMedication(id) {
  const medication = medications.find(item => item.id === id);

  if (!medication) return;

  if (medication.status === "completed") {
    showMessage(
      "Tratamentos concluídos não podem ser editados.",
      true
    );
    return;
  }

  closeRestockForm(false);

  editingMedicationId = id;

  $("medicationId").value = medication.id;
  $("medicationName").value = medication.name || "";
  $("medicationDose").value = medication.dose || "";
  $("medicationInstructions").value =
    medication.instructions || "";

  $("medicationStartDate").value =
    medication.start_date || todayLocalDate();

  const daysField = getFirstElement(
    "medicationDays",
    "medicationPrescribedDays"
  );

  if (daysField) {
    daysField.value = medication.prescribed_days || "";
  }

  $("medicationStock").value =
    medication.stock_quantity ?? 0;

  $("medicationUnit").value =
    medication.stock_unit || "comprimidos";

  if ($("medicationStockAlert")) {
    $("medicationStockAlert").value =
      medication.stock_alert_days ?? 3;
  }

  $("formTitle").textContent = "Editar medicamento";
  $("saveMedicationButton").textContent = "Salvar alterações";

  $("scheduleList").innerHTML = "";

  const schedules = schedulesByMedication[id] || [];

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

  $("medicationPanel").classList.remove("hidden");

  $("medicationPanel").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

/* ============================================================
   SALVAR MEDICAMENTO
   ============================================================ */

async function saveMedication(event) {
  event.preventDefault();

  if (!currentUser || savingMedication) return;

  const wasEditing = Boolean(editingMedicationId);
  const medicationIdBeingEdited = editingMedicationId;

  const name = $("medicationName").value.trim();
  const dose = $("medicationDose").value.trim();
  const instructions =
    $("medicationInstructions").value.trim();

  const startDate =
    $("medicationStartDate").value || todayLocalDate();

  const daysValue = getValue(
    "medicationDays",
    "medicationPrescribedDays"
  );

  const prescribedDays = daysValue ? Number(daysValue) : 0;

  const stockQuantity =
    Number($("medicationStock").value || 0);

  const stockUnit =
    $("medicationUnit").value || "comprimidos";

  const stockAlertDays =
    Number(getValue("medicationStockAlert") || 3);

  if (!name || !dose) {
    showMessage(
      "Informe o nome e a dose do medicamento.",
      true
    );
    return;
  }

  if (!Number.isFinite(stockQuantity) || stockQuantity < 0) {
    showMessage("O estoque não pode ser negativo.", true);
    return;
  }

  if (
    !Number.isInteger(prescribedDays) ||
    prescribedDays < 0
  ) {
    showMessage(
      "Informe uma duração válida em dias.",
      true
    );
    return;
  }

  const scheduleRows = [
    ...$("scheduleList").querySelectorAll(".schedule-row")
  ];

  const schedules = scheduleRows.map(row => ({
    scheduled_time: row.querySelector(".schedule-time").value,
    dose_quantity: Number(
      row.querySelector(".schedule-quantity").value || 1
    )
  }));

  if (
    !schedules.length ||
    schedules.some(item =>
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

  const uniqueTimes = schedules.map(
    item => item.scheduled_time
  );

  if (new Set(uniqueTimes).size !== uniqueTimes.length) {
    showMessage(
      "Não repita o mesmo horário no cadastro.",
      true
    );
    return;
  }

  savingMedication = true;

  const button = $("saveMedicationButton");
  button.disabled = true;
  button.textContent = "Salvando...";

  try {
    let medicationId = medicationIdBeingEdited;
    let previousStock = 0;

    if (wasEditing) {
      const existing = medications.find(
        item => item.id === medicationIdBeingEdited
      );

      if (!existing) {
        throw new Error("Medicamento não encontrado.");
      }

      previousStock = Number(existing.stock_quantity || 0);

      const { error } = await supabaseClient
        .from("medications")
        .update({
          name,
          dose,
          instructions,
          start_date: startDate,
          prescribed_days: prescribedDays,
          stock_quantity: stockQuantity,
          stock_unit: stockUnit,
          stock_alert_days: stockAlertDays,
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
          instructions,
          start_date: startDate,
          prescribed_days: prescribedDays,
          stock_quantity: stockQuantity,
          stock_unit: stockUnit,
          stock_alert_days: stockAlertDays,
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select("id")
        .single();

      if (error) throw error;

      medicationId = data.id;
    }

    /* Ajuste manual de estoque na edição. */
    if (wasEditing && stockQuantity !== previousStock) {
      const difference = stockQuantity - previousStock;

      const { error: movementError } = await supabaseClient
        .from("stock_movements")
        .insert({
          user_id: currentUser.id,
          medication_id: medicationId,
          movement_type: difference > 0 ? "in" : "out",
          quantity: Math.abs(difference),
          note: "Ajuste manual de estoque"
        });

      if (movementError) {
        console.warn(
          "Não foi possível registrar o movimento:",
          movementError
        );
      }
    }

    /* Recupera horários existentes. */
    const { data: oldSchedules, error: oldError } =
      await supabaseClient
        .from("medication_schedules")
        .select("*")
        .eq("medication_id", medicationId)
        .eq("user_id", currentUser.id)
        .eq("enabled", true);

    if (oldError) throw oldError;

    const oldList = oldSchedules || [];
    const schedulesToKeep = [];

    /* Atualiza horários ou cria novos. */
    for (const value of schedules) {
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
          .select("id")
          .single();

        if (error) throw error;

        schedulesToKeep.push(data.id);
      }
    }

    /* Desativa horários removidos, preservando o histórico. */
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
        ? "Medicamento atualizado com sucesso!"
        : "Medicamento cadastrado com sucesso!"
    );

  } catch (error) {
    console.error("Erro ao salvar medicamento:", error);

    showMessage(
      error.message || "Não foi possível salvar o medicamento.",
      true
    );

  } finally {
    savingMedication = false;
    button.disabled = false;
    button.textContent = "Salvar medicamento";
  }
}

/* ============================================================
   REPOSIÇÃO DE ESTOQUE
   ============================================================ */

function openRestockForm(medicationId) {
  const medication = medications.find(
    item => item.id === medicationId
  );

  if (!medication) {
    showMessage("Medicamento não encontrado.", true);
    return;
  }

  $("medicationPanel")?.classList.add("hidden");

  restockMedicationId = medicationId;

  $("restockMedicationName").textContent =
    `${medication.name} • Estoque atual: ` +
    `${formatQuantity(medication.stock_quantity)} ` +
    `${medication.stock_unit || "unidades"}`;

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
  $("restockForm")?.reset();

  restockMedicationId = null;

  if (scroll && $("medicationList")) {
    $("medicationList").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
}

async function saveRestock(event) {
  event.preventDefault();

  if (!currentUser || !restockMedicationId || savingRestock) {
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
    console.error("Erro na reposição:", error);

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
   CARREGAR MEDICAMENTOS E REGISTROS DO DIA
   ============================================================ */

async function loadMedications() {
  if (!currentUser) return;

  try {
    const { data: medicationData, error: medicationError } =
      await supabaseClient
        .from("medications")
        .select("*")
        .eq("user_id", currentUser.id)
        .order("name", { ascending: true });

    if (medicationError) throw medicationError;

    medications = medicationData || [];
    schedulesByMedication = {};

    if (medications.length) {
      const medicationIds = medications.map(
        item => item.id
      );

      const { data: scheduleData, error: scheduleError } =
        await supabaseClient
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

        schedulesByMedication[schedule.medication_id].push(
          schedule
        );
      });
    }

    const allSchedules =
      Object.values(schedulesByMedication).flat();

    allSchedules.forEach(schedule => {
      schedule.doseStatus = "pending";
    });

    if (allSchedules.length) {
      const bounds = localDayBounds();

      const { data: logs, error: logsError } =
        await supabaseClient
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

    if ($("todayDate")) {
      $("todayDate").textContent =
        formatDate(todayLocalDate());
    }

    lastLoadedLocalDate = todayLocalDate();

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
   VERIFICAR SE O MEDICAMENTO ESTÁ ATIVO HOJE
   ============================================================ */

function isMedicationScheduledToday(medication) {
  if (medication.status !== "active") return false;

  const today = todayLocalDate();

  if (medication.start_date && medication.start_date > today) {
    return false;
  }

  const days = Number(medication.prescribed_days || 0);

  if (medication.start_date && days > 0) {
    const [year, month, day] =
      medication.start_date.split("-").map(Number);

    const end = new Date(Date.UTC(year, month - 1, day));

    end.setUTCDate(end.getUTCDate() + days - 1);

    const endDate = [
      end.getUTCFullYear(),
      String(end.getUTCMonth() + 1).padStart(2, "0"),
      String(end.getUTCDate()).padStart(2, "0")
    ].join("-");

    if (today > endDate) return false;
  }

  return true;
}

/* ============================================================
   PAINEL INTELIGENTE DE MEDICAMENTOS DE HOJE
   ============================================================ */

function renderTodayMedications() {
  const container = $("todayMedicationList");
  if (!container) return;

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
        <p>
          Cadastre um medicamento para visualizar seus horários aqui.
        </p>
      </div>
    `;
    return;
  }

  /* Resumo diário. */
  const allDoses = items.flatMap(item =>
    item.schedules.map(schedule => ({
      schedule,
      status: getDoseDisplayStatus(schedule)
    }))
  );

  const totalTaken = allDoses.filter(
    item => item.status === "taken"
  ).length;

  const totalNotTaken = allDoses.filter(
    item => item.status === "not_taken"
  ).length;

  const totalOverdue = allDoses.filter(
    item => item.status === "overdue"
  ).length;

  const totalWaiting = allDoses.filter(
    item => item.status === "pending"
  ).length;

  const summary = `
    <div class="dose-daily-summary">

      <div class="dose-summary-title">
        <span>📊</span>
        <strong>Resumo do dia</strong>
      </div>

      <div class="dose-summary-grid">

        <div class="dose-summary-item summary-taken">
          <strong>${totalTaken}</strong>
          <span>Tomados</span>
        </div>

        <div class="dose-summary-item summary-not-taken">
          <strong>${totalNotTaken}</strong>
          <span>Não tomados</span>
        </div>

        <div class="dose-summary-item summary-overdue">
          <strong>${totalOverdue}</strong>
          <span>Atrasados</span>
        </div>

        <div class="dose-summary-item summary-waiting">
          <strong>${totalWaiting}</strong>
          <span>Aguardando</span>
        </div>

      </div>
    </div>
  `;

  const medicationCards = items.map(
    ({ medication, schedules }) => {

      const stockUnit =
        medication.stock_unit || "unidades";

      const currentStock =
        formatQuantity(medication.stock_quantity);

      const doseCards = schedules.map(schedule => {
        const status = getDoseDisplayStatus(schedule);
        const time = cleanTime(schedule.scheduled_time);
        const period = periodEmoji(time);
        const emoji = statusEmoji(status);

        let statusText = "Aguardando registro";

        if (status === "taken") {
          statusText = "Tomado";
        } else if (status === "not_taken") {
          statusText = "Não tomado";
        } else if (status === "overdue") {
          statusText = "Dose não registrada";
        }

        const overdueAlert = status === "overdue" ? `
          <div class="dose-overdue-alert">

            <div class="dose-overdue-icon">⚠️</div>

            <div class="dose-overdue-content">
              <strong>Atenção: horário ultrapassado!</strong>

              <span>
                Ainda não há confirmação de que este medicamento foi tomado.
              </span>

              <small>
                Confirme abaixo o que aconteceu com esta dose.
              </small>
            </div>

          </div>
        ` : "";

        const notTakenAlert = status === "not_taken" ? `
          <div class="dose-not-taken-alert">
            <strong>😟 Dose registrada como não tomada.</strong>
            <span>
              Este registro foi confirmado pelo paciente.
            </span>
          </div>
        ` : "";

        const stockInfo = status === "taken" ? `
          <div class="dose-stock-info">
            <span>📦</span>
            <span>
              Estoque restante:
              <strong>
                ${escapeHTML(currentStock)}
                ${escapeHTML(stockUnit)}
              </strong>
            </span>
          </div>
        ` : "";

        return `
          <div class="today-dose status-${status}">

            <div class="today-dose-heading">

              <span class="today-dose-time">
                ${period} Às ${escapeHTML(time)}
              </span>

              <span class="today-dose-state">
                ${emoji} ${statusText}
              </span>

            </div>

            ${overdueAlert}
            ${notTakenAlert}

            <p>
              Quantidade desta dose:
              ${escapeHTML(
                formatQuantity(schedule.dose_quantity)
              )}
              ${escapeHTML(stockUnit)}
            </p>

            <div class="today-dose-actions">

              <button
                type="button"
                class="button-taken ${
                  status === "taken" ? "selected" : ""
                }"
                data-action="today-taken"
                data-id="${escapeHTML(schedule.id)}"
                data-time="${escapeHTML(time)}"
                ${status === "taken" ? "disabled" : ""}
              >
                💎 Tomado
              </button>

              <button
                type="button"
                class="button-not-taken ${
                  status === "not_taken" ? "selected" : ""
                }"
                data-action="today-not-taken"
                data-id="${escapeHTML(schedule.id)}"
                data-time="${escapeHTML(time)}"
                ${
                  status === "not_taken" || status === "taken"
                    ? "disabled"
                    : ""
                }
              >
                😟 Não tomado
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

          <div class="medication-stock-display">
            📦 Disponível:
            <strong>
              ${escapeHTML(currentStock)}
              ${escapeHTML(stockUnit)}
            </strong>
          </div>

          ${doseCards}

        </article>
      `;
    }
  ).join("");

  container.innerHTML = summary + medicationCards;
}

/* ============================================================
   REGISTRAR DOSE TOMADA
   ============================================================ */

async function markDoseTaken(scheduleId, time) {
  if (!currentUser) return;

  const scheduledFor = localScheduleTimestamp(
    todayLocalDate(),
    time
  );

  try {
    const { data, error } = await supabaseClient.rpc(
      "mark_dose_taken",
      {
        p_schedule_id: scheduleId,
        p_scheduled_for: scheduledFor
      }
    );

    if (error) throw error;

    await loadMedications();

    showMessage(
      data?.already_taken
        ? "Esta dose já estava registrada como tomada."
        : "Dose registrada como tomada. Estoque atualizado."
    );

  } catch (error) {
    console.error("Erro ao registrar dose tomada:", error);

    showMessage(
      error.message || "Não foi possível registrar a dose.",
      true
    );
  }
}

/* ============================================================
   REGISTRAR DOSE NÃO TOMADA
   ============================================================ */

async function markDoseNotTaken(scheduleId, time) {
  if (!currentUser) return;

  if (!confirm("Confirma que esta dose não foi tomada?")) {
    return;
  }

  const scheduledFor = localScheduleTimestamp(
    todayLocalDate(),
    time
  );

  try {
    const { error } = await supabaseClient.rpc(
      "mark_dose_not_taken",
      {
        p_schedule_id: scheduleId,
        p_scheduled_for: scheduledFor
      }
    );

    if (error) throw error;

    await loadMedications();

    showMessage(
      "Registro atualizado: dose não tomada."
    );

  } catch (error) {
    console.error(
      "Erro ao registrar dose não tomada:",
      error
    );

    showMessage(
      error.message || "Não foi possível registrar a dose.",
      true
    );
  }
}

/* ============================================================
   STATUS DO MEDICAMENTO
   ============================================================ */

async function updateMedicationStatus(id, status) {
  if (!currentUser) return;

  const messages = {
    active: "Deseja reativar este medicamento?",
    paused: "Deseja pausar este medicamento?",
    completed:
      "Deseja marcar este tratamento como concluído?"
  };

  if (!messages[status]) return;
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
    console.error("Erro ao alterar status:", error);

    showMessage(
      error.message || "Não foi possível atualizar o medicamento.",
      true
    );
  }
}

/* ============================================================
   CONTADORES E CÁLCULO DE ESTOQUE
   ============================================================ */

function updateCounters() {
  if ($("medicationCount")) {
    $("medicationCount").textContent = medications.length;
  }
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

/* ============================================================
   LISTA GERAL DE MEDICAMENTOS
   ============================================================ */

function renderMedications() {
  const container = $("medicationList");
  if (!container) return;

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

    const stockUnit =
      medication.stock_unit || "unidades";

    return `
      <article class="medication-item">

        <div class="medication-item-top">

          <div>
            <h3>${escapeHTML(medication.name)}</h3>

            <p class="medication-dose">
              ${escapeHTML(medication.dose)}
            </p>

            <p class="medication-stock-display">
              📦 Disponível:
              <strong>
                ${escapeHTML(
                  formatQuantity(medication.stock_quantity)
                )}
                ${escapeHTML(stockUnit)}
              </strong>
            </p>
          </div>

          <span class="small-text">
            ${escapeHTML(statusLabel)}
          </span>

        </div>

        <div class="medication-meta">

          <div>
            Horários:
            ${escapeHTML(times || "Não definidos")}
          </div>

          <div>
            Estoque:
            <strong>
              ${escapeHTML(
                formatQuantity(medication.stock_quantity)
              )}
              ${escapeHTML(stockUnit)}
            </strong>
          </div>

          <div>${stockMessage(medication)}</div>

          ${
            medication.instructions
              ? `
                <div>
                  Orientações:
                  ${escapeHTML(medication.instructions)}
                </div>
              `
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
                >
                  Editar
                </button>

                <button
                  class="restock-button"
                  data-action="restock"
                  data-id="${escapeHTML(medication.id)}"
                  type="button"
                >
                  ＋ Adicionar estoque
                </button>
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
                >
                  Pausar
                </button>
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
                >
                  Reativar
                </button>
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
                >
                  Concluir
                </button>
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
  $("loginForm")?.addEventListener(
    "submit",
    handleLogin
  );

  $("registerForm")?.addEventListener(
    "submit",
    handleRegister
  );

  $("recoveryForm")?.addEventListener(
    "submit",
    handleRecovery
  );

  $("passwordResetForm")?.addEventListener(
    "submit",
    handlePasswordUpdate
  );

  $("showRegisterButton")?.addEventListener("click", () => {
    showAuthPanel("registerPanel");
  });

  $("showRecoveryButton")?.addEventListener("click", () => {
    showAuthPanel("recoveryPanel");
  });

  $("backToLoginFromRegister")?.addEventListener(
    "click",
    () => showAuthPanel("loginPanel")
  );

  $("backToLoginFromRecovery")?.addEventListener(
    "click",
    () => showAuthPanel("loginPanel")
  );

  $("logoutButton")?.addEventListener("click", logout);

  $("newMedicationButton")?.addEventListener(
    "click",
    openNewMedicationForm
  );

  $("cancelEditButton")?.addEventListener(
    "click",
    closeMedicationForm
  );

  $("addScheduleButton")?.addEventListener(
    "click",
    () => addScheduleRow()
  );

  $("medicationForm")?.addEventListener(
    "submit",
    saveMedication
  );

  $("cancelRestockButton")?.addEventListener(
    "click",
    () => closeRestockForm(true)
  );

  $("restockForm")?.addEventListener(
    "submit",
    saveRestock
  );

  $("todayMedicationList")?.addEventListener(
    "click",
    event => {
      const button = event.target.closest("[data-action]");
      if (!button) return;

      if (button.dataset.action === "today-taken") {
        markDoseTaken(
          button.dataset.id,
          button.dataset.time
        );
      }

      if (button.dataset.action === "today-not-taken") {
        markDoseNotTaken(
          button.dataset.id,
          button.dataset.time
        );
      }
    }
  );

  $("medicationList")?.addEventListener(
    "click",
    event => {
      const button = event.target.closest("[data-action]");
      if (!button) return;

      const { action, id } = button.dataset;

      if (action === "edit") editMedication(id);
      if (action === "restock") openRestockForm(id);
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
   RELÓGIO INTELIGENTE DAS DOSES
   ============================================================ */

function startDoseClock() {
  if (doseClockInterval) {
    clearInterval(doseClockInterval);
  }

  doseClockInterval = setInterval(() => {
    if (!currentUser) return;

    const today = todayLocalDate();

    // Atualiza os registros quando virar o dia.
    if (lastLoadedLocalDate !== today) {
      loadMedications();
      return;
    }

    // Atualiza os alertas de atraso a cada 30 segundos.
    renderTodayMedications();

  }, 30000);
}

/* ============================================================
   RECUPERAÇÃO DE SESSÃO
   ============================================================ */

function isRecoveryUrl() {
  const query = new URLSearchParams(
    window.location.search
  );

  const hashText = window.location.hash.startsWith("#")
    ? window.location.hash.substring(1)
    : window.location.hash;

  const hash = new URLSearchParams(hashText);

  return (
    query.get("type") === "recovery" ||
    hash.get("type") === "recovery"
  );
}

function showSignedOutScreen() {
  currentUser = null;
  medications = [];
  schedulesByMedication = {};
  applicationLoading = false;
  lastLoadedLocalDate = null;

  $("appSection")?.classList.add("hidden");
  $("authSection")?.classList.remove("hidden");
  $("logoutButton")?.classList.add("hidden");

  if (!recoveryMode) {
    showAuthPanel("loginPanel");
  }
}

async function restoreSavedSession() {
  try {
    const { data, error } =
      await supabaseClient.auth.getSession();

    if (error) throw error;

    if (recoveryMode) {
      openPasswordResetScreen();
      return;
    }

    if (data.session?.user) {
      await showApplication(data.session.user);
    } else {
      showLoginScreen();
    }

  } catch (error) {
    console.error(
      "Erro ao recuperar sessão:",
      error
    );

    showLoginScreen();

    showMessage(
      error.message ||
        "Não foi possível verificar sua sessão. Entre novamente.",
      true
    );
  }
}

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */

async function initializeApp() {
  configureEvents();

  // Inicia a verificação automática dos horários.
  startDoseClock();

  if (isRecoveryUrl()) {
    recoveryMode = true;
    openPasswordResetScreen();
  }

  /*
    O listener é registrado antes da consulta de sessão.
    Isso evita perder eventos de autenticação.
  */
  supabaseClient.auth.onAuthStateChange(
    (event, session) => {

      if (event === "PASSWORD_RECOVERY") {
        recoveryMode = true;

        setTimeout(
          openPasswordResetScreen,
          0
        );

        return;
      }

      if (event === "SIGNED_OUT") {
        setTimeout(
          showSignedOutScreen,
          0
        );

        return;
      }

      if (
        event === "SIGNED_IN" &&
        session?.user &&
        !recoveryMode
      ) {
        setTimeout(() => {
          if (
            !recoveryMode &&
            currentUser?.id !== session.user.id
          ) {
            showApplication(session.user);
          }
        }, 0);
      }
    }
  );

  await restoreSavedSession();
}

document.addEventListener(
  "DOMContentLoaded",
  initializeApp
);
