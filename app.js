
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
  SUPABASE_KEY
);

let currentUser = null;
let medications = [];
let schedulesByMedication = {};
let editingMedicationId = null;
let toastTimeout = null;

const $ = id => document.getElementById(id);

/* ============================================================
   DATA E FORMATAÇÃO
   ============================================================ */

function todayLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function localDayBounds() {
  const date = todayLocalDate();

  return {
    start: `${date}T00:00:00-03:00`,
    end: `${date}T00:00:00-03:00`.replace(
      `${date}T00:00:00`,
      `${nextDate(date)}T00:00:00`
    )
  };
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
let restockMedicationId = null;

function openRestockForm(medicationId) {
    const medication = medications.find(
        item => item.id === medicationId
    );

    if (!medication) {
        alert("Medicamento não encontrado.");
        return;
    }

    restockMedicationId = medicationId;

    $("restockMedicationName").textContent =
        "Medicamento: " + medication.name;

    $("restockQuantity").value = "";
    $("restockNote").value = "";

    $("restockPanel").classList.remove("hidden");

    $("restockPanel").scrollIntoView({
        behavior: "smooth",
        block: "center"
    });

    $("restockQuantity").focus();
}

function closeRestockForm() {
    $("restockPanel").classList.add("hidden");
    $("restockForm").reset();
    restockMedicationId = null;
}

$("cancelRestockButton").addEventListener("click", () => {
    closeRestockForm();
});

$("restockForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!restockMedicationId) return;

    const quantity = Number($("restockQuantity").value);
    const note = $("restockNote").value.trim() ||
        "Reposição de estoque";

    if (!Number.isFinite(quantity) || quantity <= 0) {
        alert("Informe uma quantidade válida.");
        return;
    }

    const button = $("saveRestockButton");
    button.disabled = true;
    button.textContent = "Salvando...";

    try {
        const { error } = await supabaseClient.rpc(
            "restock_medication",
            {
                p_medication_id: restockMedicationId,
                p_quantity: quantity,
                p_note: note
            }
        );

        if (error) throw error;

        closeRestockForm();

        await loadMedications();

        alert("Estoque atualizado com sucesso!");

    } catch (error) {
        console.error(error);
        alert("Não foi possível atualizar o estoque: " + error.message);

    } finally {
        button.disabled = false;
        button.textContent = "Salvar estoque";
    }
});
function formatDate(dateString) {
  if (!dateString) return "";

  const [year, month, day] = dateString.split("-").map(Number);

  return new Date(year, month - 1, day).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

function localScheduleTimestamp(dateString, timeString) {
  return `${dateString}T${String(timeString).slice(0, 5)}:00-03:00`;
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

/* ============================================================
   AUTENTICAÇÃO
   ============================================================ */

function showAuthPanel(panelId) {
  ["loginPanel", "registerPanel", "recoveryPanel"].forEach(id => {
    $(id).classList.toggle("hidden", id !== panelId);
  });
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
        data: { full_name: name }
      }
    });

    if (error) throw error;

    if (data.session) {
      showMessage("Conta criada com sucesso!");
      await showApplication(data.user);
    } else {
      showMessage("Cadastro realizado! Confira seu e-mail para confirmar a conta.");
      showAuthPanel("loginPanel");
    }
  } catch (error) {
    showMessage(error.message || "Não foi possível criar a conta.", true);
  }
}

async function handleLogin(event) {
  event.preventDefault();

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    await showApplication(data.user);
    showMessage("Bem-vindo(a) ao MediHora!");
  } catch (error) {
    showMessage(error.message || "E-mail ou senha inválidos.", true);
  }
}

async function handleRecovery(event) {
  event.preventDefault();

  const email = $("recoveryEmail").value.trim();

  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });

    if (error) throw error;

    showMessage("Se o e-mail estiver cadastrado, você receberá as instruções.");
    showAuthPanel("loginPanel");
  } catch (error) {
    showMessage(error.message || "Não foi possível enviar o link.", true);
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

  $("appSection").classList.add("hidden");
  $("authSection").classList.remove("hidden");
  $("logoutButton").classList.add("hidden");

  showAuthPanel("loginPanel");
  showMessage("Você saiu da sua conta.");
}

