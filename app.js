/* ============================================================
   MEDIHORA
   Aplicativo de organização de medicamentos
   Supabase + GitHub Pages + OneSignal v16
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
let applicationPromise = null;
let applicationUserId = null;

let doseClockInterval = null;
let lastLoadedLocalDate = null;

let oneSignalListenersRegistered = false;

/* ============================================================
   ELEMENTOS HTML E FUNÇÕES AUXILIARES
   ============================================================ */

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

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
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

  const date = new Date(
    Date.UTC(year, month - 1, day + 1)
  );

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

  return new Date(year, month - 1, day).toLocaleDateString(
    "pt-BR",
    {
      day: "2-digit",
      month: "long",
      year: "numeric"
    }
  );
}

function formatQuantity(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    maximumFractionDigits: 2
  });
}

function cleanTime(value) {
  return String(value || "").slice(0, 5);
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

  if (status === "taken" || status === "not_taken") {
    return status;
  }

  const time = cleanTime(schedule.scheduled_time);

  if (!/^\d{2}:\d{2}$/.test(time)) {
    return "pending";
  }

  const [hour, minute] = time.split(":").map(Number);

  if (
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59
  ) {
    return "pending";
  }

  const nowParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    nowParts.map(part => [part.type, part.value])
  );

  const currentMinutes =
    Number(values.hour) * 60 +
    Number(values.minute);

  const scheduledMinutes =
    hour * 60 + minute;

  // A dose fica atrasada somente 30 minutos após o horário.
  const gracePeriod = 30;

  if (currentMinutes >= scheduledMinutes + gracePeriod) {
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
   ONESIGNAL — NOTIFICAÇÕES DO MEDIHORA
   ============================================================ */

/*
  O index.html já inicializa o OneSignal v16.

  Este arquivo NÃO chama OneSignal.init() novamente.
  Assim evitamos inicialização duplicada do SDK.
*/

function runOneSignal(callback, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];

    let completed = false;

    const timeout = setTimeout(() => {
      if (completed) return;

      completed = true;

      reject(
        new Error(
          "O OneSignal não respondeu. Recarregue a página e tente novamente."
        )
      );
    }, timeoutMs);

    window.OneSignalDeferred.push(async OneSignal => {
      if (completed) return;

      try {
        const result = await callback(OneSignal);

        if (completed) return;

        completed = true;
        clearTimeout(timeout);

        resolve(result);

      } catch (error) {
        if (completed) return;

        completed = true;
        clearTimeout(timeout);

        reject(error);
      }
    });
  });
}

/*
  Consulta a permissão e a inscrição efetiva do dispositivo.
*/

async function getOneSignalPushState() {
  return runOneSignal(async OneSignal => {
    const subscription = OneSignal.User?.PushSubscription;

    return {
      permission:
        OneSignal.Notifications.permission === true,

      optedIn:
        subscription?.optedIn === true,

      id:
        subscription?.id || null,

      token:
        subscription?.token || null
    };
  });
}

/*
  Aguarda a criação efetiva da inscrição Push.
  A permissão do navegador, sozinha, não significa
  que o dispositivo já esteja inscrito.
*/

