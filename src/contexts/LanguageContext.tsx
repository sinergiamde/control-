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
    actions: "Actions",
    joined: "Joined",
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
    actions: "Acciones",
    joined: "Registrado",
  },
};

interface LanguageContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: keyof typeof translations.en) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLang] = useState<Lang>("en");
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