async function showApplication(user) {
  currentUser = user;

  $("authSection").classList.add("hidden");
  $("appSection").classList.remove("hidden");
  $("logoutButton").classList.remove("hidden");

  const metadata = user.user_metadata || {};
  const displayName = metadata.full_name || user.email?.split("@")[0] || "bem-vindo(a)";

  $("userName").textContent = displayName;
  $("medicationStartDate").value = todayLocalDate();

  await loadMedications();
}

/* ============================================================
   CARREGAR MEDICAMENTOS E HORÁRIOS
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
      const medicationIds = medications.map(item => item.id);

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

        schedulesByMedication[schedule.medication_id].push(schedule);
      });
    }

    // Consultar a situação de cada dose de hoje.
    const allSchedules = Object.values(schedulesByMedication).flat();

    if (allSchedules.length) {
      const bounds = localDayBounds();

      const { data: logs, error: logsError } =
        await supabaseClient
          .from("dose_logs")
          .select("schedule_id,status,scheduled_for")
          .in("schedule_id", allSchedules.map(item => item.id))
          .eq("user_id", currentUser.id)
          .gte("scheduled_for", bounds.start)
          .lt("scheduled_for", bounds.end);

      if (logsError) throw logsError;

      const statusBySchedule = new Map(
        (logs || []).map(log => [log.schedule_id, log.status])
      );

      allSchedules.forEach(schedule => {
        schedule.doseStatus =
          statusBySchedule.get(schedule.id) || "pending";

        schedule.taken = schedule.doseStatus === "taken";
      });
    }

    updateCounters();
    renderMedications();

    showTodayPanel();
    renderTodayMedications();

  } catch (error) {
    console.error("Erro ao carregar medicamentos:", error);
    showMessage(error.message || "Erro ao carregar seus medicamentos.", true);
  }
}

/* ============================================================
   PAINEL DIÁRIO
   ============================================================ */

function showTodayPanel() {
  $("todayDate").textContent = formatDate(todayLocalDate());
}

function isMedicationScheduledToday(medication) {
  if (medication.status !== "active") return false;

  const today = todayLocalDate();

  if (medication.start_date && medication.start_date > today) {
    return false;
  }

  if (medication.start_date && medication.prescribed_days) {
    const [year, month, day] = medication.start_date.split("-").map(Number);
    const start = new Date(Date.UTC(year, month - 1, day));
    start.setUTCDate(start.getUTCDate() + Number(medication.prescribed_days) - 1);

    const endDate = [
      start.getUTCFullYear(),
      String(start.getUTCMonth() + 1).padStart(2, "0"),
      String(start.getUTCDate()).padStart(2, "0")
    ].join("-");

    if (today > endDate) return false;
  }

  return true;
}