async function waitForPushSubscription(
  OneSignal,
  timeoutMs = 12000
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const subscription = OneSignal.User?.PushSubscription;

    const state = {
      optedIn: subscription?.optedIn === true,
      id: subscription?.id || null,
      token: subscription?.token || null
    };

    if (state.optedIn && state.id && state.token) {
      return state;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const subscription = OneSignal.User?.PushSubscription;

  return {
    optedIn: subscription?.optedIn === true,
    id: subscription?.id || null,
    token: subscription?.token || null
  };
}

/*
  Atualiza o botão de notificações.
*/

async function updateNotificationButton() {
  const button = $("enableNotificationsButton");

  if (!button) return;

  try {
    const state = await getOneSignalPushState();

    if (
      state.permission &&
      state.optedIn &&
      state.id &&
      state.token
    ) {
      button.textContent = "🔔 Lembretes ativados";
      button.classList.add("notifications-enabled");

    } else if (state.permission) {
      button.textContent = "🔔 Finalizar ativação dos lembretes";
      button.classList.remove("notifications-enabled");

    } else {
      button.textContent = "🔔 Ativar lembretes no celular";
      button.classList.remove("notifications-enabled");
    }

  } catch (error) {
    console.warn(
      "Não foi possível consultar o estado das notificações:",
      error
    );

    button.textContent = "🔔 Ativar lembretes no celular";

  } finally {
    button.disabled = false;
  }
}

/*
  Registra os eventos do OneSignal apenas uma vez.
*/

async function registerOneSignalListeners(OneSignal) {
  if (oneSignalListenersRegistered) return;

  const pushSubscription =
    OneSignal.User?.PushSubscription;

  if (pushSubscription?.addEventListener) {
    pushSubscription.addEventListener("change", () => {
      updateNotificationButton();
    });
  }

  if (OneSignal.Notifications?.addEventListener) {
    OneSignal.Notifications.addEventListener(
      "permissionChange",
      () => {
        updateNotificationButton();
      }
    );
  }

  oneSignalListenersRegistered = true;
}

/*
  Vincula o usuário do Supabase ao OneSignal.
*/

async function connectOneSignalUser(userId) {
  if (!userId) return;

  try {
    await runOneSignal(async OneSignal => {
      await OneSignal.login(userId);
      await registerOneSignalListeners(OneSignal);
    });

    console.log("Conta vinculada ao OneSignal.");

    await updateNotificationButton();

  } catch (error) {
    console.error(
      "Erro ao vincular conta ao OneSignal:",
      error
    );
  }
}

/*
  Desvincula a conta atual do OneSignal.
*/

async function disconnectOneSignalUser() {
  try {
    await runOneSignal(async OneSignal => {
      await OneSignal.logout();
    });

    console.log("Conta desvinculada do OneSignal.");

  } catch (error) {
    console.warn(
      "Não foi possível desvincular o OneSignal:",
      error
    );
  }
}

/*
  Ativação das notificações.

  A inscrição somente será considerada concluída quando
  o OneSignal confirmar optedIn, id e token.
*/

async function enableMedicationNotifications() {
  if (!currentUser) {
    showMessage("Entre na sua conta primeiro.", true);
    return;
  }

  const button = $("enableNotificationsButton");

  if (button) {
    button.disabled = true;
    button.textContent = "Conectando ao serviço...";
  }

  try {
    const result = await runOneSignal(async OneSignal => {
      await OneSignal.login(currentUser.id);

      await registerOneSignalListeners(OneSignal);

      if (button) {
        button.textContent = "Solicitando permissão...";
      }

      if (OneSignal.Notifications.permission !== true) {
        await OneSignal.Notifications.requestPermission();
      }

      const permission =
        OneSignal.Notifications.permission === true;

      if (!permission) {
        return {
          permission: false,
          optedIn: false,
          id: null,
          token: null
        };
      }

      if (button) {
        button.textContent = "Registrando dispositivo...";
      }

      const pushSubscription =
        OneSignal.User?.PushSubscription;

      if (!pushSubscription) {
        throw new Error(
          "A inscrição Push não está disponível neste navegador."
        );
      }

      await pushSubscription.optIn();

      return {
        permission: true,
        ...(await waitForPushSubscription(OneSignal))
      };
    });

    if (!result.permission) {
      showMessage(
        "A permissão não foi concedida. Verifique as configurações de notificações do aparelho.",
        true
      );

      return;
    }

    if (result.optedIn && result.id && result.token) {
      showMessage(
        "Dispositivo inscrito! Os lembretes poderão ser enviados para este aparelho."
      );

      if (button) {
        button.textContent = "🔔 Lembretes ativados";
        button.classList.add("notifications-enabled");
      }

    } else {
      showMessage(
        "A permissão foi concedida, mas o OneSignal ainda não confirmou a inscrição. Aguarde e tente novamente.",
        true
      );

      if (button) {
        button.textContent = "🔔 Finalizar ativação dos lembretes";
        button.classList.remove("notifications-enabled");
      }
    }

  } catch (error) {
    console.error(
      "Erro ao ativar notificações:",
      error
    );

    showMessage(
      error.message ||
        "Não foi possível ativar as notificações neste dispositivo.",
      true
    );

    if (button) {
      button.textContent = "🔔 Tentar ativar novamente";
      button.classList.remove("notifications-enabled");
    }

  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

/* ============================================================
   AUTENTICAÇÃO — PAINÉIS
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

/* ============================================================
   CADASTRO DE CONTA
   ============================================================ */


async function handleRegister(event) {
  event.preventDefault();

  const name = $("registerName")?.value.trim() || "";
  const email = $("registerEmail")?.value.trim() || "";
  const password = $("registerPassword")?.value || "";

  if (!name || !email || !password) {
    showMessage("Preencha todos os campos do cadastro.", true);
    return;
  }

  const form = $("registerForm");
  const button = form?.querySelector('button[type="submit"]');

  if (button) {
    button.disabled = true;
    button.textContent = "Criando conta...";
  }

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

    // Verifica se o Supabase retornou uma conta já existente.
    if (
      data.user &&
      Array.isArray(data.user.identities) &&
      data.user.identities.length === 0
    ) {
      showMessage(
        "Este e-mail já possui cadastro. Tente entrar na sua conta.",
        true
      );

      showAuthPanel("loginPanel");
      return;
    }

    // Caso a confirmação de e-mail esteja desabilitada.
    if (data.session && data.user) {
      await showApplication(data.user);
      showMessage("Conta criada com sucesso!");
      return;
    }

    // Cadastro aguardando confirmação do e-mail.
    const toast = $("toast");

    showAuthPanel("loginPanel");

    if (toast) {
      toast.textContent =
        `Cadastro realizado! 💊 Enviamos um e-mail de confirmação para ${email}. Acesse sua caixa de entrada e clique no link para ativar sua conta. Se não encontrar, verifique também a pasta de spam.`;

      toast.classList.remove("error");
      toast.classList.add("show");

      clearTimeout(toastTimeout);

      toastTimeout = setTimeout(() => {
        toast.classList.remove("show");
      }, 12000);
    } else {
      showMessage(
        `Cadastro realizado! Confira o e-mail enviado para ${email}.`
      );
    }

  } catch (error) {
    console.error("Erro no cadastro:", error);

    showMessage(
      error.message || "Não foi possível criar a conta.",
      true
    );

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Criar conta";
    }
  }
}


/* ============================================================
   LOGIN
   ============================================================ */

async function handleLogin(event) {
  event.preventDefault();

  if (recoveryMode) {
    showMessage(
      "Conclua primeiro a alteração da sua senha.",
      true
    );
    return;
  }

  const email = $("loginEmail")?.value.trim() || "";
  const password = $("loginPassword")?.value || "";

  const form = $("loginForm");
  const button = form?.querySelector('button[type="submit"]');

  if (!email || !password) {
    showMessage(
      "Informe seu e-mail e sua senha.",
      true
    );
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Entrando...";
  }

  try {
    const { data, error } =
      await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

    if (error) throw error;

    let authenticatedUser =
      data?.user || data?.session?.user;

    if (!authenticatedUser) {
      const {
        data: sessionData,
        error: sessionError
      } = await supabaseClient.auth.getSession();

      if (sessionError) throw sessionError;

      authenticatedUser = sessionData.session?.user;
    }

    if (!authenticatedUser) {
      throw new Error(
        "O login foi realizado, mas não foi possível recuperar sua sessão."
      );
    }

    recoveryMode = false;

    await showApplication(authenticatedUser);

    showMessage("Bem-vindo(a) ao MediHora!");

  } catch (error) {
    console.error("Erro no login:", error);

    showMessage(
      error.message ||
        "Não foi possível entrar. Confira seu e-mail e sua senha.",
      true
    );

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Entrar";
    }
  }
}

/* ============================================================
   RECUPERAÇÃO DE SENHA
   ============================================================ */

async function handleRecovery(event) {
  event.preventDefault();

  const email = $("recoveryEmail")?.value.trim() || "";

  if (!email) {
    showMessage("Informe seu e-mail.", true);
    return;
  }

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
    console.error(
      "Erro ao solicitar recuperação:",
      error
    );

    showMessage(
      error.message || "Não foi possível enviar o link.",
      true
    );
  }
}

/* ============================================================
   ALTERAÇÃO DE SENHA
   ============================================================ */

function openPasswordResetScreen() {
  recoveryMode = true;
  currentUser = null;

  $("appSection")?.classList.add("hidden");
  $("authSection")?.classList.remove("hidden");
  $("logoutButton")?.classList.add("hidden");

  showAuthPanel("passwordResetPanel");

  if ($("newPassword")) {
    $("newPassword").value = "";
  }

  if ($("confirmNewPassword")) {
    $("confirmNewPassword").value = "";
  }

  setTimeout(() => $("newPassword")?.focus(), 100);
}

async function handlePasswordUpdate(event) {
  event.preventDefault();

  const password = $("newPassword")?.value || "";
  const confirmation = $("confirmNewPassword")?.value || "";

  if (password.length < 6) {
    showMessage(
      "A senha deve ter pelo menos 6 caracteres.",
      true
    );
    return;
  }

  if (password !== confirmation) {
    showMessage(
      "As senhas informadas são diferentes.",
      true
    );
    return;
  }

  const form = $("passwordResetForm");
  const button = form?.querySelector('button[type="submit"]');

  if (button) {
    button.disabled = true;
    button.textContent = "Salvando...";
  }

  try {
    const { error } =
      await supabaseClient.auth.updateUser({
        password
      });

    if (error) throw error;

    recoveryMode = false;

    await disconnectOneSignalUser();

    const { error: signOutError } =
      await supabaseClient.auth.signOut();

    if (signOutError) {
      console.warn(
        "Falha ao encerrar sessão após alterar senha:",
        signOutError
      );
    }

    if ($("newPassword")) $("newPassword").value = "";
    if ($("confirmNewPassword")) {
      $("confirmNewPassword").value = "";
    }

    showLoginScreen();

    showMessage(
      "Nova senha cadastrada! Entre com sua nova senha."
    );

  } catch (error) {
    console.error(
      "Erro ao atualizar senha:",
      error
    );

    showMessage(
      error.message ||
        "Não foi possível atualizar sua senha. Solicite um novo link.",
      true
    );

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Salvar nova senha";
    }
  }
}

/* ============================================================
   SESSÃO E ABERTURA DO APLICATIVO
   ============================================================ */

function getUserDisplayName(user) {
  return (
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Usuário"
  );
}

