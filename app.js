
const SUPABASE_URL = "https://dtwfettaesywyczfyvpr.supabase.co";
const SUPABASE_KEY = "sb_publishable_WsqtiIuq2h_4e1gtVGg8PQ_L4LW7px0";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);

function message(text, error = false) {
  const box = $("message");
  box.textContent = text;
  box.classList.remove("hidden", "error");
  if (error) box.classList.add("error");
  window.clearTimeout(message.timer);
  message.timer = window.setTimeout(() => box.classList.add("hidden"), 6000);
}

function showPanel(name) {
  ["loginPanel", "registerPanel", "recoveryPanel", "newPasswordPanel"]
    .forEach(id => $(id).classList.add("hidden"));
  $(name).classList.remove("hidden");
}

function showAuth() {
  $("authSection").classList.remove("hidden");
  $("appSection").classList.add("hidden");
}

function showApp(user) {
  $("authSection").classList.add("hidden");
  $("appSection").classList.remove("hidden");
  $("userName").textContent =
    user.user_metadata?.full_name || user.email?.split("@")[0] || "usuário";
  loadMedications();
}

$("showRegister").addEventListener("click", () => showPanel("registerPanel"));
$("showRecovery").addEventListener("click", () => showPanel("recoveryPanel"));
$("backLogin1").addEventListener("click", () => showPanel("loginPanel"));
$("backLogin2").addEventListener("click", () => showPanel("loginPanel"));

$("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const fullName = $("registerName").value.trim();
  const email = $("registerEmail").value.trim();
  const password = $("registerPassword").value;

  if (password.length < 8) {
    message("A senha precisa ter pelo menos 8 caracteres.", true);
    return;
  }

  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: window.location.origin + window.location.pathname
    }
  });

  if (error) return message(error.message, true);

  if (data.session) {
    message("Conta criada com sucesso!");
  } else {
    message("Cadastro iniciado! Confira seu e-mail para confirmar a conta.");
    showPanel("loginPanel");
  }
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  const { error } = await db.auth.signInWithPassword({ email, password });

  if (error) return message("Não foi possível entrar. Confira seu e-mail e senha.", true);

  message("Login realizado com sucesso!");
});

$("recoveryForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("recoveryEmail").value.trim();

  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });

  if (error) return message(error.message, true);

  message("Se o endereço estiver cadastrado, você receberá um e-mail para redefinir a senha.");
});

$("newPasswordForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const password = $("newPassword").value;
  if (password.length < 8) {
    return message("A senha precisa ter pelo menos 8 caracteres.", true);
  }

  const { error } = await db.auth.updateUser({ password });

  if (error) return message(error.message, true);

  message("Senha atualizada com sucesso!");
  showPanel("loginPanel");
});

$("logoutBtn").addEventListener("click", async () => {
  const { error } = await db.auth.signOut();
  if (error) return message(error.message, true);
  showAuth();
  showPanel("loginPanel");
  message("Você saiu da sua conta.");
});

$("medicationForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const { data: { user }, error: userError } = await db.auth.getUser();
  if (userError || !user) return message("Faça login novamente.", true);

  const medication = {
    user_id: user.id,
    name: $("medName").value.trim(),
    dose: $("medDose").value.trim(),
    start_date: $("medStart").value,
    prescribed_days: Number($("medDays").value),
    instructions: $("medInstructions").value.trim() || null,
    timezone: "America/Sao_Paulo",
    status: "active"
  };

  const { error } = await db.from("medications").insert(medication);

  if (error) return message("Erro ao salvar medicamento: " + error.message, true);

  $("medicationForm").reset();
  message("Medicamento cadastrado!");
  await loadMedications();
});

$("refreshBtn").addEventListener("click", loadMedications);

async function loadMedications() {
  const list = $("medicationList");
  list.innerHTML = '<p class="muted">Carregando medicamentos...</p>';

  const { data, error } = await db
    .from("medications")
    .select("id,name,dose,start_date,prescribed_days,instructions,status")
    .order("created_at", { ascending: false });

  if (error) {
    list.textContent = "Não foi possível carregar os medicamentos.";
    message(error.message, true);
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = '<p class="muted">Você ainda não cadastrou medicamentos.</p>';
    return;
  }

  list.replaceChildren();

  data.forEach(med => {
    const card = document.createElement("article");
    card.className = "med-card";

    const title = document.createElement("h3");
    title.textContent = med.name;

    const dose = document.createElement("p");
    dose.textContent = "Dose: " + med.dose;

    const start = document.createElement("p");
    start.textContent = "Início: " + formatDate(med.start_date);

    const days = document.createElement("p");
    days.textContent = "Duração prescrita: " + med.prescribed_days + " dias";

    const status = document.createElement("p");
    status.className = "status";
    status.textContent = "Situação: " + med.status;

    card.append(title, dose, start, days, status);

    if (med.instructions) {
      const instructions = document.createElement("p");
      instructions.textContent = "Instruções: " + med.instructions;
      card.append(instructions);
    }

    list.append(card);
  });
}

function formatDate(date) {
  if (!date) return "Não informada";
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

async function initialize() {
  const { data, error } = await db.auth.getSession();

  if (error) {
    message("Erro ao verificar a sessão: " + error.message, true);
    showAuth();
    return;
  }

  if (data.session?.user) {
    showApp(data.session.user);
  } else {
    showAuth();
    showPanel("loginPanel");
  }

  db.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      showAuth();
      showPanel("newPasswordPanel");
      return;
    }

    if (session?.user) {
      showApp(session.user);
    } else {
      showAuth();
      showPanel("loginPanel");
    }
  });
}

initialize();

