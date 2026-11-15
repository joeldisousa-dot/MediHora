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

  // A dose só fica atrasada após 30 minutos.
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
  Executa uma operação depois que o SDK OneSignal
  estiver disponível e inicializado.

  O tempo limite evita que o botão fique eternamente
  mostrando "Ativando..." se o SDK não responder.
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
  Consulta a permissão e o estado real da inscrição.
*/

async function getOneSignalPushState() {
  return runOneSignal(async OneSignal => {
    const permission =
      OneSignal.Notifications.permission === true;

    const subscription =
      OneSignal.User?.PushSubscription;

    return {
      permission,
      optedIn: subscription?.optedIn === true,
      id: subscription?.id || null,
      token: subscription?.token || null
    };
  });
}

/*
  Atualiza o botão de notificações.
*/

async function updateNotificationButton() {
  const button = $("enableNotificationsButton");

  if (!button) return;

  try {
    const state = await getOneSignalPushState();

    if (state.permission && state.optedIn) {
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
  Registra os eventos de alteração da inscrição.
*/

async function registerOneSignalListeners(OneSignal) {
  if (oneSignalListenersRegistered) return;

  const pushSubscription =
    OneSignal.User?.PushSubscription;

  if (!pushSubscription) return;

  pushSubscription.addEventListener("change", () => {
    updateNotificationButton();
  });

  OneSignal.Notifications.addEventListener(
    "permissionChange",
    () => {
      updateNotificationButton();
    }
  );

  oneSignalListenersRegistered = true;
}

/*
  Vincula o usuário autenticado do Supabase ao OneSignal.

  O identificador externo permite que o servidor envie
  notificações somente para a conta correspondente.
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
  Desvincula o usuário atual do OneSignal.
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

  Só solicita permissão após o clique do usuário.
  Depois verifica se existe inscrição Push efetiva.
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
          "O serviço de inscrição Push não está disponível neste navegador."
        );
      }

      await pushSubscription.optIn();

      return {
        permission: true,
        optedIn: pushSubscription.optedIn === true,
        id: pushSubscription.id || null,
        token: pushSubscription.token || null
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
        "A permissão foi concedida, mas o OneSignal ainda não confirmou a inscrição do dispositivo. Aguarde alguns segundos e tente novamente.",
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
   AUTENTICAÇÃO
   ============================================================ */