async function showApplication(user) {
  if (!user?.id) {
    showLoginScreen();
    return;
  }

  // Evita carregamentos simultâneos para a mesma conta.
  if (
    applicationLoading &&
    applicationUserId === user.id &&
    applicationPromise
  ) {
    return applicationPromise;
  }

  applicationLoading = true;
  applicationUserId = user.id;

  applicationPromise = (async () => {
    try {
      currentUser = user;

      $("authSection")?.classList.add("hidden");
      $("appSection")?.classList.remove("hidden");
      $("logoutButton")?.classList.remove("hidden");

      const userName = $("userName");

      if (userName) {
        userName.textContent = getUserDisplayName(user);
      }

      const todayDate = $("todayDate");

      if (todayDate) {
        todayDate.textContent = new Date().toLocaleDateString(
          "pt-BR",
          {
            timeZone: APP_TIMEZONE,
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric"
          }
        );
      }

      // Vincula a conta ao OneSignal sem bloquear a tela.
      connectOneSignalUser(user.id).catch(error => {
        console.warn("OneSignal:", error);
      });

      await loadMedications();

      if (currentUser?.id !== user.id) return;

      await renderTodayMedications();
      renderMedications();

      startDoseClock();

      lastLoadedLocalDate = todayLocalDate();

    } catch (error) {
      console.error(
        "Erro ao abrir o aplicativo:",
        error
      );

      showMessage(
        "Não foi possível carregar todos os dados. Tente atualizar a página.",
        true
      );

    } finally {
      applicationLoading = false;
      applicationPromise = null;
    }
  })();

  return applicationPromise;
}

/* ============================================================
   ENCERRAR SESSÃO
   ============================================================ */

async function logout() {
  const confirmed = window.confirm(
    "Deseja realmente sair da sua conta?"
  );

  if (!confirmed) return;

  const previousUserId = currentUser?.id;

  try {
    stopDoseClock();

    // Evita manter dados de uma conta na tela após o logout.
    currentUser = null;
    medications = [];
    schedulesByMedication = {};

    applicationUserId = null;

    $("appSection")?.classList.add("hidden");
    $("authSection")?.classList.remove("hidden");

    await disconnectOneSignalUser();

    const { error } = await supabaseClient.auth.signOut();

    if (error) throw error;

    showLoginScreen();

    showMessage("Você saiu da sua conta.");

  } catch (error) {
    console.error("Erro ao sair:", error);

    // Não restaura os dados anteriores na interface.
    currentUser = null;
    medications = [];
    schedulesByMedication = {};

    showLoginScreen();

    showMessage(
      "A sessão foi encerrada localmente. Atualize a página se necessário.",
      true
    );
  }
}

/* ============================================================
   FORMULÁRIO DE MEDICAMENTOS
   ============================================================ */

function getScheduleRows() {
  const container = $("scheduleList");

  if (!container) return [];

  return Array.from(
    container.querySelectorAll(
      ".schedule-row, .schedule-item, [data-schedule-row]"
    )
  );
}

function getScheduleRowValues(row) {
  const timeInput = row.querySelector(
    'input[type="time"], input[name*="time"], .schedule-time'
  );

  const quantityInput = row.querySelector(
    'input[name*="quantity"], input[name*="dose"], .schedule-quantity, input[type="number"]'
  );

  return {
    time: cleanTime(timeInput?.value || ""),
    quantity: Number(quantityInput?.value || 1)
  };
}

function addScheduleRow(time = "", quantity = 1) {
  const container = $("scheduleList");

  if (!container) {
    console.warn("Elemento scheduleList não encontrado.");
    return;
  }

  const row = document.createElement("div");

  row.className = "schedule-row";
  row.dataset.scheduleRow = "true";

  row.innerHTML = `
    <div class="schedule-field">
      <label>Horário</label>
      <input
        type="time"
        class="schedule-time"
        value="${escapeHTML(time)}"
        required
      >
    </div>

    <div class="schedule-field">
      <label>Quantidade por dose</label>
      <input
        type="number"
        class="schedule-quantity"
        min="0.01"
        step="0.01"
        value="${escapeHTML(quantity)}"
        required
      >
    </div>

    <button
      type="button"
      class="remove-schedule-button"
      aria-label="Remover horário"
      title="Remover horário"
    >
      ✕
    </button>
  `;

  row.querySelector(".remove-schedule-button")
    ?.addEventListener("click", () => {
      if (getScheduleRows().length <= 1) {
        showMessage(
          "Mantenha pelo menos um horário cadastrado.",
          true
        );
        return;
      }

      row.remove();
    });

  container.appendChild(row);
}

function resetMedicationForm() {
  const form = $("medicationForm");

  if (form) form.reset();

  editingMedicationId = null;

  if ($("medicationId")) {
    $("medicationId").value = "";
  }

  const title = $("formTitle");

  if (title) {
    title.textContent = "Novo medicamento";
  }

  const saveButton = $("saveMedicationButton");

  if (saveButton) {
    saveButton.textContent = "Salvar medicamento";
    saveButton.disabled = false;
  }

  $("cancelEditButton")?.classList.add("hidden");

  const scheduleList = $("scheduleList");

  if (scheduleList) {
    scheduleList.innerHTML = "";
  }

  addScheduleRow();

  // O alerta de estoque é opcional no HTML.
  const stockAlert = $("medicationStockAlert");

  if (stockAlert) {
    stockAlert.value = "3";
  }
}

function openNewMedicationForm() {
  resetMedicationForm();

  $("medicationPanel")?.classList.remove("hidden");

  $("formTitle")?.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  $("medicationName")?.focus();
}

function closeMedicationForm() {
  $("medicationPanel")?.classList.add("hidden");
  resetMedicationForm();
}

function getMedicationFormData() {
  const name = getValue("medicationName").trim();
  const dose = getValue("medicationDose").trim();
  const unit = getValue("medicationUnit").trim();

  const stock = Number(getValue("medicationStock") || 0);

  const startDate = getValue("medicationStartDate");
  const prescribedDays = Number(
    getValue("medicationDays") || 0
  );

  const instructions =
    getValue("medicationInstructions").trim();

  const stockAlertInput = $("medicationStockAlert");

  const stockAlertDays = stockAlertInput
    ? Number(stockAlertInput.value || 3)
    : 3;

  const schedules = getScheduleRows().map(
    getScheduleRowValues
  );

  return {
    name,
    dose,
    unit,
    stock,
    startDate,
    prescribedDays,
    instructions,
    stockAlertDays,
    schedules
  };
}

function validateMedicationData(data) {
  if (!data.name) {
    return "Informe o nome do medicamento.";
  }

  if (!data.dose) {
    return "Informe a dosagem do medicamento.";
  }

  if (!data.unit) {
    return "Informe a unidade do medicamento.";
  }

  if (!Number.isFinite(data.stock) || data.stock < 0) {
    return "Informe uma quantidade de estoque válida.";
  }

  if (!data.startDate) {
    return "Informe a data de início do tratamento.";
  }

  if (
    !Number.isInteger(data.prescribedDays) ||
    data.prescribedDays < 0
  ) {
    return "Informe uma duração válida para o tratamento.";
  }

  if (
    !Number.isFinite(data.stockAlertDays) ||
    data.stockAlertDays < 0
  ) {
    return "Informe um alerta de estoque válido.";
  }

  if (!data.schedules.length) {
    return "Cadastre pelo menos um horário.";
  }

  const usedTimes = new Set();

  for (const schedule of data.schedules) {
    if (!/^\d{2}:\d{2}$/.test(schedule.time)) {
      return "Informe todos os horários corretamente.";
    }

    if (
      !Number.isFinite(schedule.quantity) ||
      schedule.quantity <= 0
    ) {
      return "A quantidade por dose deve ser maior que zero.";
    }

    if (usedTimes.has(schedule.time)) {
      return `O horário ${schedule.time} está repetido.`;
    }

    usedTimes.add(schedule.time);
  }

  return null;
}

