
/* ============================================================
   MEDIHORA
   Medicamentos, horários, estoque e autenticação
   Supabase Auth + PostgreSQL
   ============================================================ */

const SUPABASE_URL = "https://dtwfettaesywyczfyvpr.supabase.co";
const SUPABASE_KEY = "sb_publishable_WsqtiIuq2h_4e1gtVGg8PQ_L4LW7px0";

const APP_TIMEZONE = "America/Sao_Paulo";

let supabaseClient = null;
let currentUser = null;
let medications = [];
let schedulesByMedication = {};
let currentFilter = "all";

/* ============================================================
   FUNÇÕES GERAIS
   ============================================================ */

const $ = id => document.getElementById(id);

function showMessage(message, isError = false) {
  const box = $("message");

  box.textContent = message;
  box.classList.remove("hidden", "error");

  if (isError) box.classList.add("error");

  clearTimeout(showMessage.timer);

  showMessage.timer = setTimeout(() => {
    box.classList.add("hidden");
  }, 5000);
}

function setLoading(button, loading, loadingText = "Aguarde...") {
  if (!button) return;

  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    button.textContent =
      button.dataset.originalText || button.textContent;

    button.disabled = false;
  }
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

function todayLocalDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = {};

  parts.forEach(part => {
    values[part.type] = part.value;
  });

  return `${values.year}-${values.month}-${values.day}`;
}

function localScheduleTimestamp(date, time) {
  // Horário local de Brasília, sem depender do fuso do computador.
  return new Date(`${date}T${time.slice(0, 5)}:00-03:00`).toISOString();
}

function localDayBounds() {
  const date = todayLocalDate();

  return {
    start: new Date(`${date}T00:00:00-03:00`).toISOString(),
    end: new Date(
      new Date(`${date}T00:00:00-03:00`).getTime() + 86400000
    ).toISOString()
  };
}

function formatDate(dateValue) {
  if (!dateValue) return "Não informado";

  const [year, month, day] = String(dateValue).slice(0, 10).split("-");

  if (!year || !month || !day) return String(dateValue);

  return `${day}/${month}/${year}`;
}

function formatQuantity(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    maximumFractionDigits: 2
  });
}

function statusLabel(status) {
  return {
    active: "Em uso",
    paused: "Pausado",
    completed: "Concluído"
  }[status] || status;
}

/* ============================================================
   TELAS DE ACESSO
   ============================================================ */

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
  const name = metadata.full_name ||
    user.email?.split("@")[0] ||
    "tudo bem?";

  $("userName").textContent = name.split(" ")[0];

  loadMedications();
}

function showLogin() {
  currentUser = null;

  $("appSection").classList.add("hidden");
  $("authSection").classList.remove("hidden");

  showAuthBox("loginBox");
}

/* ============================================================
   AUTENTICAÇÃO
   ============================================================ */

async function login(event) {
  event.preventDefault();

  const button = $("loginForm").querySelector('button[type="submit"]');

  setLoading(button, true, "Entrando...");

  try {
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    if (data.user) {
      showApplication(data.user);
      showMessage("Acesso realizado com sucesso!");
    }
  } catch (error) {
    showMessage(error.message || "Não foi possível entrar.", true);
  } finally {
    setLoading(button, false);
  }
}

async function register(event) {
  event.preventDefault();

  const button = $("registerForm").querySelector('button[type="submit"]');

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
      showMessage("Conta criada com sucesso!");
    } else {
      showMessage("Confira seu e-mail para confirmar seu cadastro.");
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

  const button = $("recoveryForm").querySelector('button[type="submit"]');

  setLoading(button, true, "Enviando...");

  try {
    const email = $("recoveryEmail").value.trim();

    const { error } = await supabaseClient.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: window.location.origin + window.location.pathname
      }
    );

    if (error) throw error;

    showMessage("Se o e-mail estiver cadastrado, você receberá o link.");
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

/* ============================================================
   FORMULÁRIO DE HORÁRIOS
   ============================================================ */

function addTimeRow(value = "08:00", quantity = 1) {
  const row = document.createElement("div");
  row.className = "time-row";

  const time = document.createElement("input");
  time.type = "time";
  time.className = "schedule-time";
  time.value = value;
  time.required = true;
  time.setAttribute("aria-label", "Horário da dose");

  const qty = document.createElement("input");
  qty.type = "number";
  qty.className = "schedule-quantity";
  qty.min = "0.01";
  qty.step = "0.01";
  qty.value = quantity;
  qty.required = true;
  qty.setAttribute("aria-label", "Quantidade por dose");

  const unit = document.createElement("span");
  unit.className = "time-unit";
  unit.textContent = "unid.";

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

  row.append(time, qty, unit, remove);

  $("scheduleList").appendChild(row);
}