function renderTodayMedications() {
  const container = $("todayMedicationList");

  const items = medications
    .filter(isMedicationScheduledToday)
    .map(medication => ({
      medication,
      schedules: schedulesByMedication[medication.id] || []
    }))
    .filter(item => item.schedules.length > 0)
    .sort((a, b) =>
      a.medication.name.localeCompare(b.medication.name, "pt-BR")
    );

  if (!items.length) {
    container.innerHTML = `
      <div class="today-empty">
        <div style="font-size:32px">💊</div>
        <strong>Nenhum medicamento programado para hoje.</strong>
        <p>Cadastre um medicamento para visualizar seus horários aqui.</p>
      </div>`;
    return;
  }

  container.innerHTML = items.map(({ medication, schedules }) => {
    const stockUnit = medication.stock_unit || "unidades";
    const currentStock = formatQuantity(medication.stock_quantity);

    const doseCards = schedules.map(schedule => {
      const status = schedule.doseStatus || "pending";
      const time = String(schedule.scheduled_time).slice(0, 5);

      let statusText = "Aguardando registro";

      if (status === "taken") statusText = "✓ Tomado";
      if (status === "not_taken") statusText = "✕ Não tomado";

      const takenSelected = status === "taken" ? "selected" : "";
      const notTakenSelected = status === "not_taken" ? "selected" : "";
      const locked = status === "taken";

      // Exibe o estoque atualizado quando a dose foi tomada.
      const stockInfo = status === "taken"
        ? `
          <div class="dose-stock-info">
            <span>📦</span>
            <span>
              Estoque restante:
              <strong>${escapeHTML(currentStock)} ${escapeHTML(stockUnit)}</strong>
            </span>
          </div>
        `
        : "";

      return `
        <div class="today-dose status-${status}">
          <div class="today-dose-heading">
            <span class="today-dose-time">Às ${escapeHTML(time)}</span>
            <span class="today-dose-state">${statusText}</span>
          </div>

          <p>
            Quantidade desta dose:
            ${escapeHTML(formatQuantity(schedule.dose_quantity))}
            ${escapeHTML(stockUnit)}
          </p>

          <div class="today-dose-actions">
            <button
              type="button"
              class="button-taken ${takenSelected}"
              data-action="today-taken"
              data-id="${escapeHTML(schedule.id)}"
              data-time="${escapeHTML(time)}"
              ${locked ? "disabled" : ""}>
              Tomado
            </button>

            <button
              type="button"
              class="button-not-taken ${notTakenSelected}"
              data-action="today-not-taken"
              data-id="${escapeHTML(schedule.id)}"
              data-time="${escapeHTML(time)}"
              ${locked ? "disabled" : ""}>
              Não tomado
            </button>
          </div>

          ${stockInfo}
        </div>`;
    }).join("");

    return `
      <article class="today-medication-card">
        <h3>${escapeHTML(medication.name)}</h3>
        <p class="medication-dose">${escapeHTML(medication.dose)}</p>
        ${doseCards}
      </article>`;
  }).join("");
}


/* ============================================================
   REGISTRAR DOSE COMO TOMADA
   ============================================================ */

async function markDoseTaken(scheduleId, time) {
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

    if (data?.already_taken) {
      showMessage("Esta dose já estava registrada como tomada.");
    } else {
      showMessage("Dose registrada como tomada. Estoque atualizado.");
    }

  } catch (error) {
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
  const scheduledFor = localScheduleTimestamp(
    todayLocalDate(),
    time
  );

  if (!confirm("Confirma que esta dose não foi tomada?")) {
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

    await loadMedications();

    showMessage("Registro atualizado: dose não tomada.");

  } catch (error) {
    showMessage(
      error.message || "Não foi possível registrar a dose.",
      true
    );
  }
}

/* ============================================================
   FORMULÁRIO DE MEDICAMENTO
   ============================================================ */

function addScheduleRow(time = "", quantity = "1") {
  const row = document.createElement("div");
  row.className = "schedule-row";

  row.innerHTML = `
    <div>
      <label>Horário</label>
      <input class="schedule-time" type="time" required value="${escapeHTML(time)}">
    </div>

    <div>
      <label>Quantidade por horário</label>
      <input class="schedule-quantity" type="number" min="0.01" step="0.01" required value="${escapeHTML(quantity)}">
    </div>

    <button class="remove-schedule" type="button" aria-label="Remover horário">Remover</button>
  `;

  row.querySelector(".remove-schedule").addEventListener("click", () => {
    const rows = $("scheduleList").querySelectorAll(".schedule-row");

    if (rows.length <= 1) {
      showMessage("Mantenha pelo menos um horário.", true);
      return;
    }

    row.remove();
  });

  $("scheduleList").appendChild(row);
}

function resetMedicationForm() {
  editingMedicationId = null;

  $("medicationForm").reset();
  $("medicationId").value = "";
  $("formTitle").textContent = "Novo medicamento";
  $("saveMedicationButton").textContent = "Salvar medicamento";
  $("medicationStartDate").value = todayLocalDate();
  $("medicationStock").value = "0";
  $("medicationUnit").value = "comprimidos";

  $("scheduleList").innerHTML = "";
  addScheduleRow();
}