/* ============================================================
   CARREGAR MEDICAMENTO PARA EDIÇÃO
   ============================================================ */

function editMedication(medicationId) {
  const medication = medications.find(
    item => item.id === medicationId
  );

  if (!medication) {
    showMessage(
      "Medicamento não encontrado.",
      true
    );
    return;
  }

  editingMedicationId = medication.id;

  $("medicationId").value = medication.id;
  $("medicationName").value = medication.name || "";
  $("medicationDose").value = medication.dose || "";
  $("medicationUnit").value = medication.stock_unit || "";
  $("medicationStock").value =
    medication.stock_quantity ?? 0;

  $("medicationStartDate").value =
    medication.start_date || todayLocalDate();

  $("medicationDays").value =
    medication.prescribed_days ?? "";

  $("medicationInstructions").value =
    medication.instructions || "";

  if ($("medicationStockAlert")) {
    $("medicationStockAlert").value =
      medication.stock_alert_days ?? 3;
  }

  const title = $("formTitle");

  if (title) {
    title.textContent = "Editar medicamento";
  }

  const saveButton = $("saveMedicationButton");

  if (saveButton) {
    saveButton.textContent = "Salvar alterações";
  }

  $("cancelEditButton")?.classList.remove("hidden");

  const scheduleList = $("scheduleList");

  if (scheduleList) {
    scheduleList.innerHTML = "";
  }

  const schedules =
    schedulesByMedication[medication.id] || [];

  if (schedules.length) {
    schedules.forEach(schedule => {
      addScheduleRow(
        cleanTime(schedule.scheduled_time),
        schedule.dose_quantity ?? 1
      );
    });
  } else {
    addScheduleRow();
  }

  $("medicationPanel")?.classList.remove("hidden");

  $("medicationPanel")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

/* ============================================================
   SALVAR MEDICAMENTO
   ============================================================ */

async function saveMedication(event) {
  event.preventDefault();

  if (!currentUser) {
    showMessage("Entre na sua conta novamente.", true);
    return;
  }

  if (savingMedication) return;

  const data = getMedicationFormData();
const wasEditing = Boolean(editingMedicationId);
  const validationError =
    validateMedicationData(data);

  if (validationError) {
    showMessage(validationError, true);
    return;
  }

  const button = $("saveMedicationButton");

  savingMedication = true;

  if (button) {
    button.disabled = true;
    button.textContent = editingMedicationId
      ? "Salvando alterações..."
      : "Salvando...";
  }

  try {
    const medicationPayload = {
      user_id: currentUser.id,
      name: data.name,
      dose: data.dose,
      stock_unit: data.unit,
      stock_quantity: data.stock,
      start_date: data.startDate,
      prescribed_days: data.prescribedDays || null,
      instructions: data.instructions || null,
      stock_alert_days: data.stockAlertDays
    };

    let medicationId = editingMedicationId;

    if (medicationId) {
      const { data: updatedMedication, error } =
        await supabaseClient
          .from("medications")
          .update(medicationPayload)
          .eq("id", medicationId)
          .eq("user_id", currentUser.id)
          .select("id")
          .single();

      if (error) throw error;

      medicationId = updatedMedication.id;

    } else {
      const { data: newMedication, error } =
        await supabaseClient
          .from("medications")
          .insert(medicationPayload)
          .select("id")
          .single();

      if (error) throw error;

      medicationId = newMedication.id;
    }

    await saveMedicationSchedules(
      medicationId,
      data.schedules
    );

    closeMedicationForm();

    await loadMedications();

    await renderTodayMedications();
    renderMedications();

    showMessage(
  wasEditing
    ? "Medicamento atualizado com sucesso!"
    : "Medicamento cadastrado com sucesso!"
);

  } catch (error) {
    console.error(
      "Erro ao salvar medicamento:",
      error
    );

    showMessage(
      error.message ||
        "Não foi possível salvar o medicamento.",
      true
    );

  } finally {
    savingMedication = false;

    if (button) {
      button.disabled = false;
      button.textContent = "Salvar medicamento";
    }
  }
}

/* ============================================================
   SALVAR HORÁRIOS DO MEDICAMENTO
   ============================================================ */

async function saveMedicationSchedules(
  medicationId,
  schedules
) {
  if (!currentUser) {
    throw new Error("Sessão não encontrada.");
  }

  const { data: existingSchedules, error: selectError } =
    await supabaseClient
      .from("medication_schedules")
      .select("id, scheduled_time, dose_quantity, enabled")
      .eq("medication_id", medicationId)
      .eq("user_id", currentUser.id);

  if (selectError) throw selectError;

  const existing = existingSchedules || [];

  const unusedExisting = [...existing];

  for (const schedule of schedules) {
    const matchingIndex = unusedExisting.findIndex(item =>
      cleanTime(item.scheduled_time) === schedule.time
    );

    if (matchingIndex >= 0) {
      const matching = unusedExisting.splice(
        matchingIndex,
        1
      )[0];

      const { error } = await supabaseClient
        .from("medication_schedules")
        .update({
          dose_quantity: schedule.quantity,
          enabled: true
        })
        .eq("id", matching.id)
        .eq("user_id", currentUser.id);

      if (error) throw error;

    } else {
      const { error } = await supabaseClient
        .from("medication_schedules")
        .insert({
          user_id: currentUser.id,
          medication_id: medicationId,
          scheduled_time: schedule.time,
          dose_quantity: schedule.quantity,
          enabled: true
        });

      if (error) throw error;
    }
  }

  /*
    Horários removidos são desativados, não excluídos.
    Isso preserva os registros históricos de doses.
  */

  for (const removedSchedule of unusedExisting) {
    const { error } = await supabaseClient
      .from("medication_schedules")
      .update({
        enabled: false
      })
      .eq("id", removedSchedule.id)
      .eq("user_id", currentUser.id);

    if (error) throw error;
  }
}

/* ============================================================
   CARREGAMENTO DOS MEDICAMENTOS E HORÁRIOS
   ============================================================ */

async function loadMedications() {
  if (!currentUser) {
    medications = [];
    schedulesByMedication = {};
    return;
  }

  const userId = currentUser.id;

  try {
    const { data: medicationData, error: medicationError } =
      await supabaseClient
        .from("medications")
        .select("*")
        .eq("user_id", userId)
        .order("name", { ascending: true });

    if (medicationError) throw medicationError;

    if (currentUser?.id !== userId) return;

    const { data: scheduleData, error: scheduleError } =
      await supabaseClient
        .from("medication_schedules")
        .select("*")
        .eq("user_id", userId)
        .eq("enabled", true)
        .order("scheduled_time", { ascending: true });

    if (scheduleError) throw scheduleError;

    if (currentUser?.id !== userId) return;

    medications = medicationData || [];

    schedulesByMedication = {};

    for (const schedule of scheduleData || []) {
      if (!schedulesByMedication[schedule.medication_id]) {
        schedulesByMedication[schedule.medication_id] = [];
      }

      schedulesByMedication[schedule.medication_id].push({
        ...schedule,
        doseStatus: "pending"
      });
    }

    // Carrega o histórico de doses do dia.
    const bounds = localDayBounds();

    const { data: doseLogs, error: doseError } =
      await supabaseClient
        .from("dose_logs")
        .select("schedule_id, status, scheduled_for")
        .eq("user_id", userId)
        .gte("scheduled_for", bounds.start)
        .lt("scheduled_for", bounds.end)
        .order("scheduled_for", { ascending: false });

    if (doseError) throw doseError;

    if (currentUser?.id !== userId) return;

    /*
      A identificação utiliza horário e ID do horário cadastrado.
      Assim, uma dose registrada em outro horário não altera
      indevidamente a situação de uma dose diferente.
    */

    const logMap = new Map();

    for (const log of doseLogs || []) {
      const key = `${log.schedule_id}|${new Date(
        log.scheduled_for
      ).getTime()}`;

      if (!logMap.has(key)) {
        logMap.set(key, log.status);
      }
    }

    for (const medicationSchedules of Object.values(
      schedulesByMedication
    )) {
      for (const schedule of medicationSchedules) {
        const scheduledFor = localScheduleTimestamp(
          todayLocalDate(),
          schedule.scheduled_time
        );

        const key = `${schedule.id}|${new Date(
          scheduledFor
        ).getTime()}`;

        schedule.doseStatus = logMap.get(key) || "pending";
      }
    }

    return medications;

  } catch (error) {
    console.error(
      "Erro ao carregar medicamentos:",
      error
    );

    showMessage(
      error.message ||
        "Não foi possível carregar os medicamentos.",
      true
    );

    throw error;
  }
}

/* ============================================================
   VERIFICAR SE O MEDICAMENTO ESTÁ ATIVO HOJE
   ============================================================ */

function isMedicationScheduledToday(medication) {
  if (!medication) return false;

  if (
    medication.status &&
    medication.status !== "active"
  ) {
    return false;
  }

  const today = todayLocalDate();

  if (
    medication.start_date &&
    today < medication.start_date
  ) {
    return false;
  }

  const days = Number(medication.prescribed_days || 0);

  if (days > 0 && medication.start_date) {
    const start = new Date(
      `${medication.start_date}T00:00:00`
    );

    const current = new Date(`${today}T00:00:00`);

    const elapsed = Math.floor(
      (current.getTime() - start.getTime()) /
      86400000
    );

    if (elapsed >= days) {
      return false;
    }
  }

  return true;
}

/* ============================================================
   CÁLCULO DE CONSUMO DIÁRIO
   ============================================================ */

function getDailyMedicationConsumption(medication) {
  const schedules =
    schedulesByMedication[medication.id] || [];

  return schedules.reduce((total, schedule) => {
    return total + Number(schedule.dose_quantity || 0);
  }, 0);
}

/* ============================================================
   SITUAÇÃO DO ESTOQUE
   ============================================================ */

function getStockInformation(medication) {
  const stock = Number(medication.stock_quantity || 0);

  const dailyConsumption =
    getDailyMedicationConsumption(medication);

  const estimatedDays = dailyConsumption > 0
    ? stock / dailyConsumption
    : null;

  const alertDays = Number(
    medication.stock_alert_days ?? 3
  );

  let level = "normal";
  let message = "Estoque disponível";

  if (stock <= 0) {
    level = "empty";
    message = "Estoque esgotado";

  } else if (
    estimatedDays !== null &&
    estimatedDays <= alertDays
  ) {
    level = "low";
    message = "Estoque baixo";
  }

  return {
    stock,
    dailyConsumption,
    estimatedDays,
    alertDays,
    level,
    message
  };
}

function stockMessage(medication) {
  const info = getStockInformation(medication);

  if (info.level === "empty") {
    return "⚠️ Estoque esgotado";
  }

  if (info.estimatedDays === null) {
    return `${formatQuantity(info.stock)} ${escapeHTML(
      medication.stock_unit || ""
    )} disponíveis`;
  }

  return (
    `${formatQuantity(info.stock)} ` +
    `${escapeHTML(medication.stock_unit || "")} disponíveis · ` +
    `aproximadamente ${formatQuantity(info.estimatedDays)} dias`
  );
}

/* ============================================================
   ABRIR FORMULÁRIO DE REPOSIÇÃO
   ============================================================ */

function openRestockForm(medicationId) {
  const medication = medications.find(
    item => item.id === medicationId
  );

  if (!medication) {
    showMessage(
      "Medicamento não encontrado.",
      true
    );
    return;
  }

  restockMedicationId = medication.id;

  const title = $("restockTitle");

  if (title) {
    title.textContent = "Repor estoque";
  }

  const name = $("restockMedicationName");

  if (name) {
    name.textContent = medication.name;
  }

  if ($("restockQuantity")) {
    $("restockQuantity").value = "";
    $("restockQuantity").min = "0.01";
  }

  if ($("restockNote")) {
    $("restockNote").value = "";
  }

  $("restockPanel")?.classList.remove("hidden");

  $("restockPanel")?.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  $("restockQuantity")?.focus();
}

function closeRestockForm() {
  $("restockPanel")?.classList.add("hidden");

  $("restockForm")?.reset();

  restockMedicationId = null;

  const button = $("saveRestockButton");

  if (button) {
    button.disabled = false;
    button.textContent = "Salvar reposição";
  }
}

/* ============================================================
   SALVAR REPOSIÇÃO DE ESTOQUE
   ============================================================ */

async function saveRestock(event) {
  event.preventDefault();

  if (!currentUser) {
    showMessage("Entre na sua conta novamente.", true);
    return;
  }

  if (savingRestock) return;

  const medicationId = restockMedicationId;

  if (!medicationId) {
    showMessage(
      "Selecione um medicamento para repor.",
      true
    );
    return;
  }

  const quantity = Number(
    $("restockQuantity")?.value || 0
  );

  const note = $("restockNote")?.value.trim() || "";

  if (!Number.isFinite(quantity) || quantity <= 0) {
    showMessage(
      "Informe uma quantidade válida para a reposição.",
      true
    );
    return;
  }

  const button = $("saveRestockButton");

  savingRestock = true;

  if (button) {
    button.disabled = true;
    button.textContent = "Registrando reposição...";
  }

  try {
    /*
      A função RPC atualiza o estoque no servidor.
      Não fazemos atualização direta no navegador.
    */

    const { error } = await supabaseClient.rpc(
      "restock_medication",
      {
        p_medication_id: medicationId,
        p_quantity: quantity,
        p_note: note
      }
    );

    if (error) throw error;

    closeRestockForm();

    await loadMedications();

    await renderTodayMedications();
    renderMedications();

    showMessage(
      "Reposição de estoque registrada com sucesso!"
    );

  } catch (error) {
    console.error(
      "Erro ao repor estoque:",
      error
    );

    showMessage(
      error.message ||
        "Não foi possível registrar a reposição.",
      true
    );

  } finally {
    savingRestock = false;

    if (button) {
      button.disabled = false;
      button.textContent = "Salvar reposição";
    }
  }
}

/* ============================================================
   LISTA DE DOSES DO DIA
   ============================================================ */

function getTodayDoseItems() {
  const items = [];

  for (const medication of medications) {
    if (!isMedicationScheduledToday(medication)) {
      continue;
    }

    const schedules =
      schedulesByMedication[medication.id] || [];

    for (const schedule of schedules) {
      items.push({
        medication,
        schedule,
        time: cleanTime(schedule.scheduled_time),
        quantity: Number(schedule.dose_quantity || 1)
      });
    }
  }

  items.sort((a, b) => a.time.localeCompare(b.time));

  return items;
}

/* ============================================================
   RESUMO DAS DOSES DO DIA
   ============================================================ */


function updateTodaySummary(items) {
  const counts = {
    taken: 0,
    not_taken: 0,
    pending: 0,
    overdue: 0
  };

  for (const item of items) {
    const status = getDoseDisplayStatus(item.schedule);

    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status]++;
    }
  }

  const summary = $("todayMedicationSummary");

  if (!summary) return;

  summary.innerHTML = `
    <div class="summary-item summary-taken">
      <strong>${counts.taken}</strong>
      <span>Tomadas</span>
    </div>

    <div class="summary-item summary-pending">
      <strong>${counts.pending}</strong>
      <span>Pendentes</span>
    </div>

    <div class="summary-item summary-overdue">
      <strong>${counts.overdue}</strong>
      <span>Atrasadas</span>
    </div>

    <div class="summary-item summary-not-taken">
      <strong>${counts.not_taken}</strong>
      <span>Não tomadas</span>
    </div>
  `;
}