function getSelectedTimes() {
  const rows = [...document.querySelectorAll(".time-row")];

  return rows.map(row => ({
    time: row.querySelector(".schedule-time").value,
    quantity: Number(
      row.querySelector(".schedule-quantity").value
    )
  }));
}

function resetMedicationForm() {
  $("medicationForm").reset();

  $("medicationId").value = "";
  $("startDate").value = todayLocalDate();

  $("stockQuantity").disabled = false;
  $("stockQuantity").value = "";
  $("stockUnit").disabled = false;
  $("stockUnit").value = "comprimidos";

  $("stockAlertDays").value = 3;

  $("scheduleList").innerHTML = "";

  addTimeRow("08:00", 1);

  $("formTitle").textContent = "Adicionar medicamento";
  $("saveMedicationButton").textContent = "Salvar medicamento";

  $("cancelEditButton").classList.add("hidden");
}

function fillMedicationForm(medication, schedules) {
  $("medicationId").value = medication.id;
  $("medName").value = medication.name || "";
  $("medDose").value = medication.dose || "";
  $("medInstructions").value = medication.instructions || "";

  $("startDate").value =
    medication.start_date || todayLocalDate();

  $("durationDays").value = medication.prescribed_days || "";

  $("stockQuantity").value = medication.stock_quantity ?? 0;
  $("stockUnit").value =
    medication.stock_unit || "comprimidos";

  $("stockAlertDays").value =
    medication.stock_alert_days || 3;

  // A quantidade atual é alterada somente pela reposição.
  $("stockQuantity").disabled = true;
  $("stockUnit").disabled = true;

  $("scheduleList").innerHTML = "";

  const ordered = [...schedules].sort((a, b) =>
    String(a.scheduled_time).localeCompare(String(b.scheduled_time))
  );

  if (ordered.length) {
    ordered.forEach(schedule => {
      addTimeRow(
        String(schedule.scheduled_time).slice(0, 5),
        schedule.dose_quantity || 1
      );
    });
  } else {
    addTimeRow("08:00", 1);
  }

  $("formTitle").textContent = "Editar medicamento";
  $("saveMedicationButton").textContent = "Salvar alterações";

  $("cancelEditButton").classList.remove("hidden");

  $("medicationPanel").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

/* ============================================================
   CARREGAMENTO DE MEDICAMENTOS E HORÁRIOS
   ============================================================ */

async function loadMedications() {
  if (!currentUser) return;

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

      const { data: schedules, error: scheduleError } =
        await supabaseClient
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

        schedulesByMedication[schedule.medication_id].push({
          ...schedule,
          taken: false
        });
      });

      // Consultar as doses já tomadas hoje.
      const allSchedules = Object.values(schedulesByMedication).flat();

      if (allSchedules.length) {
        const bounds = localDayBounds();

        const { data: logs, error: logsError } =
          await supabaseClient
            .from("dose_logs")
            .select("schedule_id,status")
            .in("schedule_id", allSchedules.map(item => item.id))
            .eq("user_id", currentUser.id)
            .gte("scheduled_for", bounds.start)
            .lt("scheduled_for", bounds.end);

        if (logsError) throw logsError;

        const takenIds = new Set(
          (logs || [])
            .filter(log => log.status === "taken")
            .map(log => log.schedule_id)
        );

        allSchedules.forEach(schedule => {
          schedule.taken = takenIds.has(schedule.id);
        });
      }
    }

    updateCounters();
    renderMedications();

  } catch (error) {
    $("medicationList").innerHTML =
      '<div class="empty-state">Não foi possível carregar os medicamentos.</div>';

    showMessage(error.message || "Erro ao carregar dados.", true);
  }
}

