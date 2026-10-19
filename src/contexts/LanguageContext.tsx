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
    clientsNav: "Companies",
    clientsPageTitle: "Companies",
    clientsPageDesc: "TaxForYou's customer companies and the companies each one manages.",
    addClient: "Add company",
    clientNamePlaceholder: "New customer company (e.g. Pepito Pérez)",
    noClientsYet: "No companies yet. Add the first one above.",
    subCompanyPlaceholder: "New sub-company of",
    addSubCompany: "Add",
    subCompaniesWord: "sub-companies",
    usersWord: "users",
    moveToLabel: "Move to…",
    topLevelOption: "Customer company (top level)",
    companyMoved: "Company moved.",
    noSubCompanies: "No sub-companies yet.",
    ownerCaption: "Owner of the app",
    customerCompaniesWord: "customer companies",
    companyUsersLabel: "Users",
    userCompanyColumn: "Company",
    noCompanyOption: "No company",
    userCompanyUpdated: "User's company updated.",
    statementsCountLabel: "statements",
    editWord: "Edit",
    saveWord: "Save",
    cancelWord: "Cancel",
    clientCreated: "Company added.",
    clientRenamed: "Company renamed.",
    clientDeleted: "Company deleted.",
    clientDuplicateError: "A company with that name already exists here.",
    clientDeleteBlockedError: "This company has statements, sub-companies or users linked to it — remove or move those first.",
    confirmDeleteClient: "Delete this company? This cannot be undone.",
    clientNameEmptyError: "Enter a company name.",
    searchClientsPlaceholder: "Search companies...",
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
    clientsNav: "Empresas",
    clientsPageTitle: "Empresas",
    clientsPageDesc: "Las empresas cliente de TaxForYou y las empresas que maneja cada una.",
    addClient: "Agregar empresa",
    clientNamePlaceholder: "Nueva empresa cliente (ej. Pepito Pérez)",
    noClientsYet: "Aún no hay empresas. Agrega la primera arriba.",
    subCompanyPlaceholder: "Nueva sub-empresa de",
    addSubCompany: "Agregar",
    subCompaniesWord: "sub-empresas",
    usersWord: "usuarios",
    moveToLabel: "Mover a…",
    topLevelOption: "Empresa cliente (nivel superior)",
    companyMoved: "Empresa movida.",
    noSubCompanies: "Aún no tiene sub-empresas.",
    ownerCaption: "Dueña de la aplicación",
    customerCompaniesWord: "empresas cliente",
    companyUsersLabel: "Usuarios",
    userCompanyColumn: "Empresa",
    noCompanyOption: "Sin empresa",
    userCompanyUpdated: "Empresa del usuario actualizada.",
    statementsCountLabel: "extractos",
    editWord: "Editar",
    saveWord: "Guardar",
    cancelWord: "Cancelar",
    clientCreated: "Empresa agregada.",
    clientRenamed: "Empresa renombrada.",
    clientDeleted: "Empresa eliminada.",
    clientDuplicateError: "Ya existe una empresa con ese nombre aquí.",
    clientDeleteBlockedError: "Esta empresa tiene extractos, sub-empresas o usuarios asociados — elimínalos o muévelos primero.",
    confirmDeleteClient: "¿Eliminar esta empresa? Esto no se puede deshacer.",
    clientNameEmptyError: "Escribe un nombre de empresa.",
    searchClientsPlaceholder: "Buscar empresas...",
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