/* ============================================================
   RENDERIZAR DOSES DO DIA
   ============================================================ */


async function renderTodayMedications() {
  const container = $("todayMedicationList");

  if (!container) return;

  if (!currentUser) {
    container.innerHTML = "";
    return;
  }

  // Recupera todas as doses programadas para hoje.
  const items = getTodayDoseItems();

  // O resumo considera todas as doses, inclusive as registradas.
  updateTodaySummary(items);

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💊</div>
        <h3>Nenhum medicamento programado</h3>
        <p>
          Seus medicamentos e horários cadastrados
          aparecerão aqui.
        </p>
      </div>
    `;

    return;
  }

  /*
    Remove da lista visual as doses que já foram registradas.
    Os registros continuam preservados no Supabase.
  */
  const pendingItems = items.filter(item => {
    const status = getDoseDisplayStatus(item.schedule);

    return status !== "taken" && status !== "not_taken";
  });

  if (!pendingItems.length) {
    container.innerHTML = `
      <div class="empty-state doses-completed">
        <div class="empty-state-icon">🎉</div>
        <h3>Todas as doses foram registradas!</h3>
        <p>
          Você já registrou todas as doses programadas
          para hoje. Seu acompanhamento está atualizado.
        </p>
      </div>
    `;

    return;
  }

  container.innerHTML = pendingItems.map(item => {
    const medication = item.medication;
    const schedule = item.schedule;

    const status = getDoseDisplayStatus(schedule);

    const statusText = {
      overdue: "Dose atrasada",
      pending: "Aguardando horário"
    }[status];

    const statusClass = {
      overdue: "overdue",
      pending: "pending"
    }[status];

    return `
      <article
        class="today-medication-card ${statusClass}"
        data-schedule-id="${escapeHTML(schedule.id)}"
      >
        <div class="today-medication-header">
          <div>
            <span class="today-medication-time">
              ${periodEmoji(item.time)}
              ${escapeHTML(item.time)}
            </span>

            <h3>${escapeHTML(medication.name)}</h3>

            <p>
              ${escapeHTML(medication.dose || "")}
            </p>
          </div>

          <span class="dose-status ${statusClass}">
            ${statusEmoji(status)}
            ${statusText}
          </span>
        </div>

        <div class="today-medication-details">
          <span>
            Quantidade:
            ${formatQuantity(item.quantity)}
            ${escapeHTML(medication.stock_unit || "")}
          </span>

          <span>
            Estoque:
            ${formatQuantity(medication.stock_quantity || 0)}
            ${escapeHTML(medication.stock_unit || "")}
          </span>
        </div>

        ${
          medication.instructions
            ? `
              <p class="medication-instructions">
                ${escapeHTML(medication.instructions)}
              </p>
            `
            : ""
        }

        <div class="dose-actions">
          <button
            type="button"
            class="today-taken"
            data-action="take-dose"
            data-schedule-id="${escapeHTML(schedule.id)}"
            data-time="${escapeHTML(item.time)}"
          >
            ✓ Tomei
          </button>

          <button
            type="button"
            class="today-not-taken"
            data-action="skip-dose"
            data-schedule-id="${escapeHTML(schedule.id)}"
            data-time="${escapeHTML(item.time)}"
          >
            ✕ Não tomei
          </button>
        </div>
      </article>
    `;
  }).join("");
}


/* ============================================================
   LOCALIZAR HORÁRIO CADASTRADO
   ============================================================ */

function findSchedule(scheduleId) {
  for (const medicationSchedules of Object.values(
    schedulesByMedication
  )) {
    const schedule = medicationSchedules.find(
      item => item.id === scheduleId
    );

    if (schedule) return schedule;
  }

  return null;
}

/* ============================================================
   REGISTRAR DOSE TOMADA
   ============================================================ */

async function markDoseTaken(scheduleId, time) {
  if (!currentUser) {
    showMessage("Entre na sua conta novamente.", true);
    return;
  }

  const schedule = findSchedule(scheduleId);

  if (!schedule) {
    showMessage(
      "Horário de medicamento não encontrado.",
      true
    );
    return;
  }

  const scheduledFor = localScheduleTimestamp(
    todayLocalDate(),
    time || schedule.scheduled_time
  );

  const card = document.querySelector(
    `.today-medication-card[data-schedule-id="${CSS.escape(
      String(scheduleId)
    )}"]`
  );

  const buttons = card?.querySelectorAll("button");

  buttons?.forEach(button => {
    button.disabled = true;
  });

  try {
    /*
      A baixa do estoque é feita pela função RPC.
      Não subtraia estoque diretamente neste arquivo.
    */

    const { error } = await supabaseClient.rpc(
      "mark_dose_taken",
      {
        p_schedule_id: scheduleId,
        p_scheduled_for: scheduledFor
      }
    );

    if (error) throw error;

    await loadMedications();

    await renderTodayMedications();
    renderMedications();

    showMessage("Dose registrada como tomada!");

  } catch (error) {
    console.error(
      "Erro ao registrar dose tomada:",
      error
    );

    showMessage(
      error.message ||
        "Não foi possível registrar a dose.",
      true
    );

    buttons?.forEach(button => {
      button.disabled = false;
    });
  }
}