/* ============================================================
   SALVAR E EDITAR MEDICAMENTOS
   ============================================================ */

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

    const stock = Number($("stockQuantity").value);
    const stockUnit = $("stockUnit").value;
    const alertDays = Number($("stockAlertDays").value);

    const times = getSelectedTimes();

    if (!name || !dose || !startDate || !duration) {
      throw new Error("Preencha os campos obrigatórios.");
    }

    if (!Number.isInteger(duration) || duration < 1 || duration > 3650) {
      throw new Error("Informe uma duração válida.");
    }

    if (!Number.isInteger(alertDays) || alertDays < 1 || alertDays > 30) {
      throw new Error("O aviso deve ser entre 1 e 30 dias.");
    }

    if (!times.length) {
      throw new Error("Informe pelo menos um horário.");
    }

    if (times.some(item =>
      !item.time ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0
    )) {
      throw new Error("Confira os horários e as quantidades.");
    }

    if (new Set(times.map(item => item.time)).size !== times.length) {
      throw new Error("Não repita o mesmo horário.");
    }

    if (!id && (!Number.isFinite(stock) || stock < 0)) {
      throw new Error("Informe um estoque inicial válido.");
    }

    const medicationData = {
      user_id: currentUser.id,
      name,
      dose,
      instructions,
      start_date: startDate,
      prescribed_days: duration,
      timezone: APP_TIMEZONE,
      stock_alert_days: alertDays,
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
      medicationData.stock_quantity = stock;
      medicationData.stock_unit = stockUnit;

      const { data, error } = await supabaseClient
        .from("medications")
        .insert(medicationData)
        .select("id")
        .single();

      if (error) throw error;

      medicationId = data.id;

      // Registrar a entrada inicial no histórico.
      if (stock > 0) {
        const { error: movementError } = await supabaseClient
          .from("stock_movements")
          .insert({
            user_id: currentUser.id,
            medication_id: medicationId,
            movement_type: "in",
            quantity: stock,
            note: "Estoque inicial"
          });

        if (movementError) {
          throw new Error(
            "Medicamento criado, mas não foi possível registrar o estoque inicial: " +
            movementError.message
          );
        }
      }
    }

    // Preservar os horários antigos para não apagar o histórico.
    const oldSchedules = id
      ? (schedulesByMedication[id] || [])
      : [];

    const submittedTimes = new Set(times.map(item => item.time));

    for (const oldSchedule of oldSchedules) {
      const oldTime = String(oldSchedule.scheduled_time).slice(0, 5);

      if (!submittedTimes.has(oldTime)) {
        const { error } = await supabaseClient
          .from("medication_schedules")
          .update({ enabled: false })
          .eq("id", oldSchedule.id)
          .eq("user_id", currentUser.id);

        if (error) throw error;
      }
    }

    for (const item of times) {
      const existing = oldSchedules.find(schedule =>
        String(schedule.scheduled_time).slice(0, 5) === item.time
      );

      if (existing) {
        const { error } = await supabaseClient
          .from("medication_schedules")
          .update({
            dose_quantity: item.quantity,
            enabled: true
          })
          .eq("id", existing.id)
          .eq("user_id", currentUser.id);

        if (error) throw error;

      } else {
        const { error } = await supabaseClient
          .from("medication_schedules")
          .insert({
            user_id: currentUser.id,
            medication_id: medicationId,
            scheduled_time: item.time,
            dose_quantity: item.quantity,
            enabled: true
          });

        if (error) throw error;
      }
    }

    resetMedicationForm();

    await loadMedications();

    showMessage(
      id
        ? "Medicamento atualizado com sucesso!"
        : "Medicamento cadastrado com sucesso!"
    );

  } catch (error) {
    showMessage(error.message || "Não foi possível salvar.", true);
  } finally {
    setLoading(button, false);
  }
}

/* ============================================================
   REGISTRAR DOSE TOMADA
   ============================================================ */

async function markDoseTaken(scheduleId, time) {
  if (!currentUser) {
    showMessage("Entre novamente na sua conta.", true);
    return;
  }

  const scheduledFor = localScheduleTimestamp(
    todayLocalDate(),
    time
  );

  if (!confirm("Confirma que tomou esta dose? O estoque será atualizado.")) {
    return;
  }

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

    if (data?.already_taken) {
      showMessage("Esta dose já estava registrada.");
    } else {
      showMessage(
        `Dose registrada! Estoque restante: ${formatQuantity(data.remaining)}.`
      );
    }

  } catch (error) {
    showMessage(error.message || "Não foi possível registrar a dose.", true);
  }
}

/* ============================================================
   REPOR ESTOQUE
   ============================================================ */

