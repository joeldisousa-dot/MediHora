/* =========================================================
   MEDIHORA
   Interface: GitHub Pages
   Banco de dados: Supabase
   ========================================================= */

const SUPABASE_URL = "https://dtwfettaesywyczfyvpr.supabase.co";
const SUPABASE_KEY = "sb_publishable_WsqtiIuq2h_4e1gtVGg8PQ_L4LW7px0";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

let currentUser = null;
let medications = [];
let schedules = [];
let todayLogs = [];
let toastTimeout = null;

/* ELEMENTOS */

const $ = (id) => document.getElementById(id);

const authSection = $("authSection");
const appSection = $("appSection");
const logoutButton = $("logoutButton");

const loginPanel = $("loginPanel");
const registerPanel = $("registerPanel");
const recoveryPanel = $("recoveryPanel");

const medicationPanel = $("medicationPanel");
const restockPanel = $("restockPanel");

/* DATA E HORA */

function todayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateTimeForSchedule(date, time) {
  return `${date}T${time}:00-03:00`;
}

function formatDate(dateString) {
  if (!dateString) return "";
  const parts = dateString.split("-");
  if (parts.length !== 3) return dateString;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatTime(time) {
  if (!time) return "";
  return String(time).slice(0, 5);
}

/* IDENTIFICAÇÃO DO PERÍODO DO DIA */

function getTimePeriod(time) {
  const hour = Number(formatTime(time).split(":")[0]);

  if (hour >= 6 && hour < 12) {
    return "☀️ Dia";
  }

  if (hour >= 12 && hour < 18) {
    return "🌤️ Tarde";
  }

  return "🌙 Noite";
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

/* MENSAGENS */

function showToast(message, isError = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("hidden", "error");

  if (isError) toast.classList.add("error");

  clearTimeout(toastTimeout);

  toastTimeout = setTimeout(() => {
    toast.classList.add("hidden");
  }, 4000);
}

function showError(
  error,
  fallback = "Não foi possível concluir a operação."
) {
  console.error(error);
  showToast(error?.message || fallback, true);
}

/* AUTENTICAÇÃO */

function showAuthPanel(panel) {
  loginPanel.classList.add("hidden");
  registerPanel.classList.add("hidden");
  recoveryPanel.classList.add("hidden");
  panel.classList.remove("hidden");
}

$("showRegister").addEventListener("click", () => {
  showAuthPanel(registerPanel);
});

$("showRecovery").addEventListener("click", () => {
  showAuthPanel(recoveryPanel);
});

$("backToLogin1").addEventListener("click", () => {
  showAuthPanel(loginPanel);
});

$("backToLogin2").addEventListener("click", () => {
  showAuthPanel(loginPanel);
});

/* ENTRAR */

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  const button = event.submitter;
  button.disabled = true;
  button.textContent = "Entrando...";

  try {
    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    showToast("Login realizado com sucesso!");

  } catch (error) {
    showError(
      error,
      "Não foi possível entrar. Confira seu e-mail e senha."
    );

  } finally {
    button.disabled = false;
    button.textContent = "Entrar";
  }
});

/* CRIAR CONTA */

$("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = $("registerName").value.trim();
  const email = $("registerEmail").value.trim();
  const password = $("registerPassword").value;

  const button = event.submitter;
  button.disabled = true;
  button.textContent = "Criando conta...";

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

    if (data.session) {
      showToast("Conta criada com sucesso!");
    } else {
      showToast(
        "Conta criada! Confira seu e-mail para confirmar o cadastro."
      );

      showAuthPanel(loginPanel);
    }

  } catch (error) {
    showError(error, "Não foi possível criar sua conta.");

  } finally {
    button.disabled = false;
    button.textContent = "Criar conta";
  }
});

/* RECUPERAR SENHA */

$("recoveryForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("recoveryEmail").value.trim();

  try {
    const { error } =
      await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo:
          window.location.origin + window.location.pathname
      });

    if (error) throw error;

    showToast(
      "Se o e-mail estiver cadastrado, você receberá o link de recuperação."
    );

    showAuthPanel(loginPanel);

  } catch (error) {
    showError(error, "Não foi possível enviar o link.");
  }
});