/* ============================================================
   REGISTRAR DOSE NÃO TOMADA
   ============================================================ */

async function markDoseNotTaken(scheduleId, time) {
  if (!currentUser) {
    showMessage("Entre na sua conta novamente.", true);
    return;
  }

  const schedule = findSchedule(scheduleId);

  if (!schedule) {
    showMessage(
      "Horário de medicamento não encontrado.",
      true
    );
    return;
  }

  const scheduledFor = localScheduleTimestamp(
    todayLocalDate(),
    time || schedule.scheduled_time
  );

  const card = document.querySelector(
    `.today-medication-card[data-schedule-id="${CSS.escape(
      String(scheduleId)
    )}"]`
  );

  const buttons = card?.querySelectorAll("button");

  buttons?.forEach(button => {
    button.disabled = true;
  });

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

    await renderTodayMedications();
    renderMedications();

    showMessage("Dose registrada como não tomada.");

  } catch (error) {
    console.error(
      "Erro ao registrar dose não tomada:",
      error
    );

    showMessage(
      error.message ||
        "Não foi possível registrar a dose.",
      true
    );

    buttons?.forEach(button => {
      button.disabled = false;
    });
  }
}

/* ============================================================
   ALTERAR SITUAÇÃO DO MEDICAMENTO
   ============================================================ */