async function restockMedication(id) {
  const medication = medications.find(item => item.id === id);

  if (!medication) return;

  const quantityText = prompt(
    `Quantas ${medication.stock_unit || "unidades"} deseja adicionar ao estoque?`
  );

  if (quantityText === null) return;

  const quantity = Number(quantityText.trim().replace(",", "."));

  if (!Number.isFinite(quantity) || quantity <= 0) {
    showMessage("Informe uma quantidade válida.", true);
    return;
  }

  try {
    const { data, error } = await supabaseClient.rpc(
      "restock_medication",
      {
        p_medication_id: id,
        p_quantity: quantity,
        p_note: "Reposição de estoque"
      }
    );

    if (error) throw error;

    await loadMedications();

    showMessage(
      `Reposição realizada! Novo estoque: ${formatQuantity(data.remaining)}.`
    );

  } catch (error) {
    showMessage(error.message || "Não foi possível repor o estoque.", true);
  }
}

/* ============================================================
   PAUSAR, RETOMAR E CONCLUIR
   ============================================================ */

async function changeMedicationStatus(id, status) {
  const questions = {
    active: "Deseja retomar este medicamento?",
    paused: "Deseja pausar este medicamento?",
    completed: "Deseja marcar este tratamento como concluído?"
  };

  if (!confirm(questions[status])) return;

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

    showMessage("Situação atualizada.");

  } catch (error) {
    showMessage(error.message || "Não foi possível atualizar.", true);
  }
}

/* ============================================================
   EDITAR MEDICAMENTO
   ============================================================ */

function editMedication(id) {
  const medication = medications.find(item => item.id === id);

  if (!medication) return;

  if (medication.status === "completed") {
    showMessage("Tratamentos concluídos não podem ser editados.", true);
    return;
  }

  fillMedicationForm(
    medication,
    schedulesByMedication[id] || []
  );
}

/* ============================================================
   INDICADORES
   ============================================================ */

function updateCounters() {
  $("activeCount").textContent =
    medications.filter(item => item.status === "active").length;

  $("pausedCount").textContent =
    medications.filter(item => item.status === "paused").length;

  $("completedCount").textContent =
    medications.filter(item => item.status === "completed").length;
}

function calculateStock(medication) {
  const schedules = schedulesByMedication[medication.id] || [];

  const dailyConsumption = schedules.reduce(
    (total, schedule) =>
      total + Number(schedule.dose_quantity || 0),
    0
  );

  const stock = Number(medication.stock_quantity || 0);

  const remainingDays = dailyConsumption > 0
    ? stock / dailyConsumption
    : null;

  return {
    stock,
    dailyConsumption,
    remainingDays,
    alertDays: Number(medication.stock_alert_days || 3)
  };
}

/* ============================================================
   EXIBIR MEDICAMENTOS
   ============================================================ */