function openNewMedicationForm() {
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

  document.querySelector(".today-section")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function fillMedicationForm(medication, schedules) {
  editingMedicationId = medication.id;

  $("medicationId").value = medication.id;
  $("medicationName").value = medication.name || "";
  $("medicationDose").value = medication.dose || "";
  $("medicationUnit").value = medication.stock_unit || "comprimidos";
  $("medicationStock").value = medication.stock_quantity ?? 0;
  $("medicationStartDate").value = medication.start_date || todayLocalDate();
  $("medicationDays").value = medication.prescribed_days || "";
  $("medicationInstructions").value = medication.instructions || "";

  $("formTitle").textContent = "Editar medicamento";
  $("saveMedicationButton").textContent = "Salvar alterações";

  $("scheduleList").innerHTML = "";

  if (schedules.length) {
    schedules.forEach(schedule => {
      addScheduleRow(
        String(schedule.scheduled_time).slice(0, 5),
        String(schedule.dose_quantity || 1)
      );
    });
  } else {
    addScheduleRow();
  }
}

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

  $("medicationPanel").classList.remove("hidden");

  $("medicationPanel").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

async function saveMedication(event) {
  event.preventDefault();

  if (!currentUser) return;

  const name = $("medicationName").value.trim();
  const dose = $("medicationDose").value.trim();
  const stockUnit = $("medicationUnit").value;
  const stockQuantity = Number($("medicationStock").value || 0);
  const startDate = $("medicationStartDate").value;
  const prescribedDays = $("medicationDays").value
    ? Number($("medicationDays").value)
    : null;
  const instructions = $("medicationInstructions").value.trim();

  if (!name || !dose || !startDate) {
    showMessage("Preencha os campos obrigatórios.", true);
    return;
  }

  if (stockQuantity < 0) {
    showMessage("O estoque não pode ser negativo.", true);
    return;
  }

  const scheduleRows = [...$("scheduleList").querySelectorAll(".schedule-row")];

  const scheduleValues = scheduleRows.map(row => ({
    scheduled_time: row.querySelector(".schedule-time").value,
    dose_quantity: Number(row.querySelector(".schedule-quantity").value)
  }));

  if (!scheduleValues.length || scheduleValues.some(item =>
    !item.scheduled_time ||
    !Number.isFinite(item.dose_quantity) ||
    item.dose_quantity <= 0
  )) {
    showMessage("Confira os horários e as quantidades informadas.", true);
    return;
  }

  const uniqueTimes = scheduleValues.map(item => item.scheduled_time);

  if (new Set(uniqueTimes).size !== uniqueTimes.length) {
    showMessage("Não repita o mesmo horário no cadastro.", true);
    return;
  }

  const saveButton = $("saveMedicationButton");
  saveButton.disabled = true;
  saveButton.textContent = "Salvando...";

  try {
    let medicationId = editingMedicationId;
    let previousStock = 0;

    if (editingMedicationId) {
      const existing = medications.find(item => item.id === editingMedicationId);

      if (!existing) throw new Error("Medicamento não encontrado.");

      previousStock = Number(existing.stock_quantity || 0);

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
        .eq("id", editingMedicationId)
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
        const { error: movementError } = await supabaseClient
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

    // Registra eventual ajuste de estoque feito durante a edição.
    if (editingMedicationId && stockQuantity !== previousStock) {
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

      if (movementError) throw movementError;
    }

    // Mantém os horários anteriores para preservar o histórico.
    const oldSchedules = schedulesByMedication[medicationId] || [];

    const { data: allOldSchedules, error: oldError } =
      await supabaseClient
        .from("medication_schedules")
        .select("*")
        .eq("medication_id", medicationId)
        .eq("user_id", currentUser.id)
        .eq("enabled", true);

    if (oldError) throw oldError;

    const oldList = allOldSchedules || [];

    const schedulesToKeep = [];

    for (const value of scheduleValues) {
      const existing = oldList.find(item =>
        !schedulesToKeep.includes(item.id) &&
        String(item.scheduled_time).slice(0, 5) === value.scheduled_time
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

    await loadMedications();

    $("medicationPanel").classList.add("hidden");
    resetMedicationForm();

    showMessage(
      editingMedicationId
        ? "Medicamento atualizado com sucesso."
        : "Medicamento cadastrado com sucesso."
    );

  } catch (error) {
    console.error(error);
    showMessage(error.message || "Não foi possível salvar o medicamento.", true);

  } finally {
    saveButton.disabled = false;
    saveButton.textContent = editingMedicationId
      ? "Salvar alterações"
      : "Salvar medicamento";
  }
}

/* ============================================================
   ESTOQUE
   ============================================================ */

async function restockMedication(id) {
  const medication = medications.find(item => item.id === id);

  if (!medication) return;

  const answer = prompt(
    `Quantas unidades deseja adicionar ao estoque de ${medication.name}?`
  );

  if (answer === null) return;

  const quantity = Number(answer.replace(",", "."));

  if (!Number.isFinite(quantity) || quantity <= 0) {
    showMessage("Informe uma quantidade válida.", true);
    return;
  }

  try {
    const { error } = await supabaseClient.rpc(
      "restock_medication",
      {
        p_medication_id: id,
        p_quantity: quantity,
        p_note: "Reposição informada pelo usuário"
      }
    );

    if (error) throw error;

    await loadMedications();
    showMessage("Estoque atualizado com sucesso.");

  } catch (error) {
    showMessage(error.message || "Não foi possível atualizar o estoque.", true);
  }
}

/* ============================================================
   STATUS DO MEDICAMENTO
   ============================================================ */

async function updateMedicationStatus(id, status) {
  const labels = {
    active: "reativar",
    paused: "pausar",
    completed: "concluir"
  };

  const message = {
    active: "Deseja reativar este medicamento?",
    paused: "Deseja pausar este medicamento?",
    completed: "Deseja marcar este tratamento como concluído?"
  };

  if (!confirm(message[status])) return;

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
    showMessage(`Medicamento atualizado: ${labels[status]}.`);

  } catch (error) {
    showMessage(error.message || "Não foi possível atualizar.", true);
  }
}

/* ============================================================
   LISTA GERAL E CONTADORES
   ============================================================ */

function updateCounters() {
  const active = medications.filter(item => item.status === "active");
  $("medicationCount").textContent = active.length;
}

function stockMessage(medication) {
  const stock = Number(medication.stock_quantity || 0);
  const schedules = schedulesByMedication[medication.id] || [];

  const dailyUse = schedules.reduce(
    (sum, schedule) => sum + Number(schedule.dose_quantity || 0),
    0
  );

  if (stock <= 0) {
    return `<span class="stock-empty">Estoque esgotado</span>`;
  }

  if (dailyUse <= 0) {
    return `Estoque: ${formatQuantity(stock)} ${escapeHTML(medication.stock_unit || "unidades")}`;
  }

  const days = Math.floor(stock / dailyUse);

  if (days <= Number(medication.stock_alert_days || 3)) {
    return `<span class="stock-warning">Estoque para aproximadamente ${days} dia(s)</span>`;
  }

  return `Estoque para aproximadamente ${days} dias`;
}

function renderMedications() {
  const container = $("medicationList");

  if (!medications.length) {
    container.innerHTML = `
      <div class="empty-state">
        Você ainda não cadastrou medicamentos.
      </div>`;
    return;
  }

  container.innerHTML = medications.map(medication => {
    const schedules = schedulesByMedication[medication.id] || [];

    const times = schedules
      .map(item => String(item.scheduled_time).slice(0, 5))
      .join(", ");

    let statusLabel = "Em uso";

    if (medication.status === "paused") statusLabel = "Pausado";
    if (medication.status === "completed") statusLabel = "Concluído";

    const stockText = stockMessage(medication);

    return `
      <article class="medication-item">
        <div class="medication-item-top">
          <div>
            <h3>${escapeHTML(medication.name)}</h3>
            <p class="medication-dose">${escapeHTML(medication.dose)}</p>
          </div>
          <span class="small-text">${statusLabel}</span>
        </div>

        <div class="medication-meta">
          <div>Horários: ${escapeHTML(times || "Não definidos")}</div>
          <div>${stockText}</div>
          ${medication.instructions
            ? `<div>Orientações: ${escapeHTML(medication.instructions)}</div>`
            : ""}
        </div>

        <div class="item-actions">
          ${medication.status !== "completed" ? `
            <button class="edit-button" data-action="edit" data-id="${medication.id}" type="button">Editar</button>
            <button data-action="restock" data-id="${medication.id}" type="button">Repor estoque</button>
          ` : ""}

          ${medication.status === "active" ? `
            <button class="pause-button" data-action="pause" data-id="${medication.id}" type="button">Pausar</button>
          ` : ""}

          ${medication.status === "paused" ? `
            <button class="edit-button" data-action="activate" data-id="${medication.id}" type="button">Reativar</button>
          ` : ""}

          ${medication.status !== "completed" ? `
            <button class="complete-button" data-action="complete" data-id="${medication.id}" type="button">Concluir</button>
          ` : ""}
        </div>
      </article>
    `;
  }).join("");
}

/* ============================================================
   EVENTOS
   ============================================================ */

function configureEvents() {
  $("loginForm").addEventListener("submit", handleLogin);
  $("registerForm").addEventListener("submit", handleRegister);
  $("recoveryForm").addEventListener("submit", handleRecovery);

  $("showRegisterButton").addEventListener("click", () => {
    showAuthPanel("registerPanel");
  });

  $("showRecoveryButton").addEventListener("click", () => {
    showAuthPanel("recoveryPanel");
  });

  $("backToLoginFromRegister").addEventListener("click", () => {
    showAuthPanel("loginPanel");
  });

  $("backToLoginFromRecovery").addEventListener("click", () => {
    showAuthPanel("loginPanel");
  });

  $("logoutButton").addEventListener("click", logout);

  $("newMedicationButton").addEventListener("click", openNewMedicationForm);

  $("cancelEditButton").addEventListener("click", closeMedicationForm);

  $("addScheduleButton").addEventListener("click", () => {
    addScheduleRow();
  });

  $("medicationForm").addEventListener("submit", saveMedication);

  $("todayMedicationList").addEventListener("click", event => {
    const button = event.target.closest("[data-action]");

    if (!button) return;

    const action = button.dataset.action;
    const id = button.dataset.id;
    const time = button.dataset.time;

    if (action === "today-taken") {
      markDoseTaken(id, time);
    }

    if (action === "today-not-taken") {
      markDoseNotTaken(id, time);
    }
  });

  $("medicationList").addEventListener("click", event => {
    const button = event.target.closest("[data-action]");

    if (!button) return;

    const action = button.dataset.action;
    const id = button.dataset.id;

    if (action === "edit") editMedication(id);
    if (action === "restock") restockMedication(id);
    if (action === "pause") updateMedicationStatus(id, "paused");
    if (action === "activate") updateMedicationStatus(id, "active");
    if (action === "complete") updateMedicationStatus(id, "completed");
  });
}

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */

async function initializeApp() {
  configureEvents();
  resetMedicationForm();

  const {
    data: { session },
    error
  } = await supabaseClient.auth.getSession();

  if (error) {
    showMessage(error.message, true);
    return;
  }

  if (session?.user) {
    await showApplication(session.user);
  } else {
    $("authSection").classList.remove("hidden");
    $("appSection").classList.add("hidden");
    $("logoutButton").classList.add("hidden");
    showAuthPanel("loginPanel");
  }

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN" && session?.user && !currentUser) {
      await showApplication(session.user);
    }

    if (event === "SIGNED_OUT") {
      currentUser = null;
      $("appSection").classList.add("hidden");
      $("authSection").classList.remove("hidden");
      $("logoutButton").classList.add("hidden");
    }

    if (event === "PASSWORD_RECOVERY") {
      showMessage("Acesse o link recebido por e-mail para redefinir sua senha.");
    }
  });
}

document.addEventListener("DOMContentLoaded", initializeApp);