async function updateMedicationStatus(medicationId, newStatus) {
  if (!currentUser) {
    showMessage("Entre na sua conta novamente.", true);
    return;
  }

  const allowedStatuses = [
    "active",
    "paused",
    "completed"
  ];

  if (!allowedStatuses.includes(newStatus)) {
    showMessage("Situação inválida.", true);
    return;
  }

  const medication = medications.find(
    item => item.id === medicationId
  );

  if (!medication) {
    showMessage("Medicamento não encontrado.", true);
    return;
  }

  const statusLabels = {
    active: "reativar",
    paused: "pausar",
    completed: "finalizar"
  };

  const confirmed = window.confirm(
    `Deseja ${statusLabels[newStatus]} o tratamento de "${medication.name}"?`
  );

  if (!confirmed) return;

  try {
    const { error } = await supabaseClient
      .from("medications")
      .update({
        status: newStatus
      })
      .eq("id", medicationId)
      .eq("user_id", currentUser.id);

    if (error) throw error;

    await loadMedications();

    await renderTodayMedications();
    renderMedications();

    const messages = {
      active: "Tratamento reativado.",
      paused: "Tratamento pausado.",
      completed: "Tratamento finalizado."
    };

    showMessage(messages[newStatus]);

  } catch (error) {
    console.error(
      "Erro ao alterar situação:",
      error
    );

    showMessage(
      error.message ||
        "Não foi possível alterar a situação do medicamento.",
      true
    );
  }
}

/* ============================================================
   RENDERIZAR LISTA DE MEDICAMENTOS CADASTRADOS
   ============================================================ */