/* SAIR */

logoutButton.addEventListener("click", async () => {
  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    showError(error);
    return;
  }

  showToast("Você saiu da sua conta.");
});

/* SESSÃO DO USUÁRIO */

async function handleAuthSession(session) {
  currentUser = session?.user || null;

  if (!currentUser) {
    authSection.classList.remove("hidden");
    appSection.classList.add("hidden");
    logoutButton.classList.add("hidden");
    return;
  }

  authSection.classList.add("hidden");
  appSection.classList.remove("hidden");
  logoutButton.classList.remove("hidden");

  const metadataName = currentUser.user_metadata?.full_name;
  const emailName = currentUser.email?.split("@")[0];

  $("userName").textContent =
    metadataName || emailName || "";

  await loadDashboard();
}

/* CARREGAMENTO DO PAINEL */

async function loadDashboard() {
  $("todayDate").textContent = formatDate(todayString());

  try {
    await loadMedications();
    await loadSchedules();
    await loadTodayLogs();

    renderTodayMedications();
    renderMedicationList();

  } catch (error) {
    showError(
      error,
      "Não foi possível carregar seus medicamentos."
    );
  }
}

/* CARREGAR MEDICAMENTOS */

async function loadMedications() {
  const { data, error } = await supabaseClient
    .from("medications")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) throw error;

  medications = data || [];
}

/* CARREGAR HORÁRIOS */

async function loadSchedules() {
  const { data, error } = await supabaseClient
    .from("medication_schedules")
    .select("*")
    .eq("user_id", currentUser.id)
    .eq("enabled", true);

  if (error) throw error;

  schedules = data || [];
}

/* CARREGAR REGISTROS DE HOJE */

async function loadTodayLogs() {
  const start = dateTimeForSchedule(todayString(), "00:00");
  const end = dateTimeForSchedule(todayString(), "23:59");

  const { data, error } = await supabaseClient
    .from("dose_logs")
    .select("*")
    .eq("user_id", currentUser.id)
    .gte("scheduled_for", start)
    .lte("scheduled_for", end);

  if (error) throw error;

  todayLogs = data || [];
}

/* CONSULTA DE REGISTRO DA DOSE */

function findDoseLog(scheduleId, scheduledFor) {
  return todayLogs.find((log) =>
    log.schedule_id === scheduleId &&
    new Date(log.scheduled_for).getTime() ===
      new Date(scheduledFor).getTime()
  );
}

function getMedication(medicationId) {
  return medications.find(
    (item) => item.id === medicationId
  );
}

/* MEDICAMENTOS DO DIA */

