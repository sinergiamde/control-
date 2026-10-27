import React, { createContext, useContext, useState, ReactNode } from "react";

type Lang = "en" | "es";

const translations = {
  en: {
    brand: "CTRL+",
    tagline: "by TaxForYou",
    login: "Log In",
    register: "Register",
    name: "Full Name",
    email: "Email",
    phone: "Phone",
    country: "Country",
    password: "Password",
    confirmPassword: "Confirm Password",
    noAccount: "Don't have an account?",
    hasAccount: "Already have an account?",
    createAccount: "Create your account",
    welcomeBack: "Welcome back",
    checkEmail: "Check your email",
    confirmEmailSent: "We sent a confirmation link to your email. Please verify to continue.",
    dashboard: "Dashboard",
    upload: "Upload Statement",
    uploadDesc: "Drag & drop your bank statement or click to browse",
    supportedFormats: "Supported formats: PDF, CSV, XLSX",
    analyze: "Analyze Statement",
    analyzing: "Analyzing...",
    analysisError: "Could not analyze this document.",
    results: "Results",
    totalSpent: "Total Spent",
    topCategory: "Top Category",
    transactions: "Transactions",
    expenseBreakdown: "Expense Breakdown",
    logout: "Log Out",
    category: "Category",
    amount: "Amount",
    percentage: "Percentage",
    backToDashboard: "Back to Dashboard",
    welcome: "Welcome",
    uploadYourStatement: "Upload your bank statement to get detailed spending insights",
    dragDrop: "Drag & drop file here",
    orClick: "or click to browse",
    selectCountry: "Select country",
    downloadReport: "Download Report",
    adminPanel: "Admin Panel",
    allUsers: "All Users",
    noUsers: "No users found",
    userDeleted: "User deleted successfully",
    makeAdmin: "Make admin",
    removeAdmin: "Remove admin",
    adminGranted: "Admin access granted",
    adminRevoked: "Admin access removed",
    actions: "Actions",
    joined: "Joined",
    selectMultiple: "(you can select multiple)",
    loadingText: "Loading...",
    userFallback: "User",
    aiAnalysisLabel: "AI Analysis",
    formatsLabel: "Formats",
    plReportLabel: "P&L Report",
    professionalWord: "Professional",
    fileWord: "file",
    readyWord: "ready",
    clickOrDragAddMore: "+ Click or drag to add more",
    analyzingWord: "Analyzing",
    errorWord: "error(s)",
    analysesSavedWord: "analysis/analyses saved.",
    checkHistoryDuplicateWarning: "Check History — if two statements turn out to be for the same period, we'll flag it there so you can delete the one that doesn't belong.",
    couldNotReadFile: "Could not read the file.",
    analyzerCouldNotRead: "The analyzer could not read this file.",
    analyzerNoResults: "The analyzer did not return any results.",
    clientsNav: "Clients",
    clientsPageTitle: "Clients",
    clientsPageDesc: "The clients your firm manages and their statements.",
    addClient: "Add client",
    clientNamePlaceholder: "New client (e.g. TAXFORYOU INC.)",
    noClientsYet: "No clients yet.",
    subCompanyPlaceholder: "New sub-client of",
    addSubCompany: "Add",
    subCompaniesWord: "sub-clients",
    usersWord: "users",
    moveToLabel: "Move to…",
    topLevelOption: "Main client (top level)",
    companyMoved: "Client moved.",
    noSubCompanies: "No sub-clients yet.",
    ownerCaption: "Owner of the app",
    customerCompaniesWord: "clients",
    companyUsersLabel: "Users",
    userCompanyColumn: "Clients",
    noCompanyOption: "No clients",
    userCompanyUpdated: "User's clients updated.",
    statementsCountLabel: "statements",
    editWord: "Edit",
    saveWord: "Save",
    cancelWord: "Cancel",
    clientCreated: "Client added.",
    clientRenamed: "Client renamed.",
    clientDeleted: "Client deleted.",
    clientDuplicateError: "You already have a client with that name.",
    clientDeleteBlockedError: "This client has statements, sub-clients or users linked to it — remove or move those first.",
    confirmDeleteClient: "Delete this client? This cannot be undone.",
    clientNameEmptyError: "Type the client's name first.",
    searchClientsPlaceholder: "Search clients...",
    viewHistoryWord: "History",
  },
  es: {
    brand: "CTRL+",
    tagline: "por TaxForYou",
    login: "Iniciar Sesión",
    register: "Registrarse",
    name: "Nombre Completo",
    email: "Correo Electrónico",
    phone: "Teléfono",
    country: "País",
    password: "Contraseña",
    confirmPassword: "Confirmar Contraseña",
    noAccount: "¿No tienes cuenta?",
    hasAccount: "¿Ya tienes cuenta?",
    createAccount: "Crea tu cuenta",
    welcomeBack: "Bienvenido de nuevo",
    checkEmail: "Revisa tu correo",
    confirmEmailSent: "Enviamos un enlace de confirmación a tu correo. Verifica para continuar.",
    dashboard: "Panel",
    upload: "Subir Estado de Cuenta",
    uploadDesc: "Arrastra y suelta tu estado de cuenta o haz clic para buscar",
    supportedFormats: "Formatos soportados: PDF, CSV, XLSX",
    analyze: "Analizar Estado",
    analyzing: "Analizando...",
    analysisError: "No se pudo analizar este documento.",
    results: "Resultados",
    totalSpent: "Total Gastado",
    topCategory: "Categoría Principal",
    transactions: "Transacciones",
    expenseBreakdown: "Desglose de Gastos",
    logout: "Cerrar Sesión",
    category: "Categoría",
    amount: "Monto",
    percentage: "Porcentaje",
    backToDashboard: "Volver al Panel",
    welcome: "Bienvenido",
    uploadYourStatement: "Sube tu estado de cuenta para obtener información detallada de gastos",
    dragDrop: "Arrastra y suelta aquí",
    orClick: "o haz clic para buscar",
    selectCountry: "Seleccionar país",
    downloadReport: "Descargar Reporte",
    adminPanel: "Panel de Administración",
    allUsers: "Todos los Usuarios",
    noUsers: "No se encontraron usuarios",
    userDeleted: "Usuario eliminado exitosamente",
    makeAdmin: "Hacer admin",
    removeAdmin: "Quitar admin",
    adminGranted: "Acceso de admin otorgado",
    adminRevoked: "Acceso de admin retirado",
    actions: "Acciones",
    joined: "Registrado",
    selectMultiple: "(puedes seleccionar varios)",
    loadingText: "Cargando...",
    userFallback: "Usuario",
    aiAnalysisLabel: "Análisis IA",
    formatsLabel: "Formatos",
    plReportLabel: "Reporte P&L",
    professionalWord: "Profesional",
    fileWord: "archivo",
    readyWord: "listo",
    clickOrDragAddMore: "+ Haz clic o arrastra para añadir más",
    analyzingWord: "Analizando",
    errorWord: "error(es)",
    analysesSavedWord: "análisis guardado(s).",
    checkHistoryDuplicateWarning: "Revisa el Historial — si dos extractos resultan ser del mismo período, ahí te avisamos para que elimines el que no corresponda.",
    couldNotReadFile: "No se pudo leer el archivo.",
    analyzerCouldNotRead: "El analizador no pudo leer este archivo.",
    analyzerNoResults: "El analizador no devolvió resultados.",
    clientsNav: "Clientes",
    clientsPageTitle: "Clientes",
    clientsPageDesc: "Los clientes que administra tu firma y sus extractos.",
    addClient: "Agregar cliente",
    clientNamePlaceholder: "Nuevo cliente (ej. TAXFORYOU INC.)",
    noClientsYet: "Aún no hay clientes.",
    subCompanyPlaceholder: "Nuevo sub-cliente de",
    addSubCompany: "Agregar",
    subCompaniesWord: "sub-clientes",
    usersWord: "usuarios",
    moveToLabel: "Mover a…",
    topLevelOption: "Cliente principal (nivel superior)",
    companyMoved: "Cliente movido.",
    noSubCompanies: "Aún no tiene sub-clientes.",
    ownerCaption: "Dueña de la aplicación",
    customerCompaniesWord: "clientes",
    companyUsersLabel: "Usuarios",
    userCompanyColumn: "Clientes",
    noCompanyOption: "Sin clientes",
    userCompanyUpdated: "Clientes del usuario actualizados.",
    statementsCountLabel: "extractos",
    editWord: "Editar",
    saveWord: "Guardar",
    cancelWord: "Cancelar",
    clientCreated: "Cliente agregado.",
    clientRenamed: "Cliente renombrado.",
    clientDeleted: "Cliente eliminado.",
    clientDuplicateError: "Ya tienes un cliente con ese nombre.",
    clientDeleteBlockedError: "Este cliente tiene extractos, sub-clientes o usuarios asociados — elimínalos o muévelos primero.",
    confirmDeleteClient: "¿Eliminar este cliente? Esto no se puede deshacer.",
    clientNameEmptyError: "Primero escribe el nombre del cliente.",
    searchClientsPlaceholder: "Buscar clientes...",
    viewHistoryWord: "Historial",
  },
};

interface LanguageContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: keyof typeof translations.en) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const LANG_STORAGE_KEY = "ctrl-plus-lang";

// The chosen language survives a reload (per browser). Storage can be unavailable (private mode,
// blocked site data), so every access is guarded and English stays the fallback.
const readStoredLang = (): Lang => {
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    return stored === "es" || stored === "en" ? stored : "en";
  } catch {
    return "en";
  }
};

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLangState] = useState<Lang>(readStoredLang);
  const setLang = (next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // Not persisted this time; the in-memory choice still applies.
    }
  };
  const t = (key: keyof typeof translations.en) => translations[lang][key] || key;
  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
};