function renderMedications() {
  const container = $("medicationList");

  if (!container) return;

  const count = $("medicationCount");

  if (count) {
    count.textContent = String(medications.length);
  }

  if (!medications.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💊</div>
        <h3>Nenhum medicamento cadastrado</h3>
        <p>
          Cadastre seu primeiro medicamento para
          organizar seus horários e acompanhar seu estoque.
        </p>
      </div>
    `;

    return;
  }

  container.innerHTML = medications.map(medication => {
    const schedules =
      schedulesByMedication[medication.id] || [];

    const stock = getStockInformation(medication);

    const status = medication.status || "active";

    const statusLabels = {
      active: "Em tratamento",
      paused: "Pausado",
      completed: "Finalizado"
    };

    const statusClass = {
      active: "active",
      paused: "paused",
      completed: "completed"
    };

    const scheduleHTML = schedules.length
      ? schedules.map(schedule => `
          <span class="medication-schedule-tag">
            ${periodEmoji(schedule.scheduled_time)}
            ${escapeHTML(cleanTime(schedule.scheduled_time))}
            · ${formatQuantity(schedule.dose_quantity)}
          </span>
        `).join("")
      : `
          <span class="medication-schedule-tag">
            Nenhum horário ativo
          </span>
        `;

    return `
      <article
        class="medication-card"
        data-medication-id="${escapeHTML(medication.id)}"
      >
        <div class="medication-card-header">
          <div class="medication-card-title">
            <h3>${escapeHTML(medication.name)}</h3>

            <span class="medication-status ${statusClass[status] || "active"}">
              ${statusLabels[status] || "Em tratamento"}
            </span>
          </div>
        </div>

        <div class="medication-card-details">
          <p>
            <strong>Dosagem:</strong>
            ${escapeHTML(medication.dose || "Não informada")}
          </p>

          <p>
            <strong>Estoque:</strong>
            ${formatQuantity(stock.stock)}
            ${escapeHTML(medication.stock_unit || "")}
          </p>

          <p>
            <strong>Início:</strong>
            ${formatDate(medication.start_date)}
          </p>

          ${
            Number(medication.prescribed_days || 0) > 0
              ? `
                <p>
                  <strong>Duração:</strong>
                  ${escapeHTML(medication.prescribed_days)} dias
                </p>
              `
              : ""
          }

          <p class="stock-information ${stock.level}">
            ${stock.level === "empty" ? "⚠️" : stock.level === "low" ? "🟡" : "🟢"}
            ${stockMessage(medication)}
          </p>

          ${
            medication.instructions
              ? `
                <p>
                  <strong>Orientações:</strong>
                  ${escapeHTML(medication.instructions)}
                </p>
              `
              : ""
          }
        </div>

        <div class="medication-schedules">
          <strong>Horários:</strong>
          <div class="medication-schedule-list">
            ${scheduleHTML}
          </div>
        </div>

        <div class="medication-card-actions">
          <button
            type="button"
            data-action="edit"
            data-id="${escapeHTML(medication.id)}"
          >
            ✏️ Editar
          </button>

          <button
            type="button"
            data-action="restock"
            data-id="${escapeHTML(medication.id)}"
          >
            📦 Repor estoque
          </button>

          ${
            status === "active"
              ? `
                <button
                  type="button"
                  data-action="pause"
                  data-id="${escapeHTML(medication.id)}"
                >
                  ⏸ Pausar
                </button>

                <button
                  type="button"
                  data-action="complete"
                  data-id="${escapeHTML(medication.id)}"
                >
                  ✓ Finalizar
                </button>
              `
              : status === "paused"
                ? `
                  <button
                    type="button"
                    data-action="activate"
                    data-id="${escapeHTML(medication.id)}"
                  >
                    ▶ Reativar
                  </button>

                  <button
                    type="button"
                    data-action="complete"
                    data-id="${escapeHTML(medication.id)}"
                  >
                    ✓ Finalizar
                  </button>
                `
                : `
                  <button
                    type="button"
                    data-action="activate"
                    data-id="${escapeHTML(medication.id)}"
                  >
                    ▶ Reativar
                  </button>
                `
          }
        </div>
      </article>
    `;
  }).join("");
}

/* ============================================================
   CLIQUES NAS AÇÕES DOS MEDICAMENTOS
   ============================================================ */

function handleMedicationListClick(event) {
  const button = event.target.closest("[data-action]");

  if (!button) return;

  const action = button.dataset.action;
  const medicationId = button.dataset.id;

  if (!medicationId) return;

  switch (action) {
    case "edit":
      editMedication(medicationId);
      break;

    case "restock":
      openRestockForm(medicationId);
      break;

    case "pause":
      updateMedicationStatus(
        medicationId,
        "paused"
      );
      break;

    case "activate":
      updateMedicationStatus(
        medicationId,
        "active"
      );
      break;

    case "complete":
      updateMedicationStatus(
        medicationId,
        "completed"
      );
      break;

    default:
      console.warn("Ação desconhecida:", action);
  }
}

/* ============================================================
   CLIQUES NAS DOSES DO DIA
   ============================================================ */

function handleTodayMedicationClick(event) {
  const button = event.target.closest("[data-action]");

  if (!button) return;

  const action = button.dataset.action;

  const scheduleId = button.dataset.scheduleId;
  const time = button.dataset.time;

  if (!scheduleId || !time) return;

  if (action === "take-dose") {
    markDoseTaken(scheduleId, time);
  }

  if (action === "skip-dose") {
    markDoseNotTaken(scheduleId, time);
  }
}

/* ============================================================
   RELÓGIO E ATUALIZAÇÃO AUTOMÁTICA
   ============================================================ */

function stopDoseClock() {
  if (doseClockInterval) {
    clearInterval(doseClockInterval);
    doseClockInterval = null;
  }
}

async function refreshApplicationData() {
  if (!currentUser || applicationLoading) return;

  try {
    await loadMedications();

    if (!currentUser) return;

    await renderTodayMedications();
    renderMedications();

  } catch (error) {
    console.error(
      "Erro na atualização automática:",
      error
    );
  }
}

function startDoseClock() {
  stopDoseClock();

  lastLoadedLocalDate = todayLocalDate();

  doseClockInterval = setInterval(async () => {
    if (!currentUser) return;

    const currentDate = todayLocalDate();

    // Mudou o dia no horário de Brasília.
    if (currentDate !== lastLoadedLocalDate) {
      lastLoadedLocalDate = currentDate;

      const todayDate = $("todayDate");

      if (todayDate) {
        todayDate.textContent = new Date().toLocaleDateString(
          "pt-BR",
          {
            timeZone: APP_TIMEZONE,
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric"
          }
        );
      }

      await refreshApplicationData();

      return;
    }

    // Atualiza o status de doses pendentes/atrasadas.
    await renderTodayMedications();

  }, 30000);
}

/* ============================================================
   VERIFICAR LINK DE RECUPERAÇÃO DE SENHA
   ============================================================ */

function isRecoveryUrl() {
  const hash = window.location.hash || "";
  const search = window.location.search || "";

  const hashParams = new URLSearchParams(
    hash.replace(/^#/, "")
  );

  const searchParams = new URLSearchParams(
    search.replace(/^\?/, "")
  );

  return (
    hashParams.get("type") === "recovery" ||
    searchParams.get("type") === "recovery"
  );
}

/* ============================================================
   RESTAURAR SESSÃO SALVA
   ============================================================ */

async function restoreSavedSession() {
  if (isRecoveryUrl()) {
    openPasswordResetScreen();
    return;
  }

  try {
    const { data, error } =
      await supabaseClient.auth.getSession();

    if (error) throw error;

    const user = data.session?.user;

    if (user) {
      await showApplication(user);
    } else {
      showLoginScreen();
    }

  } catch (error) {
    console.error(
      "Erro ao restaurar sessão:",
      error
    );

    showLoginScreen();

    showMessage(
      "Não foi possível restaurar sua sessão. Entre novamente.",
      true
    );
  }
}

/* ============================================================
   CONFIGURAÇÃO DOS EVENTOS
   ============================================================ */

let eventsConfigured = false;

function configureEvents() {
  if (eventsConfigured) return;

  eventsConfigured = true;

  // Formulários de autenticação.
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

  // Formulários de medicamentos.
  $("medicationForm")?.addEventListener(
    "submit",
    saveMedication
  );

  $("restockForm")?.addEventListener(
    "submit",
    saveRestock
  );

  // Botões principais.
  $("logoutButton")?.addEventListener(
    "click",
    logout
  );

  $("enableNotificationsButton")?.addEventListener(
    "click",
    enableMedicationNotifications
  );

  $("newMedicationButton")?.addEventListener(
    "click",
    openNewMedicationForm
  );

  $("addScheduleButton")?.addEventListener(
    "click",
    () => addScheduleRow()
  );

  $("cancelEditButton")?.addEventListener(
    "click",
    closeMedicationForm
  );

  $("cancelRestockButton")?.addEventListener(
    "click",
    closeRestockForm
  );

  // Ações delegadas.
  $("medicationList")?.addEventListener(
    "click",
    handleMedicationListClick
  );

  $("todayMedicationList")?.addEventListener(
    "click",
    handleTodayMedicationClick
  );

  // Navegação opcional, caso os botões existam no HTML.
  $("showRegisterButton")?.addEventListener(
    "click",
    () => showAuthPanel("registerPanel")
  );

  $("showRecoveryButton")?.addEventListener(
    "click",
    () => showAuthPanel("recoveryPanel")
  );

  $("backToLoginFromRegister")?.addEventListener(
    "click",
    () => showAuthPanel("loginPanel")
  );

  $("backToLoginFromRecovery")?.addEventListener(
    "click",
    () => showAuthPanel("loginPanel")
  );
}

  // ORIENTAÇÕES SOBRE O APLICATIVO
  $("guideButton")?.addEventListener("click", () => {
    const panel = $("appGuidePanel");
    const button = $("guideButton");

    if (!panel || !button) return;

    panel.classList.toggle("hidden");

    const aberto = !panel.classList.contains("hidden");

    button.setAttribute("aria-expanded", String(aberto));

    if (aberto) {
      panel.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  });

  $("closeGuideButton")?.addEventListener("click", () => {
    $("appGuidePanel")?.classList.add("hidden");
    $("guideButton")?.setAttribute("aria-expanded", "false");

    $("guideButton")?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  });

/* ============================================================
   MONITORAMENTO DAS ALTERAÇÕES DE AUTENTICAÇÃO
   ============================================================ */

function configureAuthListener() {
  supabaseClient.auth.onAuthStateChange(
    (event, session) => {
      /*
        O processamento é agendado para fora do callback
        de autenticação do Supabase.
      */

      setTimeout(async () => {
        try {
          if (event === "PASSWORD_RECOVERY") {
            openPasswordResetScreen();
            return;
          }

          if (event === "SIGNED_OUT") {
            stopDoseClock();

            currentUser = null;
            medications = [];
            schedulesByMedication = {};

            applicationUserId = null;

            showLoginScreen();

            return;
          }

          if (
            event === "SIGNED_IN" ||
            event === "INITIAL_SESSION" ||
            event === "TOKEN_REFRESHED" ||
            event === "USER_UPDATED"
          ) {
            if (recoveryMode) return;

            if (session?.user) {
              await showApplication(session.user);
            }
          }

        } catch (error) {
          console.error(
            "Erro ao processar alteração de autenticação:",
            error
          );
        }
      }, 0);
    }
  );
}

/* ============================================================
   INICIALIZAÇÃO DO MEDIHORA
   ============================================================ */

let appInitialized = false;

async function initializeApp() {
  if (appInitialized) return;

  appInitialized = true;

  try {
    if (!window.supabase) {
      throw new Error(
        "A biblioteca do Supabase não foi carregada."
      );
    }

    configureEvents();

    configureAuthListener();

    resetMedicationForm();

    $("medicationPanel")?.classList.add("hidden");
    $("restockPanel")?.classList.add("hidden");

    await restoreSavedSession();

    // Atualiza o botão se o OneSignal já estiver disponível.
    updateNotificationButton().catch(error => {
      console.warn(
        "Não foi possível atualizar o botão OneSignal:",
        error
      );
    });

  } catch (error) {
    console.error(
      "Erro na inicialização do MediHora:",
      error
    );

    showLoginScreen();

    showMessage(
      error.message ||
        "Não foi possível iniciar o MediHora.",
      true
    );
  }
}

/* ============================================================
   INICIAR QUANDO O HTML ESTIVER PRONTO
   ============================================================ */

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeApp,
    { once: true }
  );
} else {
  initializeApp();
}

 