function renderTodayMedications() {
  const container = $("todayMedicationList");
  const today = todayString();

  const items = schedules
    .filter((schedule) => {
      const medication = getMedication(
        schedule.medication_id
      );

      if (!medication || medication.status !== "active") {
        return false;
      }

      if (
        medication.start_date &&
        medication.start_date > today
      ) {
        return false;
      }

      const prescribedDays = Number(
        medication.prescribed_days ??
        medication.duration_days ??
        0
      );

      if (
        prescribedDays > 0 &&
        medication.start_date
      ) {
        const startDate = new Date(
          `${medication.start_date}T12:00:00`
        );

        const endDate = new Date(startDate);

        endDate.setDate(
          endDate.getDate() + prescribedDays - 1
        );

        const currentDate = new Date(
          `${today}T12:00:00`
        );

        if (currentDate > endDate) {
          return false;
        }
      }

      return true;
    })
    .sort((a, b) =>
      formatTime(a.scheduled_time).localeCompare(
        formatTime(b.scheduled_time)
      )
    );

  $("todayCount").textContent =
    `${items.length} ${items.length === 1 ? "dose" : "doses"}`;

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>
          Você não tem horários de medicamentos programados para hoje.
        </p>
        <p class="muted">
          Use o botão abaixo para cadastrar um medicamento.
        </p>
      </div>
    `;

    return;
  }

  container.innerHTML = items.map((schedule) => {
    const medication = getMedication(
      schedule.medication_id
    );

    const scheduledFor = dateTimeForSchedule(
      today,
      formatTime(schedule.scheduled_time)
    );

    const log = findDoseLog(
      schedule.id,
      scheduledFor
    );

    const status = log?.status || "pending";

    const statusClass = status === "taken"
      ? "taken"
      : status === "not_taken"
        ? "not-taken"
        : "";

    /* EMOJI DA SITUAÇÃO */

    const statusLabel = status === "taken"
      ? "💎 Tomado"
      : status === "not_taken"
        ? "😟 Não tomado"
        : "⏳ Aguardando registro";

    const quantity = Number(
      schedule.dose_quantity || 1
    );

    const unit = medication.stock_unit || "unidades";

    /* PERÍODO DO DIA */

    const timePeriod = getTimePeriod(
      schedule.scheduled_time
    );

    return `
      <article class="dose-card ${statusClass}">

        <div class="dose-top">

          <div>
            <div class="dose-name">
              ${escapeHTML(medication.name)}
            </div>

            <div class="medication-meta">
              ${escapeHTML(medication.dose || "")}
            </div>
          </div>

          <div class="dose-time">
            ${timePeriod} ·
            ${escapeHTML(formatTime(schedule.scheduled_time))}
          </div>

        </div>

        <div class="dose-detail">
          Quantidade desta dose:
          ${quantity}
          ${escapeHTML(unit)}
        </div>

        <div class="status-text ${
          status === "taken"
            ? "status-taken"
            : status === "not_taken"
              ? "status-not-taken"
              : "status-pending"
        }">
          ${statusLabel}
        </div>

        <div class="dose-actions">

          <button
            class="button button-taken"
            type="button"
            data-action="taken"
            data-schedule="${escapeHTML(schedule.id)}"
            ${status === "taken" ? "disabled" : ""}
          >
            💎 Tomado
          </button>

          <button
            class="button button-not-taken"
            type="button"
            data-action="not-taken"
            data-schedule="${escapeHTML(schedule.id)}"
            ${status === "taken" ? "disabled" : ""}
          >
            😟 Não tomado
          </button>

        </div>

      </article>
    `;
  }).join("");

  /* EVENTOS DOS BOTÕES */

  container.querySelectorAll("[data-action]").forEach(
    (button) => {
      button.addEventListener("click", async () => {
        const scheduleId = button.dataset.schedule;
        const action = button.dataset.action;

        if (action === "taken") {
          await markDoseTaken(scheduleId);
        } else {
          await markDoseNotTaken(scheduleId);
        }
      });
    }
  );
}

/* REGISTRO DE DOSES */

/* MARCAR COMO TOMADO */

async function markDoseTaken(scheduleId) {
  const schedule = schedules.find(
    (item) => item.id === scheduleId
  );

  if (!schedule) return;

  const scheduledFor = dateTimeForSchedule(
    todayString(),
    formatTime(schedule.scheduled_time)
  );

  const existingLog = findDoseLog(
    scheduleId,
    scheduledFor
  );

  if (existingLog?.status === "taken") {
    showToast(
      "Esta dose já foi registrada como tomada."
    );
    return;
  }

  const medication = getMedication(
    schedule.medication_id
  );

  if (!medication) {
    showToast("Medicamento não encontrado.", true);
    return;
  }

  if (
    Number(medication.stock_quantity || 0) <
    Number(schedule.dose_quantity || 1)
  ) {
    showToast(
      "Estoque insuficiente. Adicione estoque antes de registrar a dose.",
      true
    );
    return;
  }

  try {
    const { error } = await supabaseClient.rpc(
      "mark_dose_taken",
      {
        p_schedule_id: scheduleId,
        p_scheduled_for: scheduledFor
      }
    );

    if (error) throw error;

    showToast(
      "Dose registrada como tomada. Estoque atualizado!"
    );

    await loadDashboard();

  } catch (error) {
    showError(
      error,
      "Não foi possível registrar a dose como tomada."
    );
  }
}

/* MARCAR COMO NÃO TOMADO */

async function markDoseNotTaken(scheduleId) {
  const schedule = schedules.find(
    (item) => item.id === scheduleId
  );

  if (!schedule) return;

  const scheduledFor = dateTimeForSchedule(
    todayString(),
    formatTime(schedule.scheduled_time)
  );

  const existingLog = findDoseLog(
    scheduleId,
    scheduledFor
  );

  if (existingLog?.status === "taken") {
    showToast(
      "Uma dose já registrada como tomada não pode ser alterada por aqui.",
      true
    );
    return;
  }

  try {
    const { error } = await supabaseClient.rpc(
      "mark_dose_not_taken",
      {
        p_schedule_id: scheduleId,
        p_scheduled_for: scheduledFor
      }
    );

    if (error) throw error;

    showToast(
      "Dose registrada como não tomada. O estoque não foi alterado."
    );

    await loadDashboard();

  } catch (error) {
    showError(
      error,
      "Não foi possível registrar a dose."
    );
  }
}

/* LISTA DE MEDICAMENTOS */

/* ESTIMATIVA DE ESTOQUE */

function estimateStockDays(medication) {
  const medicationSchedules = schedules.filter(
    (schedule) =>
      schedule.medication_id === medication.id
  );

  const dailyUse = medicationSchedules.reduce(
    (total, schedule) =>
      total + Number(schedule.dose_quantity || 1),
    0
  );

  const stock = Number(
    medication.stock_quantity || 0
  );

  if (dailyUse <= 0) return null;

  return Math.floor(stock / dailyUse);
}

/* EXIBIR MEDICAMENTOS CADASTRADOS */

function renderMedicationList() {
  const container = $("medicationList");

  if (!medications.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Você ainda não cadastrou medicamentos.</p>
        <p class="muted">
          Clique em “Adicionar novo medicamento” para começar.
        </p>
      </div>
    `;

    return;
  }

  container.innerHTML = medications.map((medication) => {
    const medicationSchedules = schedules
      .filter(
        (schedule) =>
          schedule.medication_id === medication.id
      )
      .sort((a, b) =>
        formatTime(a.scheduled_time).localeCompare(
          formatTime(b.scheduled_time)
        )
      );

    const stock = Number(
      medication.stock_quantity || 0
    );

    const unit = medication.stock_unit || "unidades";

    const days = estimateStockDays(medication);

    let stockClass = "";
    let stockMessage = "";

    if (stock <= 0) {
      stockClass = "stock-empty";
      stockMessage = "Estoque esgotado";

    } else if (
      days !== null &&
      days <= Number(medication.stock_alert_days || 3)
    ) {
      stockClass = "stock-low";
      stockMessage =
        `Estoque para aproximadamente ${days} dia(s)`;

    } else if (days !== null) {
      stockMessage =
        `Estoque para aproximadamente ${days} dia(s)`;
    }

    const scheduleText = medicationSchedules.length
      ? medicationSchedules
          .map((schedule) =>
            formatTime(schedule.scheduled_time)
          )
          .join(" • ")
      : "Nenhum horário ativo";

    const statusText = medication.status === "active"
      ? "Em uso"
      : medication.status === "paused"
        ? "Pausado"
        : "Concluído";

    return `
      <article class="medication-card">

        <div class="medication-card-top">
          <div>
            <h3>${escapeHTML(medication.name)}</h3>

            <div class="medication-meta">
              ${escapeHTML(medication.dose || "")}
              ${medication.dose ? " • " : ""}
              ${statusText}
            </div>
          </div>
        </div>

        <div class="medication-meta">
          <strong>Horários:</strong>
          ${escapeHTML(scheduleText)}
        </div>

        <div class="stock-line ${stockClass}">
          Estoque:
          ${stock}
          ${escapeHTML(unit)}
          ${stockMessage ? ` — ${escapeHTML(stockMessage)}` : ""}
        </div>

        <div class="card-actions">

          <button
            class="button button-outline"
            type="button"
            data-edit="${escapeHTML(medication.id)}"
          >
            Editar
          </button>

          <button
            class="button button-primary"
            type="button"
            data-restock="${escapeHTML(medication.id)}"
          >
            ＋ Adicionar estoque
          </button>

          ${
            medication.status === "active"
              ? `
                <button
                  class="button button-light"
                  type="button"
                  data-status="paused"
                  data-id="${escapeHTML(medication.id)}"
                >
                  Pausar
                </button>
              `
              : medication.status === "paused"
                ? `
                  <button
                    class="button button-light"
                    type="button"
                    data-status="active"
                    data-id="${escapeHTML(medication.id)}"
                  >
                    Retomar
                  </button>
                `
                : ""
          }

          ${
            medication.status !== "completed"
              ? `
                <button
                  class="button button-light"
                  type="button"
                  data-status="completed"
                  data-id="${escapeHTML(medication.id)}"
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

  /* BOTÃO EDITAR */

  container.querySelectorAll("[data-edit]").forEach(
    (button) => {
      button.addEventListener("click", () => {
        editMedication(button.dataset.edit);
      });
    }
  );

  /* BOTÃO ADICIONAR ESTOQUE */

  container.querySelectorAll("[data-restock]").forEach(
    (button) => {
      button.addEventListener("click", () => {
        openRestock(button.dataset.restock);
      });
    }
  );

  /* BOTÕES DE STATUS */

  container.querySelectorAll("[data-status]").forEach(
    (button) => {
      button.addEventListener("click", () => {
        updateMedicationStatus(
          button.dataset.id,
          button.dataset.status
        );
      });
    }
  );
}

/* FORMULÁRIO DE MEDICAMENTO */

function clearMedicationForm() {
  $("medicationForm").reset();

  $("medicationId").value = "";
  $("medicationStock").value = "0";
  $("medicationStartDate").value = todayString();

  $("scheduleList").innerHTML = "";

  $("medicationFormTitle").textContent =
    "Novo medicamento";
}

function openMedicationForm() {
  clearMedicationForm();

  medicationPanel.classList.remove("hidden");

  medicationPanel.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  addScheduleRow();
}

$("newMedicationButton").addEventListener(
  "click",
  openMedicationForm
);

function closeMedicationForm() {
  medicationPanel.classList.add("hidden");
  clearMedicationForm();
}

$("closeMedicationButton").addEventListener(
  "click",
  closeMedicationForm
);

$("cancelMedicationButton").addEventListener(
  "click",
  closeMedicationForm
);

/* ADICIONAR HORÁRIO */

function addScheduleRow(time = "", quantity = 1) {
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
      <label>Quantidade</label>
      <input
        class="schedule-quantity"
        type="number"
        min="0.01"
        step="0.01"
        required
        value="${escapeHTML(quantity)}"
      >
    </div>

    <button
      class="remove-schedule"
      type="button"
      title="Remover horário"
    >
      ✕
    </button>
  `;

  row.querySelector(".remove-schedule").addEventListener(
    "click",
    () => {
      row.remove();
    }
  );

  $("scheduleList").appendChild(row);
}

$("addScheduleButton").addEventListener("click", () => {
  addScheduleRow();
});

/* LER HORÁRIOS DO FORMULÁRIO */

function readSchedulesFromForm() {
  const rows = [
    ...$("scheduleList").querySelectorAll(".schedule-row")
  ];

  return rows.map((row) => ({
    scheduled_time:
      row.querySelector(".schedule-time").value,

    dose_quantity:
      Number(
        row.querySelector(".schedule-quantity").value
      )
  })).filter((item) =>
    item.scheduled_time &&
    Number.isFinite(item.dose_quantity) &&
    item.dose_quantity > 0
  );
}

/* SALVAR HORÁRIOS */

async function saveMedicationSchedules(
  medicationId,
  scheduleItems
) {
  // Desativa os horários anteriores para preservar o histórico.
  const { error: disableError } = await supabaseClient
    .from("medication_schedules")
    .update({ enabled: false })
    .eq("user_id", currentUser.id)
    .eq("medication_id", medicationId);

  if (disableError) throw disableError;

  if (!scheduleItems.length) return;

  const rows = scheduleItems.map((item) => ({
    user_id: currentUser.id,
    medication_id: medicationId,
    scheduled_time: item.scheduled_time,
    dose_quantity: item.dose_quantity,
    enabled: true
  }));

  const { error } = await supabaseClient
    .from("medication_schedules")
    .insert(rows);

  if (error) throw error;
}

/* SALVAR MEDICAMENTO */

$("medicationForm").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const button = event.submitter;

    button.disabled = true;
    button.textContent = "Salvando...";

    try {
      const medicationId = $("medicationId").value;

      const scheduleItems = readSchedulesFromForm();

      if (!scheduleItems.length) {
        throw new Error(
          "Adicione pelo menos um horário válido."
        );
      }

      const prescribedDays = Number(
        $("medicationDuration").value
      ) || 0;

      const medicationData = {
        user_id: currentUser.id,

        name: $("medicationName").value.trim(),

        dose: $("medicationDose").value.trim(),

        stock_unit: $("medicationUnit").value,

        start_date:
          $("medicationStartDate").value || todayString(),

        duration_days: prescribedDays,

        prescribed_days: prescribedDays,

        instructions:
          $("medicationInstructions").value.trim(),

        status: "active"
      };

      if (!medicationData.name) {
        throw new Error(
          "Informe o nome do medicamento."
        );
      }

      let savedMedicationId = medicationId;

      /* ATUALIZAR MEDICAMENTO EXISTENTE */

      if (medicationId) {
        const { error } = await supabaseClient
          .from("medications")
          .update({
            name: medicationData.name,
            dose: medicationData.dose,
            stock_unit: medicationData.stock_unit,
            start_date: medicationData.start_date,
            duration_days: medicationData.duration_days,
            prescribed_days: medicationData.prescribed_days,
            instructions: medicationData.instructions
          })
          .eq("id", medicationId)
          .eq("user_id", currentUser.id);

        if (error) throw error;

      } else {

        /* NOVO MEDICAMENTO */

        medicationData.stock_quantity = Number(
          $("medicationStock").value || 0
        );

        const { data, error } = await supabaseClient
          .from("medications")
          .insert(medicationData)
          .select("id")
          .single();

        if (error) throw error;

        savedMedicationId = data.id;

        /* REGISTRAR ESTOQUE INICIAL */

        if (medicationData.stock_quantity > 0) {
          const { error: movementError } =
            await supabaseClient
              .from("stock_movements")
              .insert({
                user_id: currentUser.id,
                medication_id: savedMedicationId,
                movement_type: "in",
                quantity: medicationData.stock_quantity,
                note: "Estoque inicial"
              });

          if (movementError) {
            console.warn(
              "Não foi possível registrar o movimento inicial:",
              movementError
            );
          }
        }
      }

      /* SALVAR HORÁRIOS */

      await saveMedicationSchedules(
        savedMedicationId,
        scheduleItems
      );

      closeMedicationForm();

      showToast("Medicamento salvo com sucesso!");

      await loadDashboard();

    } catch (error) {
      showError(
        error,
        "Não foi possível salvar o medicamento."
      );

    } finally {
      button.disabled = false;
      button.textContent = "Salvar medicamento";
    }
  }
);

/* EDIÇÃO */

function editMedication(medicationId) {
  const medication = getMedication(medicationId);

  if (!medication) return;

  clearMedicationForm();

  $("medicationId").value = medication.id;

  $("medicationName").value =
    medication.name || "";

  $("medicationDose").value =
    medication.dose || "";

  $("medicationUnit").value =
    medication.stock_unit || "comprimidos";

  $("medicationStartDate").value =
    medication.start_date || "";

  $("medicationDuration").value =
    medication.prescribed_days ??
    medication.duration_days ??
    "";

  $("medicationInstructions").value =
    medication.instructions || "";

  const medicationSchedules = schedules.filter(
    (schedule) =>
      schedule.medication_id === medicationId
  );

  medicationSchedules.forEach((schedule) => {
    addScheduleRow(
      formatTime(schedule.scheduled_time),
      Number(schedule.dose_quantity || 1)
    );
  });

  if (!medicationSchedules.length) {
    addScheduleRow();
  }

  $("medicationFormTitle").textContent =
    "Editar medicamento";

  medicationPanel.classList.remove("hidden");

  medicationPanel.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

/* STATUS DO MEDICAMENTO */

async function updateMedicationStatus(
  medicationId,
  status
) {
  const labels = {
    active: "retomado",
    paused: "pausado",
    completed: "concluído"
  };

  try {
    const { error } = await supabaseClient
      .from("medications")
      .update({ status })
      .eq("id", medicationId)
      .eq("user_id", currentUser.id);

    if (error) throw error;

    if (status !== "active") {
      const { error: scheduleError } =
        await supabaseClient
          .from("medication_schedules")
          .update({ enabled: false })
          .eq("user_id", currentUser.id)
          .eq("medication_id", medicationId);

      if (scheduleError) throw scheduleError;

    } else {
      // Reativa os horários que já estavam cadastrados.
      const { error: scheduleError } =
        await supabaseClient
          .from("medication_schedules")
          .update({ enabled: true })
          .eq("user_id", currentUser.id)
          .eq("medication_id", medicationId);

      if (scheduleError) throw scheduleError;
    }

    showToast(
      `Medicamento ${labels[status]}.`
    );

    await loadDashboard();

  } catch (error) {
    showError(
      error,
      "Não foi possível alterar o status."
    );
  }
}

/* REPOSIÇÃO DE ESTOQUE */

function openRestock(medicationId) {
  const medication = getMedication(medicationId);

  if (!medication) return;

  $("restockForm").reset();

  $("restockMedicationId").value =
    medication.id;

  $("restockMedicationName").textContent =
    medication.name;

  restockPanel.classList.remove("hidden");

  restockPanel.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function closeRestock() {
  restockPanel.classList.add("hidden");
  $("restockForm").reset();
}

$("closeRestockButton").addEventListener(
  "click",
  closeRestock
);

$("cancelRestockButton").addEventListener(
  "click",
  closeRestock
);

/* SALVAR REPOSIÇÃO */

$("restockForm").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const button = event.submitter;

    button.disabled = true;
    button.textContent = "Salvando...";

    try {
      const medicationId =
        $("restockMedicationId").value;

      const quantity =
        Number($("restockQuantity").value);

      const note =
        $("restockNote").value.trim() ||
        "Reposição de estoque";

      if (
        !medicationId ||
        !Number.isFinite(quantity) ||
        quantity <= 0
      ) {
        throw new Error(
          "Informe uma quantidade válida."
        );
      }

      const { error } = await supabaseClient.rpc(
        "restock_medication",
        {
          p_medication_id: medicationId,
          p_quantity: quantity,
          p_note: note
        }
      );

      if (error) throw error;

      closeRestock();

      showToast(
        "Estoque atualizado com sucesso!"
      );

      await loadDashboard();

    } catch (error) {
      showError(
        error,
        "Não foi possível adicionar estoque."
      );

    } finally {
      button.disabled = false;
      button.textContent = "Confirmar reposição";
    }
  }
);

/* INICIALIZAÇÃO */

async function initializeApp() {
  const { data, error } =
    await supabaseClient.auth.getSession();

  if (error) {
    showError(
      error,
      "Não foi possível verificar sua sessão."
    );
    return;
  }

  await handleAuthSession(data.session);

  supabaseClient.auth.onAuthStateChange(
    async (_event, session) => {
      await handleAuthSession(session);
    }
  );
}

initializeApp();