function renderMedications() {
  const list = $("medicationList");

  const filtered = medications.filter(item =>
    currentFilter === "all" ||
    item.status === currentFilter
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
    const schedules = schedulesByMedication[medication.id] || [];

    const status = medication.status || "active";
    const stockInfo = calculateStock(medication);

    let stockMessage = "Informe horários para calcular o consumo diário.";
    let stockClass = "stock-normal";

    if (stockInfo.remainingDays !== null) {
      if (stockInfo.stock <= 0) {
        stockMessage = "Estoque esgotado.";
        stockClass = "stock-empty";

      } else if (stockInfo.remainingDays <= stockInfo.alertDays) {
        stockMessage =
          `Atenção! Estoque para aproximadamente ${Math.ceil(stockInfo.remainingDays)} dia(s).`;
        stockClass = "stock-warning";

      } else {
        stockMessage =
          `Estoque para aproximadamente ${Math.floor(stockInfo.remainingDays)} dia(s).`;
      }
    }

    const unit = medication.stock_unit || "unidades";

    const doseRows = status === "active"
      ? schedules.map(schedule => `
          <div class="dose-row">
            <span>
              ${escapeHTML(String(schedule.scheduled_time).slice(0, 5))}
              · ${escapeHTML(formatQuantity(schedule.dose_quantity))}
              ${escapeHTML(unit)}
            </span>

            <button
              type="button"
              class="dose-button ${schedule.taken ? "dose-taken" : ""}"
              data-action="take"
              data-id="${escapeHTML(schedule.id)}"
              data-time="${escapeHTML(schedule.scheduled_time)}"
              ${schedule.taken ? "disabled" : ""}>
              ${schedule.taken ? "✓ Tomada hoje" : "Marcar como tomada"}
            </button>
          </div>
        `).join("")
      : "";

    let actions = "";

    if (status === "active") {
      actions = `
        <button class="action-edit" data-action="edit"
          data-id="${escapeHTML(medication.id)}">Editar</button>

        <button class="action-pause" data-action="pause"
          data-id="${escapeHTML(medication.id)}">Pausar</button>

        <button class="action-complete" data-action="complete"
          data-id="${escapeHTML(medication.id)}">Concluir</button>`;

    } else if (status === "paused") {
      actions = `
        <button class="action-edit" data-action="edit"
          data-id="${escapeHTML(medication.id)}">Editar</button>

        <button class="action-resume" data-action="resume"
          data-id="${escapeHTML(medication.id)}">Retomar</button>

        <button class="action-complete" data-action="complete"
          data-id="${escapeHTML(medication.id)}">Concluir</button>`;
    }

    return `
      <article class="medication-card">

        <div class="medication-card-top">
          <div>
            <h3>${escapeHTML(medication.name)}</h3>
            <p class="medication-dose">${escapeHTML(medication.dose)}</p>
          </div>

          <span class="status status-${escapeHTML(status)}">
            ${statusLabel(status)}
          </span>
        </div>

        <div class="stock-box ${stockClass}">
          <strong>
            📦 Estoque:
            ${escapeHTML(formatQuantity(stockInfo.stock))}
            ${escapeHTML(unit)}
          </strong>

          <p>${escapeHTML(stockMessage)}</p>

          <button
            type="button"
            class="stock-replenish"
            data-action="restock"
            data-id="${escapeHTML(medication.id)}">
            + Repor estoque
          </button>
        </div>

        <div class="card-details">

          <p><strong>Horários e doses:</strong></p>

          <div class="dose-list">
            ${doseRows || "<p>Não há horários ativos.</p>"}
          </div>

          <p>
            <strong>Início:</strong>
            ${formatDate(medication.start_date)}
          </p>

          <p>
            <strong>Duração prescrita:</strong>
            ${escapeHTML(medication.prescribed_days)} dias
          </p>

          ${medication.instructions
            ? `<p><strong>Instruções:</strong> ${escapeHTML(medication.instructions)}</p>`
            : ""}

        </div>

        ${actions ? `<div class="card-actions">${actions}</div>` : ""}

      </article>`;
  }).join("");
}

/* ============================================================
   EVENTOS
   ============================================================ */

function configureEvents() {
  $("loginForm").addEventListener("submit", login);
  $("registerForm").addEventListener("submit", register);
  $("recoveryForm").addEventListener("submit", recoverPassword);

  $("medicationForm").addEventListener("submit", saveMedication);

  $("showRegister").addEventListener("click", () => {
    showAuthBox("registerBox");
  });

  $("showRecovery").addEventListener("click", () => {
    showAuthBox("recoveryBox");
  });

  $("showLoginFromRegister").addEventListener("click", () => {
    showAuthBox("loginBox");
  });

  $("showLoginFromRecovery").addEventListener("click", () => {
    showAuthBox("loginBox");
  });

  $("logoutButton").addEventListener("click", logout);

  $("addTimeButton").addEventListener("click", () => {
    addTimeRow("12:00", 1);
  });

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

    if (action === "edit") {
      editMedication(id);
    }

    if (action === "pause") {
      changeMedicationStatus(id, "paused");
    }

    if (action === "resume") {
      changeMedicationStatus(id, "active");
    }

    if (action === "complete") {
      changeMedicationStatus(id, "completed");
    }

    if (action === "restock") {
      restockMedication(id);
    }

    if (action === "take") {
      markDoseTaken(id, button.dataset.time);
    }
  });
}

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */

async function initializeApp() {
  configureEvents();
  resetMedicationForm();

  if (!window.supabase || !window.supabase.createClient) {
    showMessage(
      "Não foi possível carregar o serviço de acesso. Atualize a página.",
      true
    );
    return;
  }

  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );

  try {
    const { data, error } = await supabaseClient.auth.getSession();

    if (error) throw error;

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

      if (event === "PASSWORD_RECOVERY") {
        showMessage("Você pode atualizar sua senha.");
      }
    });

  } catch (error) {
    console.error("Erro na inicialização:", error);
    showLogin();
    showMessage("Não foi possível verificar seu acesso. Entre novamente.", true);
  }
}

document.addEventListener("DOMContentLoaded", initializeApp);
